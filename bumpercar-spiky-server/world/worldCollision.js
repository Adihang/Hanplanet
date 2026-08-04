/**
 * worldCollision.js — 충돌 감지·해소 믹스인
 *
 * 플레이어 간 AABB/원형 충돌 검사, 벽 충돌 처리, 충돌 슬로우·비주얼 효과 적용을 담당한다.
 * isPlayerDead / isPlayerDeathAnimating 도 이 파일에 정의하며
 * 충돌 처리 중 사망 여부를 직접 확인하기 위해 같은 모듈에 둔다.
 * resolvePlayerCollisions 가 매 틱 마지막에 호출되어 모든 충돌을 일괄 처리한다.
 */
const { WORLD_SIZE } = require("../config/config")
const {
    PLAYER_COLLISION_HALF_HEIGHT,
    PLAYER_COLLISION_HALF_WIDTH,
    PUMPKIN_PLAYER_COLLISION_SCALE,
    PUMPKIN_NPC_COLLISION_WIDTH_SCALE,
    PUMPKIN_NPC_COLLISION_HEIGHT_SCALE,
    NPC_COLLISION_HALF_HEIGHT,
    NPC_COLLISION_HALF_WIDTH,
    COLLISION_BOUNCE_DISTANCE,
    COLLISION_SPEED_BOUNCE_MULTIPLIER,
    COLLISION_MAX_BOUNCE_DISTANCE,
    WALL_BOUNCE_DISTANCE,
    WALL_BOUNCE_SPEED_BOUNCE_MULTIPLIER,
    WALL_MAX_BOUNCE_DISTANCE,
    COLLISION_VISUAL_BASE_DURATION_MS,
    COLLISION_IMPACT_DURATION_MS,
    COLLISION_VISUAL_SPEED_DURATION_MULTIPLIER_MS,
    COLLISION_VISUAL_MAX_DURATION_MS,
    COLLISION_RECOVERY_DURATION_MS,
    COLLISION_BOOST_LOCK_DURATION_MS,
    COLLISION_ATTACK_DIRECTION_THRESHOLD,
    HOUSE_COLLISION_HALF_WIDTH,
    HOUSE_COLLISION_HALF_HEIGHT,
    HOUSE_COLLISION_POLYGON,
    NPC_DEFEAT_BOUNCE_MULTIPLIER,
    NPC_REST_DURATION_MS,
} = require("../config/constants")
const {
    isPumpkinSkinPlayer,
    isClassicDefaultPlayer,
    isSingleDoublePlayer,
    isPersistentHumanPlayer,
    isPlayerAttackingForCollision,
    isUserBoostAttacking,
    getPlayerDeathTriggerCount,
    getNpcBaseSpeed,
} = require("./worldHelpers")
const { DUMMY_BASE_SPEED_PER_SECOND } = require("./worldSettings")
const { postStatsUpdate } = require("../services/accountStats")

module.exports = {
    /**
     * 값을 [0, WORLD_SIZE] 범위로 클램프한다.
     * @param {number} value - 클램프할 값
     * @returns {number} 클램프된 값
     */
    clampToWorld(value) {
        return Math.max(0, Math.min(WORLD_SIZE, value))
    },

    /**
     * 벽 충돌 시 밀려나는 거리를 계산한다.
     * 이동 델타가 클수록 더 멀리 튕겨난다.
     * @param {number} moveDelta - 벽을 넘은 이동량
     * @returns {number} 벽 바운스 거리
     */
    getWallBounceDistance(moveDelta) {
        return Math.min(
            WALL_MAX_BOUNCE_DISTANCE,
            WALL_BOUNCE_DISTANCE + Math.abs(moveDelta) * WALL_BOUNCE_SPEED_BOUNCE_MULTIPLIER
        )
    },

    /**
     * 벽을 넘은 좌표를 바운스 위치로 보정한다.
     * @param {number} nextValue - 이동 후 좌표값
     * @param {number} moveDelta - 해당 축의 이동량
     * @returns {number} 보정된 좌표값
     */
    applyWallBouncePosition(nextValue, moveDelta) {
        if (nextValue < 0) {
            return this.clampToWorld(this.getWallBounceDistance(moveDelta))
        }
        if (nextValue > WORLD_SIZE) {
            return this.clampToWorld(WORLD_SIZE - this.getWallBounceDistance(moveDelta))
        }
        return nextValue
    },

    /**
     * 부스트 중 벽에 충돌했을 때 속도/상태를 처리한다.
     * NPC·더미·펌킨 스킨 플레이어 각각의 특수 처리를 포함한다.
     * @param {Player} player - 벽에 충돌한 플레이어
     * @param {number} now - 현재 타임스탬프 (ms)
     * @param {number} hitNormalX - 충돌 법선 X 성분
     * @param {number} hitNormalY - 충돌 법선 Y 성분
     */
    handleWallBoostCollision(player, now, hitNormalX, hitNormalY) {
        if (!player) {
            return
        }

        const collisionVisualUntil = now + COLLISION_VISUAL_BASE_DURATION_MS
        player.collisionVisualUntil = collisionVisualUntil
        player.collisionImpactUntil = now + COLLISION_IMPACT_DURATION_MS
        player.collisionVisualType = "win"
        player.npcDefeatDamageRatio = 0
        player.collisionImpactX = hitNormalX
        player.collisionImpactY = hitNormalY

        if (player.isNpc) {
            player.npcState = "rest"
            player.npcRestUntil = now + NPC_REST_DURATION_MS
            player.npcTargetId = ""
            player.npcChargeDistanceRemaining = 0
            player.npcChargeDistanceTotal = 0
            player.npcChargeWindupStartedAt = 0
            player.npcChargeWindupUntil = 0
            player.npcQueuedExtraCharges = 0
            player.boostState = "idle"
            player.currentSpeed = getNpcBaseSpeed(player)
            player.boostDirectionX = 0
            player.boostDirectionY = 0
            return
        }

        if (player.isDummy) {
            if (isPumpkinSkinPlayer(player)) {
                this.applyPumpkinSkinBoostSplit(
                    player,
                    now,
                    hitNormalX,
                    hitNormalY,
                    this.getWallBounceDistance(Math.max(Math.abs(player.lastMoveX || 0), Math.abs(player.lastMoveY || 0)))
                )
            }
            player.boostState = "idle"
            player.currentSpeed = DUMMY_BASE_SPEED_PER_SECOND
            player.boostDirectionX = 0
            player.boostDirectionY = 0
            player.dummyChargeDistanceRemaining = 0
            player.dummyChargeDistanceTotal = 0
            player.dummyState = "chase"
            player.dummyChargeWindupStartedAt = 0
            player.dummyChargeWindupUntil = 0
            player.dummyRestUntil = 0
            player.dummyQueuedExtraCharges = 0
            return
        }

        if (isPumpkinSkinPlayer(player)) {
            this.applyPumpkinSkinBoostSplit(
                player,
                now,
                hitNormalX,
                hitNormalY,
                this.getWallBounceDistance(Math.max(Math.abs(player.lastMoveX || 0), Math.abs(player.lastMoveY || 0)))
            )
        }
        this.applyCollisionSlow(player, now, collisionVisualUntil)
    },

    /**
     * 플레이어 종류에 따른 충돌 반폭/반높이를 반환한다.
     * 하우스, NPC, 펌킨 NPC, 펌킨 스킨, 일반 플레이어 순서로 판별한다.
     * @param {Player} player - 크기를 조회할 플레이어
     * @returns {{ halfWidth: number, halfHeight: number }} 충돌 박스 반폭·반높이
     */
    getCollisionHalfExtents(player) {
        // 현재는 유저/네르만 다른 충돌 크기를 가진다.
        if (player && player.isHouse) {
            return {
                halfWidth: HOUSE_COLLISION_HALF_WIDTH,
                halfHeight: HOUSE_COLLISION_HALF_HEIGHT,
            }
        }
        if (player && player.isNpc) {
            return {
                halfWidth: NPC_COLLISION_HALF_WIDTH,
                halfHeight: NPC_COLLISION_HALF_HEIGHT
            }
        }
        if (player && player.isPumpkinNpc) {
            return {
                halfWidth: PLAYER_COLLISION_HALF_WIDTH * PUMPKIN_NPC_COLLISION_WIDTH_SCALE,
                halfHeight: PLAYER_COLLISION_HALF_HEIGHT * PUMPKIN_NPC_COLLISION_HEIGHT_SCALE
            }
        }
        if (player && isPumpkinSkinPlayer(player)) {
            return {
                halfWidth: PLAYER_COLLISION_HALF_WIDTH * PUMPKIN_PLAYER_COLLISION_SCALE,
                halfHeight: PLAYER_COLLISION_HALF_HEIGHT * PUMPKIN_PLAYER_COLLISION_SCALE
            }
        }

        return {
            halfWidth: PLAYER_COLLISION_HALF_WIDTH,
            halfHeight: PLAYER_COLLISION_HALF_HEIGHT
        }
    },

    /**
     * 단일 플레이어의 특정 방향 충돌 반지름을 반환한다.
     * 회전된 둥근 직사각형을 방향 벡터로 투영해 유효 반지름을 계산한다.
     * @param {Player} player - 반지름을 계산할 플레이어
     * @param {number} normalX - 방향 법선 X 성분
     * @param {number} normalY - 방향 법선 Y 성분
     * @param {number|null} [angleOverride=null] - 회전 각도 재정의 (null이면 player.facingAngle 사용)
     * @returns {number} 해당 방향의 충돌 반지름
     */
    getSingleCollisionDirectionRadius(player, normalX, normalY, angleOverride = null) {
        if (player && player.isHouse) {
            return this.getHouseCollisionDirectionRadius(normalX, normalY)
        }
        // 회전된 둥근 직사각형을 한 방향에서 바라본 "유효 반지름"으로 바꿔서
        // 방향별 충돌 거리 계산에 사용한다.
        const { halfWidth, halfHeight } = this.getCollisionHalfExtents(player)
        const angle = angleOverride === null
            ? (player && typeof player.facingAngle === "number" ? player.facingAngle : 0)
            : angleOverride
        const localXAxisX = Math.cos(angle)
        const localXAxisY = Math.sin(angle)
        const localYAxisX = -Math.sin(angle)
        const localYAxisY = Math.cos(angle)
        const localX = normalX * localXAxisX + normalY * localXAxisY
        const localY = normalX * localYAxisX + normalY * localYAxisY
        const cornerRadius = Math.min(halfWidth, halfHeight) * 0.28
        const innerHalfWidth = Math.max(0, halfWidth - cornerRadius)
        const innerHalfHeight = Math.max(0, halfHeight - cornerRadius)

        return (Math.abs(localX) * innerHalfWidth) + (Math.abs(localY) * innerHalfHeight) + cornerRadius
    },

    /**
     * 하우스의 폴리곤 기반 방향 충돌 반지름을 반환한다.
     * HOUSE_COLLISION_POLYGON 의 각 꼭짓점을 법선 방향으로 투영한 최대값을 반환한다.
     * @param {number} normalX - 방향 법선 X 성분
     * @param {number} normalY - 방향 법선 Y 성분
     * @returns {number} 해당 방향의 하우스 충돌 반지름
     */
    getHouseCollisionDirectionRadius(normalX, normalY) {
        let bestProjection = 0
        HOUSE_COLLISION_POLYGON.forEach((vertex) => {
            const vx = vertex.x * HOUSE_COLLISION_HALF_WIDTH * 2
            const vy = vertex.y * HOUSE_COLLISION_HALF_HEIGHT * 2
            const projection = (vx * normalX) + (vy * normalY)
            if (projection > bestProjection) {
                bestProjection = projection
            }
        })
        return bestProjection
    },

    /**
     * 플레이어 종류에 따라 적합한 방향 충돌 반지름을 반환한다.
     * 내부적으로 getSingleCollisionDirectionRadius 에 위임한다.
     * @param {Player} player - 반지름을 계산할 플레이어
     * @param {number} normalX - 방향 법선 X 성분
     * @param {number} normalY - 방향 법선 Y 성분
     * @returns {number} 해당 방향의 충돌 반지름
     */
    getCollisionDirectionRadius(player, normalX, normalY) {
        return this.getSingleCollisionDirectionRadius(player, normalX, normalY)
    },

    /**
     * 플레이어의 기본 충돌 반지름을 반환한다.
     * halfWidth 와 halfHeight 중 큰 값을 사용한다.
     * @param {Player} player - 반지름을 계산할 플레이어
     * @returns {number} 플레이어의 충돌 반지름
     */
    getCollisionRadius(player) {
        const { halfWidth, halfHeight } = this.getCollisionHalfExtents(player)
        return Math.max(halfWidth, halfHeight)
    },

    /**
     * 플레이어가 사망 상태(deathUntil != 0)인지 반환한다.
     * @param {Player} player - 확인할 플레이어
     * @returns {boolean} 사망 상태이면 true
     */
    isPlayerDead(player) {
        return Boolean(player) && player.deathUntil !== 0
    },

    /**
     * 플레이어가 사망 애니메이션 중인지 반환한다.
     * @param {Player} player - 확인할 플레이어
     * @param {number} [now=Date.now()] - 현재 타임스탬프 (ms)
     * @returns {boolean} 사망 애니메이션 중이면 true
     */
    isPlayerDeathAnimating(player, now = Date.now()) {
        return Boolean(player) && player.deathUntil > now
    },

    /**
     * 충돌 후 속도 감속과 회복 타이머를 적용한다.
     * defeat 충돌은 recovery 시간이 1.2배 길어지며, 부스트 잠금도 함께 설정한다.
     * @param {Player} player - 감속을 적용할 플레이어
     * @param {number} now - 현재 타임스탬프 (ms)
     * @param {number} recoveryUntil - 시각 효과 종료 시각 (부스트 잠금 기준)
     */
    applyCollisionSlow(player, now, recoveryUntil) {
        if (!player || player.isNpc || this.isPlayerDead(player)) {
            return
        }

        // 인간 유저는 충돌 직후 잠시 느려지지만, 돌진 잠금은 시각 효과 종료까지 유지한다.
        const collisionRecoveryMs = player.collisionVisualType === "defeat"
            ? Math.round(COLLISION_RECOVERY_DURATION_MS * 1.2)
            : COLLISION_RECOVERY_DURATION_MS
        const resolvedRecoveryUntil = now + collisionRecoveryMs
        const resolvedBoostDisabledUntil = Math.max(now + COLLISION_BOOST_LOCK_DURATION_MS, Number(recoveryUntil || 0))
        player.boostState = "idle"
        player.input.boost = false
        player.currentSpeed = player.collisionSlowSpeed
        player.collisionRecoveryStartedAt = now
        player.collisionRecoveryUntil = resolvedRecoveryUntil
        player.boostDisabledStartedAt = now
        player.boostDisabledUntil = resolvedBoostDisabledUntil
        player.npcChargeWindupStartedAt = 0
        player.npcChargeWindupUntil = 0

        // 더블 스핔이는 본체와 각 유닛이 돌진 상태를 별도로 보관한다.
        // 본체만 정지시키면 유닛이 다음 틱에도 기존 돌진 방향으로 움직이므로,
        // 살아 있는 유닛에도 동일한 충돌 정지/감속 잠금을 적용한다.
        if (player.isDoubleSkin && Array.isArray(player.doubleUnits)) {
            player.doubleUnits.forEach((unit) => {
                if (!unit || Number(unit.health || 0) <= 0) {
                    return
                }
                unit.boostState = "idle"
                unit.boostDirectionX = 0
                unit.boostDirectionY = 0
                unit.currentSpeed = player.collisionSlowSpeed
                unit.collisionRecoveryStartedAt = now
                unit.collisionRecoveryUntil = resolvedRecoveryUntil
                unit.boostDisabledStartedAt = now
                unit.boostDisabledUntil = resolvedBoostDisabledUntil
            })
        }
    },

    /**
     * 두 플레이어 간 충돌 분리 비율을 반환한다.
     * NPC가 포함된 경우 유저 쪽으로 더 많이 밀려나도록 비율이 조정된다.
     * @param {Player} playerA - 첫 번째 플레이어
     * @param {Player} playerB - 두 번째 플레이어
     * @returns {{ pushA: number, pushB: number, totalScale: number }} 분리 비율 프로파일
     */
    getCollisionSeparationProfile(playerA, playerB) {
        if (playerA.isNpc && !playerB.isNpc) {
            return { pushA: 1 / 3, pushB: 2 / 3, totalScale: 1.8 }
        }
        if (!playerA.isNpc && playerB.isNpc) {
            return { pushA: 2 / 3, pushB: 1 / 3, totalScale: 1.8 }
        }
        if (playerA.isDoubleSkin || playerB.isDoubleSkin) {
            return { pushA: 1 / 2, pushB: 1 / 2, totalScale: 2.25 }
        }
        return { pushA: 1 / 2, pushB: 1 / 2, totalScale: 1.5 }
    },

    /**
     * 두 플레이어를 표준 충돌 공식으로 튕겨낸다.
     * 상대 충돌 속도로 바운스 거리와 시각 효과 지속 시간을 결정하고, 분리 비율에 따라 밀어낸다.
     * @param {Player} playerA - 첫 번째 플레이어
     * @param {Player} playerB - 두 번째 플레이어
     * @param {number} now - 현재 타임스탬프 (ms)
     * @param {number} normalX - A→B 방향 법선 X 성분
     * @param {number} normalY - A→B 방향 법선 Y 성분
     * @param {number} overlap - 두 충돌체의 겹침 거리
     * @param {boolean} [playerAAttacking=false] - A가 공격 중인지 여부
     * @param {boolean} [playerBAttacking=false] - B가 공격 중인지 여부
     */
    applyStandardCollisionBounce(playerA, playerB, now, normalX, normalY, overlap, playerAAttacking = false, playerBAttacking = false) {
        const relativeMoveX = playerB.lastMoveX - playerA.lastMoveX
        const relativeMoveY = playerB.lastMoveY - playerA.lastMoveY
        const relativeImpactSpeed = Math.max(
            0,
            -(relativeMoveX * normalX + relativeMoveY * normalY)
        )
        const bounceDistance = Math.min(
            COLLISION_MAX_BOUNCE_DISTANCE,
            COLLISION_BOUNCE_DISTANCE + relativeImpactSpeed * COLLISION_SPEED_BOUNCE_MULTIPLIER
        )
        const separation = overlap / 2 + bounceDistance
        const separationProfile = this.getCollisionSeparationProfile(playerA, playerB)
        const scaledSeparation = separation * separationProfile.totalScale
        const collisionVisualDuration = Math.min(
            COLLISION_VISUAL_MAX_DURATION_MS,
            COLLISION_VISUAL_BASE_DURATION_MS +
                relativeImpactSpeed * COLLISION_VISUAL_SPEED_DURATION_MULTIPLIER_MS
        )
        const collisionVisualUntil = now + collisionVisualDuration
        const collisionImpactUntil = now + COLLISION_IMPACT_DURATION_MS

        playerA.collisionVisualUntil = collisionVisualUntil
        playerB.collisionVisualUntil = collisionVisualUntil
        playerA.collisionImpactUntil = collisionImpactUntil
        playerB.collisionImpactUntil = collisionImpactUntil
        playerA.collisionVisualType = "win"
        playerB.collisionVisualType = "win"
        playerA.npcDefeatDamageRatio = 0
        playerB.npcDefeatDamageRatio = 0
        playerA.collisionImpactX = -normalX
        playerA.collisionImpactY = -normalY
        playerB.collisionImpactX = normalX
        playerB.collisionImpactY = normalY

        this.applyCollisionSlow(playerA, now, collisionVisualUntil)
        this.applyCollisionSlow(playerB, now, collisionVisualUntil)

        let pushRatioA = separationProfile.pushA
        let pushRatioB = separationProfile.pushB
        if (playerA.isNpc && !playerAAttacking && !playerBAttacking) {
            pushRatioA = 0
            pushRatioB = 1
        } else if (playerB.isNpc && !playerAAttacking && !playerBAttacking) {
            pushRatioA = 1
            pushRatioB = 0
        }

        this.applyCollisionPush(playerA, -normalX, -normalY, scaledSeparation * pushRatioA)
        this.applyCollisionPush(playerB, normalX, normalY, scaledSeparation * pushRatioB)
    },

    /**
     * 매 틱 모든 플레이어 쌍을 순회해 충돌을 해소한다.
     * 펌킨 NPC, 하우스, NPC 간, 일반 플레이어 순으로 각기 다른 충돌 처리를 적용한다.
     */
    resolvePlayerCollisions() {
        const players = Array.from(this.players.values())
        const now = Date.now()

        // 단순 N^2 루프지만 현재 엔티티 수가 작아서 유지 가능한 구조다.
        for (let index = 0; index < players.length; index += 1) {
            const playerA = players[index]
            if (this.isPlayerDead(playerA)) {
                continue
            }

            for (let innerIndex = index + 1; innerIndex < players.length; innerIndex += 1) {
                const playerB = players[innerIndex]
                if (this.isPlayerDead(playerB)) {
                    continue
                }

                const collisionPointA = this.getCollisionReferencePoint(playerA, Number(playerB.x || 0), Number(playerB.y || 0))
                const collisionPointB = this.getCollisionReferencePoint(playerB, Number(playerA.x || 0), Number(playerA.y || 0))
                let diffX = collisionPointB.x - collisionPointA.x
                let diffY = collisionPointB.y - collisionPointA.y
                let distance = Math.hypot(diffX, diffY)

                if (distance < 0.0001) {
                    diffX = playerB.lastMoveX - playerA.lastMoveX
                    diffY = playerB.lastMoveY - playerA.lastMoveY
                    distance = Math.hypot(diffX, diffY)
                }

                if (distance < 0.0001) {
                    diffX = index % 2 === 0 ? 1 : -1
                    diffY = innerIndex % 2 === 0 ? 1 : -1
                    distance = Math.hypot(diffX, diffY)
                }

                const normalX = diffX / distance
                const normalY = diffY / distance
                // 양쪽 충돌체의 방향별 반지름을 더해 실제 충돌 임계 거리를 만든다.
                const collisionDistance =
                    this.getCollisionDirectionRadius(playerA, normalX, normalY) +
                    this.getCollisionDirectionRadius(playerB, -normalX, -normalY)

                if (distance >= collisionDistance) {
                    continue
                }

                const overlap = collisionDistance - distance

                if (playerA.isPumpkinNpc || playerB.isPumpkinNpc) {
                    const pumpkinPlayer = playerA.isPumpkinNpc ? playerA : playerB
                    const otherPlayer = playerA.isPumpkinNpc ? playerB : playerA
                    if (this.isPumpkinNpcFading(pumpkinPlayer, now)) {
                        continue
                    }
                    if (this.isPumpkinDashProtectedFromPlayer(pumpkinPlayer, otherPlayer, now)) {
                        continue
                    }
                    if ((isClassicDefaultPlayer(otherPlayer) || isSingleDoublePlayer(otherPlayer)) &&
                        this.claimPumpkinNpc(otherPlayer, pumpkinPlayer, now)) {
                        continue
                    }
                    if (this.applyPumpkinNpcDefeat(pumpkinPlayer, otherPlayer, now)) {
                        continue
                    }
                    this.applyStandardCollisionBounce(playerA, playerB, now, normalX, normalY, overlap)
                    continue
                }

                if (playerA.isHouse || playerB.isHouse) {
                    const housePlayer = playerA.isHouse ? playerA : playerB
                    const moverPlayer = playerA.isHouse ? playerB : playerA
                    const hitNormalFromHouseX = playerA.isHouse ? normalX : -normalX
                    const hitNormalFromHouseY = playerA.isHouse ? normalY : -normalY
                    const bounceDistance = Math.min(
                        COLLISION_MAX_BOUNCE_DISTANCE,
                        COLLISION_BOUNCE_DISTANCE + Math.hypot(moverPlayer.lastMoveX || 0, moverPlayer.lastMoveY || 0) * COLLISION_SPEED_BOUNCE_MULTIPLIER
                    )
                    this.applyCollisionPush(moverPlayer, hitNormalFromHouseX, hitNormalFromHouseY, overlap + bounceDistance)
                    moverPlayer.collisionVisualUntil = now + COLLISION_VISUAL_BASE_DURATION_MS
                    moverPlayer.collisionImpactUntil = now + COLLISION_IMPACT_DURATION_MS
                    moverPlayer.collisionVisualType = "win"
                    moverPlayer.collisionImpactX = hitNormalFromHouseX
                    moverPlayer.collisionImpactY = hitNormalFromHouseY
                    this.applyCollisionSlow(moverPlayer, now, moverPlayer.collisionVisualUntil)
                    if (isPumpkinSkinPlayer(moverPlayer) && (moverPlayer.boostState === "charging" || moverPlayer.boostState === "cooldown")) {
                        this.applyPumpkinSkinBoostSplit(moverPlayer, now, hitNormalFromHouseX, hitNormalFromHouseY, overlap + bounceDistance)
                    }

                    if (isPersistentHumanPlayer(moverPlayer) && !moverPlayer.isDummy && !moverPlayer.isNpc) {
                        const damage = this.getUserDamageAgainstNpc(moverPlayer)
                        if (damage > 0) {
                            housePlayer.houseHealth = Math.max(0, Number(housePlayer.houseHealth || 0) - damage)
                            if (housePlayer.houseHealth <= 0) {
                                this.grid.remove(housePlayer)
                                this.players.delete(housePlayer.id)
                                if (housePlayer.houseStage === 1) {
                                    this.beginStageTwoNer(now)
                                } else if (housePlayer.houseStage === 2) {
                                    this.beginStageThreeNer(now)
                                } else if (housePlayer.houseStage === 3) {
                                    this.beginEncounterFinale(now)
                                }
                            }
                        }
                    }
                    continue
                }

                if (playerA.isNpc && playerB.isNpc) {
                    continue
                }

                const relativeMoveX = playerB.lastMoveX - playerA.lastMoveX
                const relativeMoveY = playerB.lastMoveY - playerA.lastMoveY
                const relativeImpactSpeed = Math.max(
                    0,
                    -(relativeMoveX * normalX + relativeMoveY * normalY)
                )
                const bounceDistance = Math.min(
                    COLLISION_MAX_BOUNCE_DISTANCE,
                    COLLISION_BOUNCE_DISTANCE + relativeImpactSpeed * COLLISION_SPEED_BOUNCE_MULTIPLIER
                )
                const separation = overlap / 2 + bounceDistance
                const separationProfile = this.getCollisionSeparationProfile(playerA, playerB)
                const scaledSeparation = separation * separationProfile.totalScale
                const collisionVisualDuration = Math.min(
                    COLLISION_VISUAL_MAX_DURATION_MS,
                    COLLISION_VISUAL_BASE_DURATION_MS +
                        relativeImpactSpeed * COLLISION_VISUAL_SPEED_DURATION_MULTIPLIER_MS
                )
                const collisionVisualUntil = now + collisionVisualDuration
                const collisionImpactUntil = now + COLLISION_IMPACT_DURATION_MS
                const playerAPumpkinBoostSplitting = isPumpkinSkinPlayer(playerA) &&
                    !playerA.isNpc &&
                    !playerA.isDummy &&
                    !playerA.isHouse &&
                    !playerA.isPumpkinNpc &&
                    (playerA.boostState === "charging" || playerA.boostState === "cooldown")
                const playerBPumpkinBoostSplitting = isPumpkinSkinPlayer(playerB) &&
                    !playerB.isNpc &&
                    !playerB.isDummy &&
                    !playerB.isHouse &&
                    !playerB.isPumpkinNpc &&
                    (playerB.boostState === "charging" || playerB.boostState === "cooldown")
                const playerAAttackDot = playerA.lastMoveX * normalX + playerA.lastMoveY * normalY
                const playerBAttackDot = -(playerB.lastMoveX * normalX + playerB.lastMoveY * normalY)
                // "가속한 채 진행 방향으로 박았는지"를 공격 판정으로 사용한다.
                const playerAAttacking = (
                    isPlayerAttackingForCollision(playerA)
                ) && playerAAttackDot > COLLISION_ATTACK_DIRECTION_THRESHOLD
                const playerBAttacking = (
                    isPlayerAttackingForCollision(playerB)
                ) && playerBAttackDot > COLLISION_ATTACK_DIRECTION_THRESHOLD
                const playerAProtectedFromB = this.isSplitDefeatProtected(playerA, playerB, now)
                const playerBProtectedFromA = this.isSplitDefeatProtected(playerB, playerA, now)

                playerA.collisionVisualUntil = collisionVisualUntil
                playerB.collisionVisualUntil = collisionVisualUntil
                playerA.collisionImpactUntil = collisionImpactUntil
                playerB.collisionImpactUntil = collisionImpactUntil
                playerA.collisionVisualType = "win"
                playerB.collisionVisualType = "win"
                playerA.npcDefeatDamageRatio = 0
                playerB.npcDefeatDamageRatio = 0
                playerA.collisionImpactX = -normalX
                playerA.collisionImpactY = -normalY
                playerB.collisionImpactX = normalX
                playerB.collisionImpactY = normalY

                // 공격/피격 결과에 따라 win/defeat 시각 상태와 통계를 기록한다.
                if (playerAAttacking && playerBAttacking) {
                    if (!playerAProtectedFromB) {
                        playerA.collisionVisualType = "defeat"
                        playerA.collisionImpactX = -normalX
                        playerA.collisionImpactY = -normalY
                        if (!playerA.isDoubleSkin) {
                            playerA.defeatReceivedCount += 1
                        }
                        playerB.defeatDealtCount += 1
                        if (playerB.isNpc && isPersistentHumanPlayer(playerA)) {
                            postStatsUpdate(playerA.id, { ner_hits: 1 })
                        }
                    }
                    if (!playerBProtectedFromA) {
                        playerB.collisionVisualType = "defeat"
                        playerB.collisionImpactX = normalX
                        playerB.collisionImpactY = normalY
                        if (!playerB.isDoubleSkin) {
                            playerB.defeatReceivedCount += 1
                        }
                        playerA.defeatDealtCount += 1
                        if (playerA.isNpc && isPersistentHumanPlayer(playerB)) {
                            postStatsUpdate(playerB.id, { ner_hits: 1 })
                        }
                    }
                } else if (playerAAttacking) {
                    if (!playerBProtectedFromA) {
                        playerB.collisionVisualType = "defeat"
                        playerB.collisionImpactX = normalX
                        playerB.collisionImpactY = normalY
                        playerA.defeatDealtCount += 1
                        if (!playerB.isDoubleSkin) {
                            playerB.defeatReceivedCount += 1
                        }
                        if (playerB.isNpc && isPersistentHumanPlayer(playerA)) {
                            postStatsUpdate(playerA.id, { ner_hits: 1 })
                        }
                        if (playerA.isNpc && playerA.npcChargeTargetId === playerB.id) {
                            playerA.npcChargeHitTarget = true
                        }
                        if (playerB.isDummy && !playerA.isNpc && !playerA.isDummy) {
                            playerB.dummyRetaliationTargetId = playerA.id
                        }
                    }
                } else if (playerBAttacking) {
                    if (!playerAProtectedFromB) {
                        playerA.collisionVisualType = "defeat"
                        playerA.collisionImpactX = -normalX
                        playerA.collisionImpactY = -normalY
                        playerB.defeatDealtCount += 1
                        if (!playerA.isDoubleSkin) {
                            playerA.defeatReceivedCount += 1
                        }
                        if (playerA.isNpc && isPersistentHumanPlayer(playerB)) {
                            postStatsUpdate(playerB.id, { ner_hits: 1 })
                        }
                        if (playerB.isNpc && playerB.npcChargeTargetId === playerA.id) {
                            playerB.npcChargeHitTarget = true
                        }
                        if (playerA.isDummy && !playerB.isNpc && !playerB.isDummy) {
                            playerA.dummyRetaliationTargetId = playerB.id
                        }
                    }
                }

                if (playerA.isNpc && !playerB.isNpc && !playerB.isDummy) {
                    this.applyNpcCollisionDamage(playerA, playerB, now)
                }
                if (playerB.isNpc && !playerA.isNpc && !playerA.isDummy) {
                    this.applyNpcCollisionDamage(playerB, playerA, now)
                }

                // 일반 유저만 충돌 직후 느려지고, 네르는 감속 대상에서 제외된다.
                this.applyCollisionSlow(playerA, now, collisionVisualUntil)
                this.applyCollisionSlow(playerB, now, collisionVisualUntil)

                let doubleAHandled = false
                let doubleBHandled = false
                let pumpkinASplitHandled = false
                let pumpkinBSplitHandled = false
                let pumpkinABoostSplitHandled = false
                let pumpkinBBoostSplitHandled = false
                if (playerA.collisionVisualType === "defeat" && playerA.isDoubleSkin) {
                    doubleAHandled = this.applyDoubleSkinDefeat(playerA, now, normalX, normalY, playerB, scaledSeparation)
                }
                if (playerB.collisionVisualType === "defeat" && playerB.isDoubleSkin) {
                    doubleBHandled = this.applyDoubleSkinDefeat(playerB, now, -normalX, -normalY, playerA, scaledSeparation)
                }
                if (playerA.collisionVisualType === "defeat" && isPumpkinSkinPlayer(playerA)) {
                    pumpkinASplitHandled = Boolean(this.applyPumpkinSkinDefeatSplit(playerA, now, -normalX, -normalY, playerB, scaledSeparation))
                }
                if (playerB.collisionVisualType === "defeat" && isPumpkinSkinPlayer(playerB)) {
                    pumpkinBSplitHandled = Boolean(this.applyPumpkinSkinDefeatSplit(playerB, now, normalX, normalY, playerA, scaledSeparation))
                }
                if (!pumpkinASplitHandled &&
                    playerAPumpkinBoostSplitting &&
                    playerA.collisionVisualType === "win" &&
                    isPumpkinSkinPlayer(playerA)) {
                    pumpkinABoostSplitHandled = Boolean(this.applyPumpkinSkinBoostSplit(playerA, now, -normalX, -normalY, scaledSeparation))
                }
                if (!pumpkinBSplitHandled &&
                    playerBPumpkinBoostSplitting &&
                    playerB.collisionVisualType === "win" &&
                    isPumpkinSkinPlayer(playerB)) {
                    pumpkinBBoostSplitHandled = Boolean(this.applyPumpkinSkinBoostSplit(playerB, now, normalX, normalY, scaledSeparation))
                }

                if (playerA.collisionVisualType === "defeat" &&
                    !playerA.isDoubleSkin &&
                    !playerA.isNpc &&
                    playerA.defeatReceivedCount % getPlayerDeathTriggerCount(playerA) === 0) {
                    if (playerA.isDummy) {
                        this.triggerDummyDeath(playerA, now, playerB)
                    } else {
                        this.triggerPlayerDeath(playerA, now, playerB)
                    }
                }
                if (playerB.collisionVisualType === "defeat" &&
                    !playerB.isDoubleSkin &&
                    !playerB.isNpc &&
                    playerB.defeatReceivedCount % getPlayerDeathTriggerCount(playerB) === 0) {
                    if (playerB.isDummy) {
                        this.triggerDummyDeath(playerB, now, playerA)
                    } else {
                        this.triggerPlayerDeath(playerB, now, playerA)
                    }
                }

                // 네르가 공격자로 패배를 만들었을 때는 피격자 반발을 더 크게 준다.
                let pushScaleA = 1
                let pushScaleB = 1
                let pushRatioA = separationProfile.pushA
                let pushRatioB = separationProfile.pushB
                if (playerB.isNpc && playerBAttacking && playerA.collisionVisualType === "defeat") {
                    pushScaleA = NPC_DEFEAT_BOUNCE_MULTIPLIER
                    pushRatioA = 1
                    pushRatioB = 0
                }
                if (playerA.isNpc && playerAAttacking && playerB.collisionVisualType === "defeat") {
                    pushScaleB = NPC_DEFEAT_BOUNCE_MULTIPLIER
                    pushRatioA = 0
                    pushRatioB = 1
                }
                if (playerA.isNpc && !playerAAttacking && !playerBAttacking) {
                    pushRatioA = 0
                    pushRatioB = 1
                } else if (playerB.isNpc && !playerAAttacking && !playerBAttacking) {
                    pushRatioA = 1
                    pushRatioB = 0
                }
                if (doubleAHandled || pumpkinASplitHandled || pumpkinABoostSplitHandled) {
                    pushRatioA = 0
                }
                if (doubleBHandled || pumpkinBSplitHandled || pumpkinBBoostSplitHandled) {
                    pushRatioB = 0
                }

                // 네르-유저 충돌은 유저가 더 멀리 밀려나게 2:1 비율을 적용한다.
                // 네르가 charging 중일 때도 상태를 끊지 않고 현재 돌진을 유지한다.
                this.applyCollisionPush(playerA, -normalX, -normalY, scaledSeparation * pushRatioA * pushScaleA)
                this.applyCollisionPush(playerB, normalX, normalY, scaledSeparation * pushRatioB * pushScaleB)
            }
        }
    },
}
