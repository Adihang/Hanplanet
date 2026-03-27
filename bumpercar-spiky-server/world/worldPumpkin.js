/**
 * worldPumpkin.js — 펌킨 스킨·펌킨 NPC 처리 믹스인
 *
 * 펌킨 스킨 플레이어는 충돌 시 별도의 펌킨 NPC를 드롭하며,
 * 드롭된 펌킨 NPC는 다른 플레이어가 공격해 소유권을 빼앗거나(NTR),
 * 원래 소유자가 회수(claim)할 수 있다.
 * 중립 펌킨 NPC는 소유자 없이 월드에 상시 존재하며 누구나 공격할 수 있다.
 * 펌킨 소유자가 일정 횟수 이상 NTR 당하면 pumpkinEliminated 상태가 된다.
 */
const {
    PUMPKIN_SKIN_NAME,
    DOUBLE_SKIN_NAME,
    DOUBLE_UNIT_HEALTH,
    PUMPKIN_NPC_HEALTH_SEGMENTS,
    PUMPKIN_NPC_DEFEAT_DASH_DURATION_MS,
    PUMPKIN_NPC_DASH_PROTECTION_MS,
    PUMPKIN_NPC_CLAIM_LOCK_MS,
    PUMPKIN_NPC_DAMAGE_INVULNERABLE_MS,
    PUMPKIN_NPC_FADE_OUT_DURATION_MS,
    NEUTRAL_PUMPKIN_SPAWN_PADDING,
    PUMPKIN_NPC_ID_PREFIX,
    SPLIT_DEFEAT_PROTECTION_MS,
    COLLISION_VISUAL_BASE_DURATION_MS,
    COLLISION_IMPACT_DURATION_MS,
    DOUBLE_INACTIVE_FADE_MS,
} = require("../config/constants")
const {
    WORLD_SIZE,
} = require("../config/config")
const {
    getBaseSpeedForPlayer,
    getCollisionSlowSpeedForPlayer,
    isPumpkinSkinPlayer,
    isClassicDefaultPlayer,
    isSingleDoublePlayer,
    getDoubleAliveUnitIndices,
    getSingleDoublePlayerHealth,
    isPersistentHumanPlayer,
    isUserBoostAttacking,
} = require("./worldHelpers")
const {
    PUMPKIN_NPC_DEFEAT_DASH_SPEED_PER_SECOND,
    createDoubleUnitState,
} = require("./worldSettings")
const { NPC_DEFEAT_BOUNCE_MULTIPLIER: _NPC_DEFEAT_BOUNCE_MULTIPLIER } = require("../config/constants")
const Player = require("./player")

module.exports = {
    /**
     * 중립 펌킨 NPC가 스폰될 무작위 위치를 반환한다.
     * 월드 경계에서 일정 패딩만큼 안쪽 범위에서 좌표를 생성한다.
     */
    getRandomNeutralPumpkinSpawnPosition() {
        const padding = Math.max(0, Math.min(NEUTRAL_PUMPKIN_SPAWN_PADDING, WORLD_SIZE / 2 - 1))
        const minAxis = padding
        const maxAxis = Math.max(minAxis, WORLD_SIZE - padding)
        return {
            x: minAxis + Math.random() * Math.max(0, maxAxis - minAxis),
            y: minAxis + Math.random() * Math.max(0, maxAxis - minAxis),
        }
    },

    /**
     * 현재 월드에 존재하는 모든 펌킨 NPC 플레이어 배열을 반환한다.
     */
    getPumpkinPlayers() {
        return Array.from(this.players.values()).filter((player) => player.isPumpkinNpc)
    },

    /**
     * 현재 월드에 존재하는 중립 펌킨 NPC를 반환한다.
     * 없으면 null을 반환한다.
     */
    getNeutralPumpkinNpc() {
        return this.getPumpkinPlayers().find((player) => Boolean(player.isNeutralPumpkinNpc)) || null
    },

    /**
     * 월드에 존재하는 모든 펌킨 NPC 플레이어를 제거한다.
     */
    removePumpkinPlayers() {
        for (const player of Array.from(this.players.values())) {
            if (!player.isPumpkinNpc) {
                continue
            }
            this.grid.remove(player)
            this.players.delete(player.id)
        }
    },

    /**
     * 중립 펌킨 NPC를 스폰한다.
     * 이미 존재하면 기존 인스턴스를 반환하고 새로 스폰하지 않는다.
     */
    spawnNeutralPumpkinNpc() {
        const existingNeutralPumpkin = this.getNeutralPumpkinNpc()
        if (existingNeutralPumpkin) {
            return existingNeutralPumpkin
        }
        const spawnPosition = this.getRandomNeutralPumpkinSpawnPosition()
        const neutralPumpkin = this.spawnPumpkinNpc(spawnPosition, null)
        neutralPumpkin.isNeutralPumpkinNpc = true
        neutralPumpkin.pumpkinOwnerConnectionKey = ""
        neutralPumpkin.pumpkinOriginalOwnerConnectionKey = ""
        return neutralPumpkin
    },

    /**
     * 기존 중립 펌킨 NPC를 제거하고 새 위치에 다시 스폰한다.
     */
    respawnNeutralPumpkinNpc() {
        const existingNeutralPumpkin = this.getNeutralPumpkinNpc()
        if (existingNeutralPumpkin) {
            this.removePumpkinNpc(existingNeutralPumpkin)
        }
        return this.spawnNeutralPumpkinNpc()
    },

    /**
     * 충돌하지 않는 새 펌킨 NPC ID를 생성해 반환한다.
     * PUMPKIN_NPC_ID_PREFIX에 순차 숫자 접미사를 붙인 형태다.
     */
    createPumpkinNpcId() {
        let suffix = 1
        while (this.players.has(`${PUMPKIN_NPC_ID_PREFIX}${suffix}`)) {
            suffix += 1
        }
        return `${PUMPKIN_NPC_ID_PREFIX}${suffix}`
    },

    /**
     * 지정된 위치에 펌킨 NPC를 스폰하고 소유자 정보를 설정한 뒤 반환한다.
     * @param {object} position - 스폰 좌표 { x, y }
     * @param {object|null} ownerPlayer - 소유자 플레이어 객체 (없으면 null)
     */
    spawnPumpkinNpc(position = {}, ownerPlayer = null) {
        const player = new Player(this.createPumpkinNpcId())
        player.skinName = PUMPKIN_SKIN_NAME
        player.isPumpkinSkin = true
        player.isPumpkinNpc = true
        player.x = this.clampToWorld(Number(position.x || 0))
        player.y = this.clampToWorld(Number(position.y || 0))
        player.currentSpeed = 0
        player.baseSpeed = getBaseSpeedForPlayer(player)
        player.collisionSlowSpeed = getCollisionSlowSpeedForPlayer(player)
        player.defeatReceivedCount = 0
        player.pumpkinDashDirectionX = 0
        player.pumpkinDashDirectionY = 0
        player.pumpkinDashStartedAt = 0
        player.pumpkinDashUntil = 0
        player.pumpkinDashProtectedUntil = 0
        player.pumpkinDashProtectedById = ""
        player.pumpkinClaimLockedUntil = 0
        player.pumpkinClaimLockedById = ""
        player.pumpkinInvulnerableUntil = 0
        player.pumpkinFadeOutStartedAt = 0
        player.pumpkinFadeOutUntil = 0
        const originalOwnerConnectionKey = String(
            ownerPlayer && (ownerPlayer.pumpkinOriginalOwnerConnectionKey || ownerPlayer.pumpkinOwnerConnectionKey || ownerPlayer.connectionKey) || ""
        ).trim()
        player.pumpkinOwnerConnectionKey = originalOwnerConnectionKey
        player.pumpkinOriginalOwnerConnectionKey = originalOwnerConnectionKey
        player.isNeutralPumpkinNpc = !originalOwnerConnectionKey
        player.pumpkinDroppedByPlayerId = String(ownerPlayer && ownerPlayer.id || "").trim()
        this.players.set(player.id, player)
        this.grid.add(player)
        return player
    },

    /**
     * 펌킨 NPC를 월드에서 제거한다.
     * 인자가 펌킨 NPC가 아니면 아무 동작도 하지 않는다.
     * @param {object} player - 제거할 펌킨 NPC 플레이어 객체
     */
    removePumpkinNpc(player) {
        if (!player || !player.isPumpkinNpc) {
            return
        }
        this.grid.remove(player)
        this.players.delete(player.id)
    },

    /**
     * 펌킨 NPC가 현재 페이드아웃 중인지 여부를 반환한다.
     * @param {object} player - 검사할 펌킨 NPC 플레이어 객체
     * @param {number} now - 현재 타임스탬프 (ms)
     */
    isPumpkinNpcFading(player, now = Date.now()) {
        return Boolean(player && player.isPumpkinNpc && Number(player.pumpkinFadeOutUntil || 0) > now)
    },

    /**
     * 펌킨 NPC의 페이드아웃을 시작한다.
     * 이미 페이드아웃 중이면 true를 반환하고 상태를 변경하지 않는다.
     * @param {object} player - 페이드아웃할 펌킨 NPC 플레이어 객체
     * @param {number} now - 현재 타임스탬프 (ms)
     * @returns {boolean} 페이드아웃 처리 성공 여부
     */
    fadeOutPumpkinNpc(player, now) {
        if (!player || !player.isPumpkinNpc) {
            return false
        }
        const fadeNow = Number(now || Date.now())
        if (Number(player.pumpkinFadeOutUntil || 0) > fadeNow) {
            return true
        }
        player.pumpkinDashDirectionX = 0
        player.pumpkinDashDirectionY = 0
        player.pumpkinDashStartedAt = 0
        player.pumpkinDashUntil = 0
        player.boostState = "idle"
        player.currentSpeed = 0
        player.lastMoveX = 0
        player.lastMoveY = 0
        player.pumpkinFadeOutStartedAt = fadeNow
        player.pumpkinFadeOutUntil = fadeNow + PUMPKIN_NPC_FADE_OUT_DURATION_MS
        return true
    },

    /**
     * 펌킨 NPC에게 패배 대시를 시작한다.
     * 방향 벡터를 정규화한 뒤 대시 상태를 설정한다.
     * @param {object} player - 대상 펌킨 NPC 플레이어 객체
     * @param {number} directionX - 대시 방향 X 성분
     * @param {number} directionY - 대시 방향 Y 성분
     * @param {number} now - 현재 타임스탬프 (ms)
     * @returns {boolean} 대시 시작 성공 여부
     */
    startPumpkinNpcDefeatDash(player, directionX, directionY, now) {
        if (!player || !player.isPumpkinNpc) {
            return false
        }
        const magnitude = Math.hypot(directionX, directionY)
        if (magnitude <= 0.0001) {
            return false
        }
        const normalizedX = directionX / magnitude
        const normalizedY = directionY / magnitude
        player.pumpkinDashDirectionX = normalizedX
        player.pumpkinDashDirectionY = normalizedY
        player.pumpkinDashStartedAt = now
        player.pumpkinDashUntil = now + PUMPKIN_NPC_DEFEAT_DASH_DURATION_MS
        player.boostState = "charging"
        player.currentSpeed = PUMPKIN_NPC_DEFEAT_DASH_SPEED_PER_SECOND
        player.facingAngle = Math.atan2(normalizedY, normalizedX)
        return true
    },

    /**
     * 특정 플레이어로부터 펌킨 NPC가 대시 보호를 받고 있는지 여부를 반환한다.
     * @param {object} pumpkinNpc - 검사할 펌킨 NPC 플레이어 객체
     * @param {object} otherPlayer - 공격 시도 플레이어 객체
     * @param {number} now - 현재 타임스탬프 (ms)
     * @returns {boolean} 대시 보호 중 여부
     */
    isPumpkinDashProtectedFromPlayer(pumpkinNpc, otherPlayer, now) {
        if (!pumpkinNpc || !pumpkinNpc.isPumpkinNpc || !otherPlayer) {
            return false
        }
        return (
            Number(pumpkinNpc.pumpkinDashProtectedUntil || 0) > now &&
            String(pumpkinNpc.pumpkinDashProtectedById || "") === String(otherPlayer.id || "")
        )
    },

    /**
     * 펌킨 스킨 플레이어로부터 펌킨 NPC를 드롭한다.
     * 플레이어의 스킨을 원래 스킨으로 되돌리고 펌킨 NPC를 스폰한다.
     * @param {object} player - 드롭할 플레이어 객체
     * @param {number} now - 현재 타임스탬프 (ms)
     * @param {object} options - 드롭 위치 등 추가 옵션 { x, y }
     * @returns {object|null} 스폰된 펌킨 NPC, 실패 시 null
     */
    dropPumpkinFromPlayer(player, now, options = {}) {
        if (!player || player.isNpc || player.isHouse || player.isPumpkinNpc || !isPumpkinSkinPlayer(player)) {
            return null
        }
        const dropX = this.clampToWorld(Number(options.x !== undefined ? options.x : player.x || 0))
        const dropY = this.clampToWorld(Number(options.y !== undefined ? options.y : player.y || 0))
        const pumpkinBaseSkinName = String(player.pumpkinBaseSkinName || "").trim().toLowerCase()
        if (pumpkinBaseSkinName === "double_single") {
            const liveUnit = createDoubleUnitState(now)
            const restoredLevel = typeof this.getRaiseSpeakiCurrentHealth === "function"
                ? Math.max(1, Math.round(Number(player.raiseSpeakiLevel || player.level || 1)))
                : DOUBLE_UNIT_HEALTH
            const restoredHealth = typeof this.getRaiseSpeakiCurrentHealth === "function"
                ? Math.max(1, Math.min(restoredLevel, this.getRaiseSpeakiCurrentHealth(player)))
                : (() => {
                    const pumpkinDefeats = Number(player.defeatReceivedCount || 0) % DOUBLE_UNIT_HEALTH
                    return pumpkinDefeats === 0
                        ? DOUBLE_UNIT_HEALTH
                        : Math.max(0, DOUBLE_UNIT_HEALTH - pumpkinDefeats)
                })()
            if (typeof this.applyRaiseSpeakiDoubleUnitLevel === "function") {
                this.applyRaiseSpeakiDoubleUnitLevel(liveUnit, restoredLevel, { preserveHealth: false })
                liveUnit.health = restoredHealth
            } else {
                liveUnit.health = restoredHealth
            }
            liveUnit.x = dropX
            liveUnit.y = dropY
            const inactiveUnit = createDoubleUnitState(now)
            inactiveUnit.health = 0
            inactiveUnit.x = dropX
            inactiveUnit.y = dropY
            inactiveUnit.inactiveUntil = now + DOUBLE_INACTIVE_FADE_MS
            player.skinName = DOUBLE_SKIN_NAME
            player.isDoubleSkin = true
            player.doubleMerged = false
            player.doubleSeparationPhase = "single"
            player.doubleMergeLockUntil = 0
            player.doubleUnits = [liveUnit, inactiveUnit]
            player.defeatReceivedCount = 0
        } else {
            player.skinName = "default"
        }
        player.isPumpkinSkin = false
        const originalOwnerConnectionKey = String(player.pumpkinOriginalOwnerConnectionKey || player.pumpkinOwnerConnectionKey || player.connectionKey || "").trim()
        player.pumpkinOwnerConnectionKey = ""
        player.pumpkinOriginalOwnerConnectionKey = ""
        player.pumpkinBaseSkinName = ""
        player.pumpkinBaseDoubleHealth = 0
        player.baseSpeed = getBaseSpeedForPlayer(player)
        player.collisionSlowSpeed = getCollisionSlowSpeedForPlayer(player)
        if (player.currentSpeed > 0) {
            player.currentSpeed = Math.max(player.currentSpeed, player.baseSpeed)
        }
        this.syncDoubleSkinState(player, now)
        const pumpkinNpc = this.spawnPumpkinNpc({
            x: dropX,
            y: dropY,
        }, {
            ...player,
            pumpkinOriginalOwnerConnectionKey: originalOwnerConnectionKey,
            pumpkinOwnerConnectionKey: originalOwnerConnectionKey,
        })
        pumpkinNpc.pumpkinClaimLockedUntil = now + PUMPKIN_NPC_CLAIM_LOCK_MS
        pumpkinNpc.pumpkinClaimLockedById = String(player.id || "")
        this.updateStoredPlayerProgress(player)
        return pumpkinNpc
    },

    /**
     * 펌킨 스킨 플레이어가 패배 충돌로 펌킨을 드롭하고 분리 바운스를 적용한다.
     * 플레이어와 펌킨 NPC에 각도를 벌린 방향으로 바운스 벡터를 설정한다.
     * @param {object} player - 펌킨 스킨 플레이어 객체
     * @param {number} now - 현재 타임스탬프 (ms)
     * @param {number} oppositeNormalX - 충돌 반발 방향 X 성분
     * @param {number} oppositeNormalY - 충돌 반발 방향 Y 성분
     * @param {object|null} defeatedByPlayer - 공격한 플레이어 객체 (없으면 null)
     * @param {number|null} splitBounceMagnitude - 분리 바운스 크기 (없으면 null)
     * @param {object} options - 추가 옵션 { startPumpkinDash }
     * @returns {object|null} 스폰된 펌킨 NPC, 실패 시 null
     */
    applyPumpkinSkinDefeatSplit(player, now, oppositeNormalX, oppositeNormalY, defeatedByPlayer = null, splitBounceMagnitude = null, options = {}) {
        if (!player || !isPumpkinSkinPlayer(player) || player.isPumpkinNpc) {
            return null
        }
        const pumpkinNpc = this.dropPumpkinFromPlayer(player, now)
        if (!pumpkinNpc) {
            return null
        }
        const startPumpkinDash = options.startPumpkinDash === true

        const appliedSplitBounceMagnitude = Math.max(
            0,
            Number(splitBounceMagnitude || 0) * 0.7 * (defeatedByPlayer && defeatedByPlayer.isNpc ? _NPC_DEFEAT_BOUNCE_MULTIPLIER : 1)
        )
        if (appliedSplitBounceMagnitude <= 0) {
            return pumpkinNpc
        }

        const leftBounce = this.rotateVector(oppositeNormalX, oppositeNormalY, -(40 * Math.PI / 180))
        const rightBounce = this.rotateVector(oppositeNormalX, oppositeNormalY, (40 * Math.PI / 180))
        const playerBounceDistance = Math.hypot(leftBounce.dx, leftBounce.dy) || 1
        const pumpkinBounceDistance = Math.hypot(rightBounce.dx, rightBounce.dy) || 1

        player.lastMoveX = (leftBounce.dx / playerBounceDistance) * appliedSplitBounceMagnitude
        player.lastMoveY = (leftBounce.dy / playerBounceDistance) * appliedSplitBounceMagnitude
        pumpkinNpc.lastMoveX = (rightBounce.dx / pumpkinBounceDistance) * appliedSplitBounceMagnitude
        pumpkinNpc.lastMoveY = (rightBounce.dy / pumpkinBounceDistance) * appliedSplitBounceMagnitude

        player.x = this.clampToWorld(player.x + player.lastMoveX * 0.35)
        player.y = this.clampToWorld(player.y + player.lastMoveY * 0.35)
        pumpkinNpc.x = this.clampToWorld(pumpkinNpc.x + pumpkinNpc.lastMoveX * 0.35)
        pumpkinNpc.y = this.clampToWorld(pumpkinNpc.y + pumpkinNpc.lastMoveY * 0.35)
        if (startPumpkinDash) {
            this.startPumpkinNpcDefeatDash(
                pumpkinNpc,
                rightBounce.dx,
                rightBounce.dy,
                now
            )
        }
        player.splitDefeatProtectedUntil = now + SPLIT_DEFEAT_PROTECTION_MS
        player.splitDefeatProtectedById = defeatedByPlayer ? String(defeatedByPlayer.id || "") : ""
        player.collisionImpactX = oppositeNormalX
        player.collisionImpactY = oppositeNormalY
        pumpkinNpc.collisionImpactX = oppositeNormalX
        pumpkinNpc.collisionImpactY = oppositeNormalY
        pumpkinNpc.collisionVisualType = "defeat"
        pumpkinNpc.collisionVisualUntil = Number(player.collisionVisualUntil || now + COLLISION_VISUAL_BASE_DURATION_MS)
        pumpkinNpc.collisionImpactUntil = Number(player.collisionImpactUntil || now + COLLISION_IMPACT_DURATION_MS)
        pumpkinNpc.defeatReceivedCount = Math.max(0, Number(pumpkinNpc.defeatReceivedCount || 0) + 1)
        if (defeatedByPlayer) {
            pumpkinNpc.pumpkinDashProtectedById = String(defeatedByPlayer.id || "")
            pumpkinNpc.pumpkinDashProtectedUntil = now + PUMPKIN_NPC_DAMAGE_INVULNERABLE_MS
            pumpkinNpc.pumpkinInvulnerableUntil = now + PUMPKIN_NPC_DAMAGE_INVULNERABLE_MS
        }
        this.grid.move(player)
        this.grid.move(pumpkinNpc)
        this.updateStoredPlayerProgress(player)
        return pumpkinNpc
    },

    /**
     * 플레이어가 부스트로 자발적으로 펌킨을 드롭할 때 적용되는 분리 처리다.
     * applyPumpkinSkinDefeatSplit을 호출한 뒤 승리 시각 효과를 덮어쓴다.
     * @param {object} player - 펌킨 스킨 플레이어 객체
     * @param {number} now - 현재 타임스탬프 (ms)
     * @param {number} awayNormalX - 분리 방향 X 성분
     * @param {number} awayNormalY - 분리 방향 Y 성분
     * @param {number|null} splitBounceMagnitude - 분리 바운스 크기 (없으면 null)
     * @returns {object|null} 스폰된 펌킨 NPC, 실패 시 null
     */
    applyPumpkinSkinBoostSplit(player, now, awayNormalX, awayNormalY, splitBounceMagnitude = null) {
        const preservedRaiseSpeakiLevel = typeof this.applyRaiseSpeakiLevel === "function"
            ? Math.max(1, Math.round(Number(player && (player.raiseSpeakiLevel || player.level) || 1)))
            : 0
        const preservedRaiseSpeakiHealth = typeof this.getRaiseSpeakiCurrentHealth === "function"
            ? Math.max(0, this.getRaiseSpeakiCurrentHealth(player))
            : 0
        const preservedPumpkinBaseSkinName = String(player && player.pumpkinBaseSkinName || "").trim().toLowerCase()
        const pumpkinNpc = this.applyPumpkinSkinDefeatSplit(
            player,
            now,
            awayNormalX,
            awayNormalY,
            null,
            splitBounceMagnitude,
            { startPumpkinDash: true }
        )
        if (!pumpkinNpc) {
            return null
        }
        if (typeof this.applyRaiseSpeakiLevel === "function" && preservedRaiseSpeakiLevel > 0) {
            if (preservedPumpkinBaseSkinName === "double_single" && player.isDoubleSkin && Array.isArray(player.doubleUnits)) {
                const aliveIndices = getDoubleAliveUnitIndices(player)
                const liveUnit = aliveIndices.length ? player.doubleUnits[aliveIndices[0]] : null
                if (liveUnit && typeof this.applyRaiseSpeakiDoubleUnitLevel === "function") {
                    this.applyRaiseSpeakiDoubleUnitLevel(liveUnit, preservedRaiseSpeakiLevel, { preserveHealth: false })
                    liveUnit.health = Math.max(1, Math.min(preservedRaiseSpeakiLevel, preservedRaiseSpeakiHealth))
                    if (typeof this.syncRaiseSpeakiPlayerStats === "function") {
                        this.syncRaiseSpeakiPlayerStats(player)
                    }
                }
            } else if (!player.isDoubleSkin) {
                this.applyRaiseSpeakiLevel(player, preservedRaiseSpeakiLevel)
                player.defeatReceivedCount = Math.max(0, preservedRaiseSpeakiLevel - preservedRaiseSpeakiHealth)
            }
        }
        pumpkinNpc.defeatReceivedCount = Math.max(0, Number(pumpkinNpc.defeatReceivedCount || 0) - 1)
        pumpkinNpc.collisionVisualType = "win"
        pumpkinNpc.collisionVisualUntil = now + COLLISION_VISUAL_BASE_DURATION_MS
        pumpkinNpc.collisionImpactUntil = now + COLLISION_IMPACT_DURATION_MS
        pumpkinNpc.collisionImpactX = awayNormalX
        pumpkinNpc.collisionImpactY = awayNormalY
        player.collisionVisualType = "win"
        player.collisionVisualUntil = now + COLLISION_VISUAL_BASE_DURATION_MS
        player.collisionImpactUntil = now + COLLISION_IMPACT_DURATION_MS
        player.collisionImpactX = awayNormalX
        player.collisionImpactY = awayNormalY
        player.splitDefeatProtectedById = ""
        this.grid.move(player)
        this.grid.move(pumpkinNpc)
        this.updateStoredPlayerProgress(player)
        return pumpkinNpc
    },

    /**
     * 플레이어가 펌킨 NPC를 claim(획득)한다.
     * 원래 소유자와 다른 플레이어가 획득하면 NTR 트리거 카운트를 증가시킨다.
     * @param {object} player - claim을 시도하는 플레이어 객체
     * @param {object} pumpkinNpc - 획득 대상 펌킨 NPC 객체
     * @param {number} now - 현재 타임스탬프 (ms)
     * @returns {boolean} claim 성공 여부
     */
    claimPumpkinNpc(player, pumpkinNpc, now) {
        const canClaimPumpkin = isClassicDefaultPlayer(player) || isSingleDoublePlayer(player) || Boolean(player && player.isDummy)
        if (!canClaimPumpkin || !pumpkinNpc || !pumpkinNpc.isPumpkinNpc || this.isPumpkinNpcFading(pumpkinNpc, now)) {
            return false
        }
        if (
            Number(pumpkinNpc.pumpkinClaimLockedUntil || 0) > now &&
            String(pumpkinNpc.pumpkinClaimLockedById || "") === String(player.id || "")
        ) {
            return false
        }
        const originalOwnerConnectionKey = String(
            pumpkinNpc.pumpkinOriginalOwnerConnectionKey || pumpkinNpc.pumpkinOwnerConnectionKey || ""
        ).trim()
        const singleDoubleClaim = isSingleDoublePlayer(player)
        const singleDoubleAliveIndices = singleDoubleClaim && Array.isArray(player.doubleUnits)
            ? getDoubleAliveUnitIndices(player)
            : []
        const singleDoubleUnit = singleDoubleAliveIndices.length
            ? player.doubleUnits[singleDoubleAliveIndices[0]]
            : null
        const singleDoubleHealth = singleDoubleClaim ? getSingleDoublePlayerHealth(player) : 0
        const singleDoubleLevel = singleDoubleClaim && typeof this.getRaiseSpeakiDoubleUnitLevel === "function"
            ? this.getRaiseSpeakiDoubleUnitLevel(singleDoubleUnit)
            : 0
        player.skinName = PUMPKIN_SKIN_NAME
        player.isPumpkinSkin = true
        player.isDoubleSkin = false
        player.pumpkinEliminated = false
        player.isNeutralPumpkinNpc = false
        player.pumpkinBaseSkinName = singleDoubleClaim ? "double_single" : "default"
        player.pumpkinBaseDoubleHealth = singleDoubleClaim ? singleDoubleHealth : 0
        if (singleDoubleClaim) {
            if (typeof this.applyRaiseSpeakiLevel === "function" && singleDoubleLevel > 0) {
                this.applyRaiseSpeakiLevel(player, singleDoubleLevel)
                player.defeatReceivedCount = Math.max(0, singleDoubleLevel - singleDoubleHealth)
            } else {
                player.defeatReceivedCount = Math.max(0, DOUBLE_UNIT_HEALTH - singleDoubleHealth)
            }
            player.doubleMerged = false
            player.doubleSeparationPhase = "single"
            player.doubleMergeLockUntil = 0
        }
        player.pumpkinOwnerConnectionKey = String(pumpkinNpc.pumpkinOwnerConnectionKey || "").trim()
        player.pumpkinOriginalOwnerConnectionKey = String(
            pumpkinNpc.pumpkinOriginalOwnerConnectionKey || pumpkinNpc.pumpkinOwnerConnectionKey || ""
        ).trim()
        player.baseSpeed = getBaseSpeedForPlayer(player)
        player.collisionSlowSpeed = getCollisionSlowSpeedForPlayer(player)
        player.currentSpeed = Math.max(player.currentSpeed || 0, player.baseSpeed)
        if (originalOwnerConnectionKey && originalOwnerConnectionKey !== String(player.connectionKey || "").trim()) {
            this.incrementPumpkinNtrTriggerCount(originalOwnerConnectionKey)
        }
        this.setPumpkinEliminatedState(player.pumpkinOriginalOwnerConnectionKey || player.pumpkinOwnerConnectionKey, false, now)
        this.removePumpkinNpc(pumpkinNpc)
        this.updateStoredPlayerProgress(player)
        return true
    },

    /**
     * 공격자가 펌킨 NPC를 공격했을 때 패배 처리를 적용한다.
     * NPC 차지 공격 또는 유저 부스트 공격만 유효하다.
     * 체력이 한계에 도달하면 페이드아웃 및 eliminated 상태를 설정한다.
     * @param {object} pumpkinNpc - 공격받는 펌킨 NPC 객체
     * @param {object} attacker - 공격자 플레이어 객체
     * @param {number} now - 현재 타임스탬프 (ms)
     * @returns {boolean} 처리 성공 여부
     */
    applyPumpkinNpcDefeat(pumpkinNpc, attacker, now) {
        if (!pumpkinNpc || !pumpkinNpc.isPumpkinNpc) {
            return false
        }
        if (!attacker || this.isPumpkinNpcFading(pumpkinNpc, now)) {
            return false
        }
        const attackedByNpcCharge = Boolean(attacker.isNpc && attacker.npcState === "charging")
        const attackedByUserBoost = isUserBoostAttacking(attacker)
        if (!attackedByNpcCharge && !attackedByUserBoost) {
            return false
        }
        const attackDirectionX = attackedByNpcCharge
            ? Number(attacker.npcChargeDirectionX || attacker.boostDirectionX || attacker.lastMoveX || 0)
            : Number(attacker.boostDirectionX || attacker.lastMoveX || 0)
        const attackDirectionY = attackedByNpcCharge
            ? Number(attacker.npcChargeDirectionY || attacker.boostDirectionY || attacker.lastMoveY || 0)
            : Number(attacker.boostDirectionY || attacker.lastMoveY || 0)

        pumpkinNpc.collisionVisualType = "defeat"
        pumpkinNpc.collisionVisualUntil = now + COLLISION_VISUAL_BASE_DURATION_MS
        pumpkinNpc.collisionImpactUntil = now + COLLISION_IMPACT_DURATION_MS
        pumpkinNpc.collisionImpactX = attackDirectionX
        pumpkinNpc.collisionImpactY = attackDirectionY
        this.startPumpkinNpcDefeatDash(
            pumpkinNpc,
            attackDirectionX,
            attackDirectionY,
            now
        )
        pumpkinNpc.pumpkinDashProtectedUntil = now + PUMPKIN_NPC_DASH_PROTECTION_MS
        pumpkinNpc.pumpkinDashProtectedById = String(attacker.id || "")

        if (attackedByNpcCharge && Number(pumpkinNpc.pumpkinInvulnerableUntil || 0) <= now) {
            pumpkinNpc.defeatReceivedCount = Math.max(0, Number(pumpkinNpc.defeatReceivedCount || 0) + 1)
            pumpkinNpc.pumpkinInvulnerableUntil = now + PUMPKIN_NPC_DAMAGE_INVULNERABLE_MS
        }

        if (attackedByNpcCharge && pumpkinNpc.defeatReceivedCount >= PUMPKIN_NPC_HEALTH_SEGMENTS) {
            this.incrementPumpkinNtrTriggerCount(
                pumpkinNpc.pumpkinOriginalOwnerConnectionKey || pumpkinNpc.pumpkinOwnerConnectionKey
            )
            this.setPumpkinEliminatedState(
                pumpkinNpc.pumpkinOriginalOwnerConnectionKey || pumpkinNpc.pumpkinOwnerConnectionKey,
                true,
                now
            )
            this.fadeOutPumpkinNpc(pumpkinNpc, now)
        }
        return true
    },

    /**
     * 특정 connectionKey 소유의 펌킨 NPC 및 펌킨 스킨 플레이어의 소유권을 박탈한다.
     * 펌킨 NPC는 페이드아웃되고, 펌킨 스킨 플레이어는 default 스킨으로 되돌아간다.
     * @param {string} connectionKey - 소유권을 박탈할 연결 키
     * @param {number} now - 현재 타임스탬프 (ms)
     */
    revokePumpkinOwnershipForConnection(connectionKey, now = Date.now()) {
        const ownerKey = String(connectionKey || "").trim()
        if (!ownerKey) {
            return
        }

        for (const player of Array.from(this.players.values())) {
            if (player.isPumpkinNpc && String(player.pumpkinOwnerConnectionKey || "").trim() === ownerKey) {
                this.fadeOutPumpkinNpc(player, now)
                continue
            }
            if (!player.isPumpkinNpc && isPumpkinSkinPlayer(player)) {
                const pumpkinSourceKey = String(
                    player.pumpkinOriginalOwnerConnectionKey || player.pumpkinOwnerConnectionKey || ""
                ).trim()
                if (pumpkinSourceKey !== ownerKey) {
                    continue
                }
                player.skinName = "default"
                player.isPumpkinSkin = false
                player.pumpkinOwnerConnectionKey = ""
                player.pumpkinOriginalOwnerConnectionKey = ""
                player.baseSpeed = getBaseSpeedForPlayer(player)
                player.collisionSlowSpeed = getCollisionSlowSpeedForPlayer(player)
                player.currentSpeed = Math.max(Number(player.currentSpeed || 0), player.baseSpeed)
                this.syncDoubleSkinState(player, now)
                this.updateStoredPlayerProgress(player)
            }
        }
    },

    /**
     * 특정 connectionKey 소유자의 pumpkinEliminated 상태를 설정한다.
     * playerProgress와 현재 접속 중인 플레이어 객체 모두에 반영한다.
     * @param {string} connectionKey - 대상 연결 키
     * @param {boolean} eliminated - 설정할 eliminated 상태
     * @param {number} now - 현재 타임스탬프 (ms)
     */
    setPumpkinEliminatedState(connectionKey, eliminated, now = Date.now()) {
        const ownerKey = String(connectionKey || "").trim()
        if (!ownerKey) {
            return
        }
        const nextValue = Boolean(eliminated)
        const savedProgress = this.playerProgress.get(ownerKey)
        if (savedProgress) {
            savedProgress.pumpkinEliminated = nextValue
            this.playerProgress.set(ownerKey, savedProgress)
        }
        for (const player of this.players.values()) {
            if (!isPersistentHumanPlayer(player)) {
                continue
            }
            if (String(player.connectionKey || "").trim() !== ownerKey) {
                continue
            }
            player.pumpkinEliminated = nextValue
            this.updateStoredPlayerProgress(player)
            if (nextValue) {
                continue
            }
            player.lastActiveInputAt = Math.max(Number(player.lastActiveInputAt || 0), Number(now || Date.now()))
        }
    },

    /**
     * 특정 connectionKey 소유자의 NTR 트리거 횟수를 1 증가시킨다.
     * playerProgress와 현재 접속 중인 플레이어 객체 모두에 반영한다.
     * @param {string} connectionKey - 대상 연결 키
     */
    incrementPumpkinNtrTriggerCount(connectionKey) {
        const ownerKey = String(connectionKey || "").trim()
        if (!ownerKey) {
            return
        }
        const savedProgress = this.playerProgress.get(ownerKey)
        if (savedProgress) {
            savedProgress.pumpkinNtrTriggerCount = Number(savedProgress.pumpkinNtrTriggerCount || 0) + 1
            this.playerProgress.set(ownerKey, savedProgress)
        }
        for (const player of this.players.values()) {
            if (!isPersistentHumanPlayer(player)) {
                continue
            }
            if (String(player.connectionKey || "").trim() !== ownerKey) {
                continue
            }
            player.pumpkinNtrTriggerCount = Number(player.pumpkinNtrTriggerCount || 0) + 1
            this.updateStoredPlayerProgress(player)
        }
    },

    /**
     * eliminated 상태인 펌킨 스킨 플레이어를 복구한다.
     * 아직 펌킨 스킨이면 eliminated 플래그만 해제하고,
     * 펌킨 스킨이 아니면 펌킨 스킨으로 복원한다.
     * @param {number} now - 현재 타임스탬프 (ms)
     */
    restoreEliminatedPumpkinPlayers(now = Date.now()) {
        for (const player of this.players.values()) {
            if (!isPersistentHumanPlayer(player)) {
                continue
            }
            if (String(player.initialSkinName || "").trim().toLowerCase() !== PUMPKIN_SKIN_NAME) {
                continue
            }
            if (!Boolean(player.pumpkinEliminated)) {
                continue
            }
            if (isPumpkinSkinPlayer(player)) {
                player.pumpkinEliminated = false
                this.updateStoredPlayerProgress(player)
                continue
            }
            player.skinName = PUMPKIN_SKIN_NAME
            player.initialSkinName = PUMPKIN_SKIN_NAME
            player.isPumpkinSkin = true
            player.pumpkinEliminated = false
            player.pumpkinOwnerConnectionKey = player.connectionKey
            player.pumpkinOriginalOwnerConnectionKey = player.connectionKey
            player.baseSpeed = getBaseSpeedForPlayer(player)
            player.collisionSlowSpeed = getCollisionSlowSpeedForPlayer(player)
            player.currentSpeed = Math.max(Number(player.currentSpeed || 0), player.baseSpeed)
            this.syncDoubleSkinState(player, now)
            this.updateStoredPlayerProgress(player)
        }
    },

    /**
     * 완전 초기화 시 모든 펌킨 스킨 플레이어를 초기 상태로 복원한다.
     * 소유권 키를 자신의 connectionKey로 재설정하고 eliminated를 해제한다.
     * @param {number} now - 현재 타임스탬프 (ms)
     */
    restoreInitialPumpkinPlayersForFullReset(now = Date.now()) {
        for (const player of this.players.values()) {
            if (!isPersistentHumanPlayer(player)) {
                continue
            }
            if (String(player.initialSkinName || "").trim().toLowerCase() !== PUMPKIN_SKIN_NAME) {
                continue
            }
            if (isPumpkinSkinPlayer(player)) {
                player.pumpkinEliminated = false
                player.pumpkinOwnerConnectionKey = player.connectionKey
                player.pumpkinOriginalOwnerConnectionKey = player.connectionKey
                this.updateStoredPlayerProgress(player)
                continue
            }
            player.skinName = PUMPKIN_SKIN_NAME
            player.initialSkinName = PUMPKIN_SKIN_NAME
            player.isPumpkinSkin = true
            player.pumpkinEliminated = false
            player.pumpkinOwnerConnectionKey = player.connectionKey
            player.pumpkinOriginalOwnerConnectionKey = player.connectionKey
            player.baseSpeed = getBaseSpeedForPlayer(player)
            player.collisionSlowSpeed = getCollisionSlowSpeedForPlayer(player)
            player.currentSpeed = Math.max(Number(player.currentSpeed || 0), player.baseSpeed)
            this.syncDoubleSkinState(player, now)
            this.updateStoredPlayerProgress(player)
        }
    },
}
