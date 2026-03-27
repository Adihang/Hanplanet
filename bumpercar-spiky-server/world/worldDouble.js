/**
 * worldDouble.js — 더블 스킨 유닛 처리 믹스인
 *
 * 더블 스킨 플레이어는 두 개의 독립적인 유닛(doubleUnits[0], doubleUnits[1])으로 구성된다.
 * 두 유닛은 merged(합체) 상태로 이동하다가 충돌 시 split(분리)되며,
 * 가까워지면 다시 merged 로 복귀한다.
 * 각 유닛은 체력을 별도로 가지며, 모든 유닛이 소진되면 플레이어가 패배한다.
 * syncDoubleSkinState 는 스킨 이름 기반으로 isDoubleSkin 등 파생 플래그를 동기화한다.
 */
const {
    DOUBLE_UNIT_COUNT,
    DOUBLE_UNIT_HEALTH,
    DOUBLE_SEPARATION_ANGLE_RADIANS,
    DOUBLE_MERGED_SIDE_OFFSET,
    DOUBLE_SPLIT_PROBABILITY,
    DOUBLE_REJOIN_EXTRA_DISTANCE,
    DOUBLE_REMERGE_LOCK_MS,
    DOUBLE_SPLIT_PROTECTION_MS,
    SPLIT_DEFEAT_PROTECTION_MS,
    DOUBLE_IDLE_REMERGE_DELAY_MS,
    DOUBLE_STEER_MIN_RADIANS,
    DOUBLE_STEER_MAX_RADIANS,
    DOUBLE_STEER_DEADZONE_RADIANS,
    DOUBLE_ALIGNMENT_DEADZONE_DISTANCE,
    DOUBLE_INACTIVE_FADE_MS,
    COLLISION_RECOVERY_DURATION_MS,
    COLLISION_IMPACT_DURATION_MS,
} = require("../config/constants")
const {
    getBaseSpeedForPlayer,
    getMaxBoostedSpeedForPlayer,
    getRaiseSpeakiBoostDistanceMultiplier,
    isDoubleSkinPlayer,
    isPumpkinSkinPlayer,
    getDoubleAliveUnitIndices,
} = require("./worldHelpers")
const {
    BOOST_ACCELERATION_PER_SECOND,
    BOOST_COOLDOWN_PER_SECOND,
    USER_POST_BOOST_COOLDOWN_MS,
    TICK_DELTA_SECONDS,
    createDoubleUnitState,
} = require("./worldSettings")
const { WORLD_SIZE } = require("../config/config")
const {
    COLLISION_VISUAL_BASE_DURATION_MS,
    COLLISION_BOOST_LOCK_DURATION_MS,
    NPC_DEFEAT_BOUNCE_MULTIPLIER,
} = require("../config/constants")

module.exports = {
    /**
     * 플레이어의 스킨 이름에 따라 double 관련 플래그와 초기 유닛 상태를 동기화한다.
     * NPC 또는 더미 플레이어는 처리하지 않는다.
     * 더블 스킨이 아닌 경우 doubleUnits를 초기화하고 분리 상태를 리셋한다.
     * @param {object} player - 동기화할 플레이어 객체
     * @param {number} [now=Date.now()] - 현재 타임스탬프(ms)
     */
    syncDoubleSkinState(player, now = Date.now()) {
        if (!player || player.isNpc || player.isDummy) {
            return
        }

        player.isPumpkinSkin = isPumpkinSkinPlayer(player)
        const wasDoubleSkin = Boolean(player.isDoubleSkin)
        const shouldUseDoubleSkin = isDoubleSkinPlayer(player)
        player.isDoubleSkin = shouldUseDoubleSkin
        if (!shouldUseDoubleSkin) {
            player.doubleMerged = false
            player.doubleSeparationPhase = "merged"
            player.doubleUnits = [createDoubleUnitState(now), createDoubleUnitState(now)]
            return
        }

        if (!Array.isArray(player.doubleUnits) || player.doubleUnits.length !== DOUBLE_UNIT_COUNT) {
            player.doubleUnits = [createDoubleUnitState(now), createDoubleUnitState(now)]
        }

        player.doubleUnits = player.doubleUnits.map((unit) => ({
            ...createDoubleUnitState(now),
            ...(unit || {}),
            health: Math.max(
                0,
                Math.min(
                    DOUBLE_UNIT_HEALTH,
                    Number(unit && unit.health !== undefined ? unit.health : DOUBLE_UNIT_HEALTH)
                )
            ),
            currentSpeed: Math.max(getBaseSpeedForPlayer(player), Number(unit && unit.currentSpeed || getBaseSpeedForPlayer(player))),
        }))
        const hasMeaningfulUnitPosition = player.doubleUnits.some((unit) => (
            Math.abs(Number(unit && unit.x || 0)) > 0.001 ||
            Math.abs(Number(unit && unit.y || 0)) > 0.001
        ))
        if (!wasDoubleSkin || typeof player.doubleMerged !== "boolean" || !hasMeaningfulUnitPosition) {
            player.doubleMerged = true
        }
        player.doubleMergeLockUntil = Number(player.doubleMergeLockUntil || 0)
        player.doubleSeparationPhase = player.doubleMerged ? "merged" : (player.doubleSeparationPhase || "split")
        this.ensureDoubleUnitLayout(player, now)
    },

    /**
     * 유닛 레이아웃(merged/split/single)을 현재 생존 유닛 수에 맞게 정규화한다.
     * 생존 유닛이 1개 이하면 single 상태로 전환하고, merged 상태면 좌우 오프셋을 적용한다.
     * @param {object} player - 레이아웃을 정규화할 플레이어 객체
     * @param {number} [now=Date.now()] - 현재 타임스탬프(ms)
     */
    ensureDoubleUnitLayout(player, now = Date.now()) {
        if (!player || !player.isDoubleSkin || !Array.isArray(player.doubleUnits)) {
            return
        }

        const aliveIndices = getDoubleAliveUnitIndices(player)
        if (aliveIndices.length <= 1) {
            player.doubleMerged = false
            player.doubleSeparationPhase = "single"
            player.doubleMergeLockUntil = 0
            player.doubleSeparatedAt = Number(player.doubleSeparatedAt || 0)
            const liveIndex = aliveIndices.length ? aliveIndices[0] : 0
            player.doubleUnits.forEach((unit, index) => {
                if (!unit) {
                    return
                }
                if (index === liveIndex && aliveIndices.length) {
                    unit.x = player.x
                    unit.y = player.y
                    unit.inactiveUntil = 0
                } else {
                    unit.x = player.x
                    unit.y = player.y
                    unit.inactiveUntil = unit.inactiveUntil || (now + DOUBLE_INACTIVE_FADE_MS)
                }
            })
            return
        }

        if (player.doubleMerged) {
            player.doubleSeparationPhase = "merged"
            const angle = typeof player.facingAngle === "number" ? player.facingAngle : 0
            const sideX = -Math.sin(angle)
            const sideY = Math.cos(angle)
            const leftUnit = player.doubleUnits[0]
            const rightUnit = player.doubleUnits[1]
            leftUnit.x = player.x - sideX * DOUBLE_MERGED_SIDE_OFFSET
            leftUnit.y = player.y - sideY * DOUBLE_MERGED_SIDE_OFFSET
            rightUnit.x = player.x + sideX * DOUBLE_MERGED_SIDE_OFFSET
            rightUnit.y = player.y + sideY * DOUBLE_MERGED_SIDE_OFFSET
            leftUnit.inactiveUntil = 0
            rightUnit.inactiveUntil = 0
        }
    },

    /**
     * 두 유닛이 합체하기 위한 거리 임계값을 반환한다.
     * 충돌 반경에 재합류 여유 거리를 더한 값이다.
     * @param {object} player - 대상 플레이어 객체
     * @returns {number} 합체 임계 거리
     */
    getDoubleMergeThreshold(player) {
        return this.getCollisionRadius(player) + DOUBLE_REJOIN_EXTRA_DISTANCE
    },

    /**
     * 충돌 방향에 따라 어느 유닛이 피격됐는지 인덱스를 반환한다.
     * 충돌 법선 방향으로 가장 돌출된 유닛이 피격 유닛으로 선택된다.
     * merged 상태에서 좌측 이동 중이면 선택된 인덱스를 반전한다.
     * @param {object} player - 대상 플레이어 객체
     * @param {number} normalX - 충돌 법선 벡터 X 성분
     * @param {number} normalY - 충돌 법선 벡터 Y 성분
     * @returns {number} 피격 유닛 인덱스
     */
    getDoubleHitUnitIndex(player, normalX, normalY) {
        if (!player || !player.isDoubleSkin) {
            return 0
        }
        const aliveIndices = getDoubleAliveUnitIndices(player)
        if (aliveIndices.length <= 1) {
            return aliveIndices[0] || 0
        }
        let bestIndex = aliveIndices[0]
        let bestProjection = -Infinity
        aliveIndices.forEach((unitIndex) => {
            const unit = player.doubleUnits[unitIndex]
            if (!unit) {
                return
            }
            const offsetX = Number(unit.x || 0) - Number(player.x || 0)
            const offsetY = Number(unit.y || 0) - Number(player.y || 0)
            const projection = offsetX * normalX + offsetY * normalY
            if (projection > bestProjection) {
                bestProjection = projection
                bestIndex = unitIndex
            }
        })
        if (player.doubleMerged && aliveIndices.length > 1) {
            const movingLeft = Number(player.lastMoveX || 0) < -0.001
            const facingLeft = Math.cos(typeof player.facingAngle === "number" ? player.facingAngle : 0) < 0
            const shouldReverseMergedHit = movingLeft || (!Math.abs(Number(player.lastMoveX || 0)) && facingLeft)
            if (shouldReverseMergedHit) {
                return bestIndex === 0 ? 1 : 0
            }
        }
        return bestIndex
    },

    /**
     * 충돌 계산에 사용할 대표 위치를 반환한다.
     * split 상태일 때는 towardX/Y 에 가장 가까운 유닛의 위치를 반환하고,
     * merged 상태이거나 더블 스킨이 아닌 경우 플레이어 중심 좌표를 반환한다.
     * @param {object} player - 대상 플레이어 객체
     * @param {number} towardX - 기준점 X 좌표
     * @param {number} towardY - 기준점 Y 좌표
     * @returns {{x: number, y: number}} 대표 충돌 위치
     */
    getCollisionReferencePoint(player, towardX, towardY) {
        if (!player || !player.isDoubleSkin || player.doubleMerged || !Array.isArray(player.doubleUnits)) {
            return {
                x: Number(player && player.x || 0),
                y: Number(player && player.y || 0)
            }
        }

        const aliveIndices = getDoubleAliveUnitIndices(player)
        if (!aliveIndices.length) {
            return {
                x: Number(player.x || 0),
                y: Number(player.y || 0)
            }
        }

        let bestUnit = player.doubleUnits[aliveIndices[0]]
        let bestDistance = Infinity
        aliveIndices.forEach((unitIndex) => {
            const unit = player.doubleUnits[unitIndex]
            if (!unit) {
                return
            }
            const distance = Math.hypot(Number(unit.x || 0) - towardX, Number(unit.y || 0) - towardY)
            if (distance < bestDistance) {
                bestDistance = distance
                bestUnit = unit
            }
        })

        return {
            x: Number(bestUnit && bestUnit.x || player.x || 0),
            y: Number(bestUnit && bestUnit.y || player.y || 0)
        }
    },

    /**
     * 플레이어 좌표를 살아있는 유닛의 중심으로 이동한다.
     * 생존 유닛이 1개면 해당 유닛 위치로, 2개 이상이면 평균 위치로 갱신한다.
     * @param {object} player - 재중심화할 플레이어 객체
     */
    recenterDoublePlayer(player) {
        if (!player || !player.isDoubleSkin || !Array.isArray(player.doubleUnits)) {
            return
        }
        const aliveIndices = getDoubleAliveUnitIndices(player)
        if (!aliveIndices.length) {
            return
        }
        if (aliveIndices.length === 1) {
            const liveUnit = player.doubleUnits[aliveIndices[0]]
            if (liveUnit) {
                player.x = liveUnit.x
                player.y = liveUnit.y
            }
            return
        }
        const liveUnits = aliveIndices.map((unitIndex) => player.doubleUnits[unitIndex]).filter(Boolean)
        if (!liveUnits.length) {
            return
        }
        player.x = liveUnits.reduce((sum, unit) => sum + Number(unit.x || 0), 0) / liveUnits.length
        player.y = liveUnits.reduce((sum, unit) => sum + Number(unit.y || 0), 0) / liveUnits.length
    },

    /**
     * 충돌 밀림 벡터를 플레이어(또는 유닛)에 적용한다.
     * split 상태일 때는 피격 유닛만 밀고, merged 상태이거나 단일 플레이어면 전체를 민다.
     * @param {object} player - 밀림을 적용할 플레이어 객체
     * @param {number} pushDirX - 밀림 방향 단위벡터 X
     * @param {number} pushDirY - 밀림 방향 단위벡터 Y
     * @param {number} distance - 밀림 거리
     */
    applyCollisionPush(player, pushDirX, pushDirY, distance) {
        if (!player) {
            return
        }
        const appliedDistance = distance * 0.5
        if (player.isDoubleSkin && !player.doubleMerged && Array.isArray(player.doubleUnits)) {
            const hitUnitIndex = this.getDoubleHitUnitIndex(player, -pushDirX, -pushDirY)
            const targetUnit = player.doubleUnits[hitUnitIndex]
            if (targetUnit && Number(targetUnit.health || 0) > 0) {
                targetUnit.lastMoveX = pushDirX * appliedDistance
                targetUnit.lastMoveY = pushDirY * appliedDistance
                targetUnit.x = this.clampToWorld(Number(targetUnit.x || 0) + pushDirX * appliedDistance)
                targetUnit.y = this.clampToWorld(Number(targetUnit.y || 0) + pushDirY * appliedDistance)
                this.recenterDoublePlayer(player)
                return
            }
        }
        player.lastMoveX = pushDirX * appliedDistance
        player.lastMoveY = pushDirY * appliedDistance
        player.x = this.clampToWorld(Number(player.x || 0) + pushDirX * appliedDistance)
        player.y = this.clampToWorld(Number(player.y || 0) + pushDirY * appliedDistance)
        if (player.isDoubleSkin && player.doubleMerged && Array.isArray(player.doubleUnits)) {
            player.doubleUnits.forEach((unit) => {
                if (!unit || Number(unit.health || 0) <= 0) {
                    return
                }
                unit.lastMoveX = pushDirX * appliedDistance
                unit.lastMoveY = pushDirY * appliedDistance
                unit.x = this.clampToWorld(Number(unit.x || 0) + pushDirX * appliedDistance)
                unit.y = this.clampToWorld(Number(unit.y || 0) + pushDirY * appliedDistance)
            })
        }
    },

    /**
     * 벡터를 지정 각도로 회전한다.
     * 2D 회전 행렬을 적용하여 새 벡터 성분을 반환한다.
     * @param {number} dx - 원본 벡터 X 성분
     * @param {number} dy - 원본 벡터 Y 성분
     * @param {number} angle - 회전 각도(라디안)
     * @returns {{dx: number, dy: number}} 회전된 벡터
     */
    rotateVector(dx, dy, angle) {
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        return {
            dx: dx * cos - dy * sin,
            dy: dx * sin + dy * cos
        }
    },

    /**
     * 각도를 [-π, π] 범위로 정규화한다.
     * 범위를 벗어난 각도에 2π를 더하거나 빼서 정규화된 값을 반환한다.
     * @param {number} angle - 정규화할 각도(라디안)
     * @returns {number} [-π, π] 범위의 각도
     */
    normalizeAngle(angle) {
        let nextAngle = angle
        while (nextAngle > Math.PI) {
            nextAngle -= Math.PI * 2
        }
        while (nextAngle < -Math.PI) {
            nextAngle += Math.PI * 2
        }
        return nextAngle
    },

    /**
     * 매 틱마다 더블 유닛의 이동·부스트·합체·분리를 갱신하고 이동 벡터를 반환한다.
     * 입력 방향, 부스트 상태, 충돌 회복, 자동 재합류 로직을 모두 처리한다.
     * 생존 유닛들의 평균 이동 벡터를 반환하며, 플레이어 중심 좌표도 갱신한다.
     * @param {object} player - 갱신할 플레이어 객체
     * @param {number} now - 현재 타임스탬프(ms)
     * @param {number} inputDx - 입력 방향 X 성분(정규화됨)
     * @param {number} inputDy - 입력 방향 Y 성분(정규화됨)
     * @returns {{dx: number, dy: number}} 이번 틱의 평균 이동 벡터
     */
    updateDoubleUnits(player, now, inputDx, inputDy) {
        if (!player || !player.isDoubleSkin || !Array.isArray(player.doubleUnits)) {
            return { dx: inputDx, dy: inputDy }
        }

        const baseSpeed = getBaseSpeedForPlayer(player)
        const maxBoostSpeed = getMaxBoostedSpeedForPlayer(player)
        const playerBoostScale = getRaiseSpeakiBoostDistanceMultiplier(player)
        const aliveIndices = getDoubleAliveUnitIndices(player)
        if (!aliveIndices.length) {
            return { dx: 0, dy: 0 }
        }

        const isMerged = aliveIndices.length > 1 && player.doubleMerged
        const hasInput = Math.hypot(inputDx, inputDy) > 0.001
        const leadUnit = player.doubleUnits[aliveIndices[0]]
        if (!leadUnit) {
            return { dx: inputDx, dy: inputDy }
        }

        if (player.input.boost && hasInput) {
            aliveIndices.forEach((unitIndex, orderIndex) => {
                const unit = player.doubleUnits[unitIndex]
                if (!unit || unit.boostDisabledUntil > now || unit.collisionRecoveryUntil > now) {
                    return
                }
                if (unit.boostState !== "idle") {
                    return
                }
                let direction = { dx: inputDx, dy: inputDy }
                if (isMerged && aliveIndices.length > 1) {
                    direction = this.rotateVector(
                        inputDx,
                        inputDy,
                        orderIndex === 0 ? -DOUBLE_SEPARATION_ANGLE_RADIANS : DOUBLE_SEPARATION_ANGLE_RADIANS
                    )
                    player.doubleMerged = false
                    player.doubleSeparationPhase = "split"
                    player.doubleMergeLockUntil = now + DOUBLE_REMERGE_LOCK_MS
                    player.doubleSeparatedAt = now
                }
                unit.boostState = "charging"
                unit.boostDirectionX = direction.dx
                unit.boostDirectionY = direction.dy
                unit.currentSpeed = baseSpeed
            })
        }

        aliveIndices.forEach((unitIndex) => {
            const unit = player.doubleUnits[unitIndex]
            if (!unit) {
                return
            }

            let desiredDx = inputDx
            let desiredDy = inputDy
            const doubleIdleStartedAt = Math.max(
                Number(player.doubleSeparatedAt || 0),
                Number(player.lastActiveInputAt || 0)
            )
            const canAutoMergeMove = !hasInput &&
                !player.doubleMerged &&
                aliveIndices.length > 1 &&
                now - doubleIdleStartedAt >= DOUBLE_IDLE_REMERGE_DELAY_MS
            if (canAutoMergeMove) {
                const otherIndex = aliveIndices.find((index) => index !== unitIndex)
                const otherUnit = typeof otherIndex === "number" ? player.doubleUnits[otherIndex] : null
                if (otherUnit) {
                    const diffX = otherUnit.x - unit.x
                    const diffY = otherUnit.y - unit.y
                    const distance = Math.hypot(diffX, diffY)
                    if (distance > 0.001) {
                        desiredDx = diffX / distance
                        desiredDy = diffY / distance
                        unit.currentSpeed = baseSpeed
                    }
                }
            } else if (!player.doubleMerged && aliveIndices.length > 1 && hasInput && unit.boostState === "idle") {
                const otherIndex = aliveIndices.find((index) => index !== unitIndex)
                const otherUnit = typeof otherIndex === "number" ? player.doubleUnits[otherIndex] : null
                if (otherUnit) {
                    const diffX = otherUnit.x - unit.x
                    const diffY = otherUnit.y - unit.y
                    const distance = Math.hypot(diffX, diffY)
                    if (distance > 0.001) {
                        const attractionRatio = Math.max(0, Math.min(1, 1 - (distance / (DOUBLE_MERGED_SIDE_OFFSET * 6))))
                        const steerAngle = DOUBLE_STEER_MIN_RADIANS + (DOUBLE_STEER_MAX_RADIANS - DOUBLE_STEER_MIN_RADIANS) * attractionRatio
                        const inputAngle = Math.atan2(inputDy, inputDx)
                        const attractionAngle = Math.atan2(diffY, diffX)
                        const angleDelta = this.normalizeAngle(attractionAngle - inputAngle)
                        const lateralDistance = Math.abs((-inputDy * diffX) + (inputDx * diffY))
                        if (
                            Math.abs(angleDelta) <= DOUBLE_STEER_DEADZONE_RADIANS ||
                            lateralDistance <= DOUBLE_ALIGNMENT_DEADZONE_DISTANCE
                        ) {
                            desiredDx = inputDx
                            desiredDy = inputDy
                        } else {
                            const appliedAngle = Math.sign(angleDelta || 1) * Math.min(Math.abs(angleDelta), steerAngle)
                            const rotated = this.rotateVector(inputDx, inputDy, appliedAngle)
                            desiredDx = rotated.dx
                            desiredDy = rotated.dy
                        }
                    }
                }
            }

            if (unit.collisionRecoveryUntil > now) {
                const duration = Math.max(1, unit.collisionRecoveryUntil - unit.collisionRecoveryStartedAt)
                const progress = Math.max(0, Math.min(1, (now - unit.collisionRecoveryStartedAt) / duration))
                unit.boostState = "idle"
                unit.currentSpeed = player.collisionSlowSpeed + (baseSpeed - player.collisionSlowSpeed) * progress
            } else if (unit.boostState === "charging") {
                desiredDx = unit.boostDirectionX
                desiredDy = unit.boostDirectionY
                const unitBoostScale = getRaiseSpeakiBoostDistanceMultiplier(unit)
                const unitMaxBoostSpeed = Math.max(
                    baseSpeed,
                    maxBoostSpeed * (unitBoostScale / Math.max(0.0001, playerBoostScale))
                )
                const unitDeltaSpeed = Math.max(0, unitMaxBoostSpeed - baseSpeed)
                const defaultDeltaSpeed = Math.max(0.0001, maxBoostSpeed - baseSpeed)
                const unitBoostAcceleration = BOOST_ACCELERATION_PER_SECOND * (unitDeltaSpeed / defaultDeltaSpeed)
                unit.currentSpeed = Math.min(unitMaxBoostSpeed, unit.currentSpeed + unitBoostAcceleration * TICK_DELTA_SECONDS)
                if (unit.currentSpeed >= unitMaxBoostSpeed) {
                    unit.boostState = "cooldown"
                }
            } else if (unit.boostState === "cooldown") {
                desiredDx = unit.boostDirectionX
                desiredDy = unit.boostDirectionY
                const unitBoostScale = getRaiseSpeakiBoostDistanceMultiplier(unit)
                const unitMaxBoostSpeed = Math.max(
                    baseSpeed,
                    maxBoostSpeed * (unitBoostScale / Math.max(0.0001, playerBoostScale))
                )
                const unitDeltaSpeed = Math.max(0, unitMaxBoostSpeed - baseSpeed)
                const defaultDeltaSpeed = Math.max(0.0001, maxBoostSpeed - baseSpeed)
                const unitBoostCooldown = BOOST_COOLDOWN_PER_SECOND * (unitDeltaSpeed / defaultDeltaSpeed)
                unit.currentSpeed = Math.max(baseSpeed, unit.currentSpeed - unitBoostCooldown * TICK_DELTA_SECONDS)
                if (unit.currentSpeed <= baseSpeed) {
                    unit.currentSpeed = baseSpeed
                    unit.boostState = "idle"
                    unit.boostDirectionX = 0
                    unit.boostDirectionY = 0
                    unit.boostDisabledStartedAt = now
                    unit.boostDisabledUntil = now + USER_POST_BOOST_COOLDOWN_MS
                }
            } else {
                unit.currentSpeed = baseSpeed
            }

            unit.lastMoveX = desiredDx * unit.currentSpeed * TICK_DELTA_SECONDS
            unit.lastMoveY = desiredDy * unit.currentSpeed * TICK_DELTA_SECONDS
            if (Math.abs(desiredDx) > 0.001 || Math.abs(desiredDy) > 0.001) {
                unit.facingAngle = Math.atan2(desiredDy, desiredDx)
            }
            const nextUnitX = unit.x + unit.lastMoveX
            const nextUnitY = unit.y + unit.lastMoveY
            const hitLeftWall = nextUnitX < 0
            const hitRightWall = nextUnitX > WORLD_SIZE
            const hitTopWall = nextUnitY < 0
            const hitBottomWall = nextUnitY > WORLD_SIZE
            unit.x = this.applyWallBouncePosition(nextUnitX, unit.lastMoveX)
            unit.y = this.applyWallBouncePosition(nextUnitY, unit.lastMoveY)

            if (
                (unit.boostState === "charging" || unit.boostState === "cooldown") &&
                (hitLeftWall || hitRightWall || hitTopWall || hitBottomWall)
            ) {
                const hitNormalX = hitLeftWall ? 1 : (hitRightWall ? -1 : 0)
                const hitNormalY = hitTopWall ? 1 : (hitBottomWall ? -1 : 0)
                const collisionVisualUntil = now + COLLISION_VISUAL_BASE_DURATION_MS
                unit.collisionVisualUntil = collisionVisualUntil
                unit.collisionImpactUntil = now + COLLISION_IMPACT_DURATION_MS
                unit.collisionVisualType = "win"
                unit.collisionImpactX = hitNormalX
                unit.collisionImpactY = hitNormalY
                unit.boostState = "idle"
                unit.currentSpeed = player.collisionSlowSpeed
                unit.collisionRecoveryStartedAt = now
                unit.collisionRecoveryUntil = now + COLLISION_RECOVERY_DURATION_MS
                unit.boostDisabledStartedAt = now
                unit.boostDisabledUntil = Math.max(
                    now + COLLISION_BOOST_LOCK_DURATION_MS,
                    Number(collisionVisualUntil || 0)
                )
                unit.boostDirectionX = 0
                unit.boostDirectionY = 0
            }
        })

        if (aliveIndices.length > 1) {
            const unitA = player.doubleUnits[aliveIndices[0]]
            const unitB = player.doubleUnits[aliveIndices[1]]
            const centerX = (unitA.x + unitB.x) / 2
            const centerY = (unitA.y + unitB.y) / 2
            const diffX = unitB.x - unitA.x
            const diffY = unitB.y - unitA.y
            const distance = Math.hypot(diffX, diffY)
            player.x = centerX
            player.y = centerY
            if (player.doubleMerged) {
                player.doubleSeparationPhase = "merged"
                const leadUnit = player.doubleUnits[aliveIndices[0]]
                if (leadUnit && (Math.abs(leadUnit.lastMoveX) > 0.001 || Math.abs(leadUnit.lastMoveY) > 0.001)) {
                    player.facingAngle = Math.atan2(leadUnit.lastMoveY, leadUnit.lastMoveX)
                }
                this.ensureDoubleUnitLayout(player, now)
            } else if (distance <= this.getDoubleMergeThreshold(player) && now >= Number(player.doubleMergeLockUntil || 0)) {
                player.doubleMerged = true
                player.doubleSeparationPhase = "merged"
                player.doubleMergeLockUntil = 0
                player.doubleSeparatedAt = 0
                const leadUnit = player.doubleUnits[aliveIndices[0]]
                if (leadUnit && (Math.abs(leadUnit.lastMoveX) > 0.001 || Math.abs(leadUnit.lastMoveY) > 0.001)) {
                    player.facingAngle = Math.atan2(leadUnit.lastMoveY, leadUnit.lastMoveX)
                }
                this.ensureDoubleUnitLayout(player, now)
            } else {
                player.doubleMerged = false
                player.doubleSeparationPhase = "split"
            }
        } else {
            const liveIndex = aliveIndices[0]
            const liveUnit = player.doubleUnits[liveIndex]
            player.doubleMerged = false
            player.doubleSeparationPhase = "single"
            player.doubleSeparatedAt = Number(player.doubleSeparatedAt || 0)
            player.x = liveUnit.x
            player.y = liveUnit.y
        }

        const averageMoveX = aliveIndices.reduce((sum, unitIndex) => sum + Number(player.doubleUnits[unitIndex].lastMoveX || 0), 0) / aliveIndices.length
        const averageMoveY = aliveIndices.reduce((sum, unitIndex) => sum + Number(player.doubleUnits[unitIndex].lastMoveY || 0), 0) / aliveIndices.length
        const strongestUnit = aliveIndices.reduce((bestUnit, unitIndex) => {
            const unit = player.doubleUnits[unitIndex]
            if (!bestUnit) {
                return unit
            }
            return Number(unit && unit.currentSpeed || 0) > Number(bestUnit && bestUnit.currentSpeed || 0)
                ? unit
                : bestUnit
        }, null)
        const mergedBoostState = aliveIndices.some((unitIndex) => {
            const unit = player.doubleUnits[unitIndex]
            return unit && (unit.boostState === "charging" || unit.boostState === "cooldown")
        })
            ? (aliveIndices.some((unitIndex) => player.doubleUnits[unitIndex] && player.doubleUnits[unitIndex].boostState === "charging")
                ? "charging"
                : "cooldown")
            : "idle"
        player.currentSpeed = Math.max(
            getBaseSpeedForPlayer(player),
            Number(strongestUnit && strongestUnit.currentSpeed || getBaseSpeedForPlayer(player))
        )
        player.boostState = mergedBoostState
        if (mergedBoostState !== "idle" && strongestUnit) {
            player.boostDirectionX = Number(strongestUnit.boostDirectionX || 0)
            player.boostDirectionY = Number(strongestUnit.boostDirectionY || 0)
        } else {
            player.boostDirectionX = 0
            player.boostDirectionY = 0
        }
        return {
            dx: averageMoveX,
            dy: averageMoveY
        }
    },

    /**
     * 분리 직후 패배 보호 상태인지 확인한다.
     * 더블 스킨 플레이어는 doubleDefeatProtectedUntil, 일반 플레이어는 splitDefeatProtectedUntil을 확인한다.
     * 동일한 공격자에 의한 연속 패배를 방지하기 위해 공격자 ID도 검증한다.
     * @param {object} player - 보호 상태를 확인할 플레이어 객체
     * @param {object} attacker - 공격한 플레이어 객체
     * @param {number} now - 현재 타임스탬프(ms)
     * @returns {boolean} 보호 상태이면 true
     */
    isSplitDefeatProtected(player, attacker, now) {
        if (!player || !attacker) {
            return false
        }
        const attackerId = String(attacker.id || "")
        if (!attackerId) {
            return false
        }
        if (player.isDoubleSkin) {
            return (
                Number(player.doubleDefeatProtectedUntil || 0) > now &&
                String(player.doubleDefeatProtectedById || "") === attackerId
            )
        }
        return (
            Number(player.splitDefeatProtectedUntil || 0) > now &&
            String(player.splitDefeatProtectedById || "") === attackerId
        )
    },

    /**
     * 더블 스킨 플레이어의 피격/패배 처리(유닛 체력 감소 또는 전체 패배)를 수행한다.
     * merged 상태에서 일정 확률로 split만 하고 체력 1을 감소시키며 분리 바운스를 적용한다.
     * 체력이 0이 된 유닛은 비활성화되고, 모든 유닛이 소진되면 triggerPlayerDeath를 호출한다.
     * @param {object} player - 피격된 더블 스킨 플레이어 객체
     * @param {number} now - 현재 타임스탬프(ms)
     * @param {number} normalX - 충돌 법선 벡터 X 성분
     * @param {number} normalY - 충돌 법선 벡터 Y 성분
     * @param {object|null} [defeatedByPlayer=null] - 피격을 가한 플레이어 객체
     * @param {number|null} [splitBounceMagnitude=null] - 분리 시 바운스 크기
     * @returns {boolean} 처리가 수행되었으면 true, 처리 불가 시 false
     */
    applyDoubleSkinDefeat(player, now, normalX, normalY, defeatedByPlayer = null, splitBounceMagnitude = null) {
        if (!player || !player.isDoubleSkin) {
            return false
        }

        const aliveIndices = getDoubleAliveUnitIndices(player)
        if (!aliveIndices.length) {
            return false
        }
        if (aliveIndices.length > 1 && Number(player.doubleDefeatProtectedUntil || 0) > now) {
            if (defeatedByPlayer && String(player.doubleDefeatProtectedById || "") === String(defeatedByPlayer.id || "")) {
                return true
            }
        }

        let hitUnitIndex = aliveIndices.length === 1
            ? aliveIndices[0]
            : this.getDoubleHitUnitIndex(player, normalX, normalY)
        if (aliveIndices.length > 1 && !player.doubleMerged && defeatedByPlayer) {
            let nearestUnitIndex = hitUnitIndex
            let nearestDistance = Infinity
            aliveIndices.forEach((unitIndex) => {
                const unit = player.doubleUnits[unitIndex]
                if (!unit || Number(unit.health || 0) <= 0) {
                    return
                }
                const distance = Math.hypot(
                    Number(unit.x || player.x || 0) - Number(defeatedByPlayer.x || 0),
                    Number(unit.y || player.y || 0) - Number(defeatedByPlayer.y || 0)
                )
                if (distance < nearestDistance) {
                    nearestDistance = distance
                    nearestUnitIndex = unitIndex
                }
            })
            hitUnitIndex = nearestUnitIndex
        }
        const targetUnit = player.doubleUnits[hitUnitIndex] && Number(player.doubleUnits[hitUnitIndex].health || 0) > 0
            ? player.doubleUnits[hitUnitIndex]
            : player.doubleUnits[aliveIndices[0]]
        if (!targetUnit || Number(targetUnit.health || 0) <= 0) {
            return false
        }
        // 쌍핔이도 기본 스핔이와 같은 충돌 후 정지/감속 흐름을 탄다.
        aliveIndices.forEach((unitIndex) => {
            const unit = player.doubleUnits[unitIndex]
            if (!unit) {
                return
            }
            unit.boostState = "idle"
            unit.currentSpeed = player.currentSpeed
            unit.collisionRecoveryStartedAt = player.collisionRecoveryStartedAt
            unit.collisionRecoveryUntil = player.collisionRecoveryUntil
            unit.boostDisabledStartedAt = player.boostDisabledStartedAt
            unit.boostDisabledUntil = player.boostDisabledUntil
        })

        const shouldSplitOnly = aliveIndices.length > 1 &&
            player.doubleMerged &&
            Math.random() < DOUBLE_SPLIT_PROBABILITY
        if (shouldSplitOnly) {
            targetUnit.health = Math.max(0, Number(targetUnit.health || 0) - 1)
            targetUnit.collisionVisualType = "defeat"
            targetUnit.collisionVisualUntil = player.collisionVisualUntil
            targetUnit.collisionImpactUntil = player.collisionImpactUntil
            targetUnit.collisionImpactX = player.collisionImpactX
            targetUnit.collisionImpactY = player.collisionImpactY
            player.doubleMerged = false
            player.doubleSeparationPhase = "split"
            player.doubleMergeLockUntil = now + DOUBLE_REMERGE_LOCK_MS
            player.doubleSeparatedAt = now
            player.doubleDefeatProtectedUntil = now + SPLIT_DEFEAT_PROTECTION_MS
            player.doubleDefeatProtectedById = defeatedByPlayer ? String(defeatedByPlayer.id || "") : ""
            const angle = typeof player.facingAngle === "number" ? player.facingAngle : 0
            const sideX = -Math.sin(angle)
            const sideY = Math.cos(angle)
            const unitA = player.doubleUnits[aliveIndices[0]]
            const unitB = player.doubleUnits[aliveIndices[1]]
            unitA.x = this.clampToWorld(player.x - sideX * DOUBLE_MERGED_SIDE_OFFSET * 1.3)
            unitA.y = this.clampToWorld(player.y - sideY * DOUBLE_MERGED_SIDE_OFFSET * 1.3)
            unitB.x = this.clampToWorld(player.x + sideX * DOUBLE_MERGED_SIDE_OFFSET * 1.3)
            unitB.y = this.clampToWorld(player.y + sideY * DOUBLE_MERGED_SIDE_OFFSET * 1.3)
            const appliedSplitBounceMagnitude = Math.max(
                0,
                Number(splitBounceMagnitude || 0) * 0.7 * (defeatedByPlayer && defeatedByPlayer.isNpc ? NPC_DEFEAT_BOUNCE_MULTIPLIER : 1)
            )
            const oppositeNormalX = -normalX
            const oppositeNormalY = -normalY
            const leftBounce = this.rotateVector(oppositeNormalX, oppositeNormalY, -(40 * Math.PI / 180))
            const rightBounce = this.rotateVector(oppositeNormalX, oppositeNormalY, (40 * Math.PI / 180))
            const unitABounceX = leftBounce.dx
            const unitABounceY = leftBounce.dy
            const unitBBounceX = rightBounce.dx
            const unitBBounceY = rightBounce.dy
            const unitABounceDistance = Math.hypot(unitABounceX, unitABounceY) || 1
            const unitBBounceDistance = Math.hypot(unitBBounceX, unitBBounceY) || 1
            unitA.lastMoveX = (unitABounceX / unitABounceDistance) * appliedSplitBounceMagnitude
            unitA.lastMoveY = (unitABounceY / unitABounceDistance) * appliedSplitBounceMagnitude
            unitB.lastMoveX = (unitBBounceX / unitBBounceDistance) * appliedSplitBounceMagnitude
            unitB.lastMoveY = (unitBBounceY / unitBBounceDistance) * appliedSplitBounceMagnitude
            unitA.x = this.clampToWorld(unitA.x + unitA.lastMoveX * 0.35)
            unitA.y = this.clampToWorld(unitA.y + unitA.lastMoveY * 0.35)
            unitB.x = this.clampToWorld(unitB.x + unitB.lastMoveX * 0.35)
            unitB.y = this.clampToWorld(unitB.y + unitB.lastMoveY * 0.35)
            this.recenterDoublePlayer(player)
            return true
        }

        targetUnit.health = Math.max(0, Number(targetUnit.health || 0) - 1)
        targetUnit.collisionVisualType = "defeat"
        targetUnit.collisionVisualUntil = player.collisionVisualUntil
        targetUnit.collisionImpactUntil = player.collisionImpactUntil
        targetUnit.collisionImpactX = normalX
        targetUnit.collisionImpactY = normalY
        targetUnit.collisionRecoveryStartedAt = now
        targetUnit.collisionRecoveryUntil = player.collisionRecoveryUntil
        targetUnit.boostState = "idle"
        targetUnit.currentSpeed = player.currentSpeed
        targetUnit.boostDisabledStartedAt = player.boostDisabledStartedAt
        targetUnit.boostDisabledUntil = player.boostDisabledUntil
        if (aliveIndices.length > 1) {
            player.doubleDefeatProtectedUntil = Math.max(
                now + COLLISION_IMPACT_DURATION_MS,
                Number(player.collisionRecoveryUntil || 0)
            )
            player.doubleDefeatProtectedById = defeatedByPlayer ? String(defeatedByPlayer.id || "") : ""
        } else {
            player.doubleDefeatProtectedUntil = 0
            player.doubleDefeatProtectedById = ""
        }

        if (targetUnit.health <= 0) {
            targetUnit.inactiveUntil = now + DOUBLE_INACTIVE_FADE_MS
        }

        const stillAlive = getDoubleAliveUnitIndices(player)
        if (!stillAlive.length) {
            this.triggerPlayerDeath(player, now, defeatedByPlayer)
            return true
        }
        if (stillAlive.length === 1) {
            player.doubleMerged = false
            player.doubleSeparationPhase = "single"
            player.doubleMergeLockUntil = 0
            player.doubleSeparatedAt = now
        }
        if (Number(player.doubleSplitProtectedUntil || 0) <= now) {
            player.doubleSplitProtectedById = ""
        }
        if (Number(player.doubleDefeatProtectedUntil || 0) <= now) {
            player.doubleDefeatProtectedById = ""
        }
        return true
    },
}
