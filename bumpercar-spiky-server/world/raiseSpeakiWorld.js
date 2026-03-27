const BaseWorld = require("./world")
const {
    COLLISION_BOUNCE_DISTANCE,
    COLLISION_SPEED_BOUNCE_MULTIPLIER,
    COLLISION_MAX_BOUNCE_DISTANCE,
    COLLISION_VISUAL_BASE_DURATION_MS,
    COLLISION_IMPACT_DURATION_MS,
    COLLISION_VISUAL_SPEED_DURATION_MULTIPLIER_MS,
    COLLISION_VISUAL_MAX_DURATION_MS,
    COLLISION_ATTACK_DIRECTION_THRESHOLD,
    NPC_DEFEAT_BOUNCE_MULTIPLIER,
    PLAYER_DEATH_DURATION_MS,
    DOUBLE_REMERGE_LOCK_MS,
    SPLIT_DEFEAT_PROTECTION_MS,
    DOUBLE_INACTIVE_FADE_MS,
    DOUBLE_SPLIT_PROBABILITY,
    DOUBLE_MERGED_SIDE_OFFSET,
} = require("../config/constants")
const {
    DUMMY_BASE_SPEED_PER_SECOND,
    NPC_CHARGE_TRIGGER_DISTANCE,
    NPC_EXTRA_CHARGE_DISTANCE_MULTIPLIER,
    NPC_CHARGE_WINDUP_DURATION_MS,
    createDoubleUnitState,
} = require("./worldSettings")
const {
    isPumpkinSkinPlayer,
    isClassicDefaultPlayer,
    isSingleDoublePlayer,
    isPersistentHumanPlayer,
    isPlayerAttackingForCollision,
    getDummyPhase,
    getPlayerDeathTriggerCount,
    getDoubleAliveUnitIndices,
} = require("./worldHelpers")
const { postStatsUpdate } = require("../services/accountStats")

const LEVEL_SCALE_FACTOR = 1.1
const DEFAULT_LEVEL = 1
const MAX_LEVEL = 10
const DEFAULT_PUMPKIN_LEVEL = 4
const NEUTRAL_PUMPKIN_COUNT = 2
const AI_RESPAWN_DELAY_MS = 10000
const RAISE_SPEAKI_AI_WINDUP_DURATION_MS = 500
const RAISE_SPEAKI_LEVEL_DROP_SCATTER_RADIUS = 90
const RAISE_SPEAKI_LEVEL_DROP_PICKUP_RADIUS = 52
const RAISE_SPEAKI_LEVEL_DROP_LIFETIME_MS = 6000
const RAISE_SPEAKI_LEVEL_DROP_SOLID_DURATION_MS = 3000
const RAISE_SPEAKI_LEVEL_DROP_DRIFT_SPEED_PER_SECOND = 22
const RAISE_SPEAKI_LEVEL_DROP_AI_DETECTION_RADIUS = 260

class RaiseSpeakiWorld extends BaseWorld {
    constructor() {
        super()
        this.raiseSpeakiLevelDrops = []
        this.nextRaiseSpeakiLevelDropId = 1
        this.pendingNeutralPumpkinRespawns = 0
        this.sharedLivesRemaining = 1
        this.pendingRoundResetAt = 0
        this.roundResetAnnouncementUntil = 0
        this.encounterStage = 0
        this.encounterAnnouncementKey = ""
        this.encounterAnnouncementUntil = 0
        this.encounterCountdownUntil = 0
        this.encounterFinaleUntil = 0
        this.encounterFinaleRewarded = false
        this.encounterResetOnAllDead = false
        this.lastTrackedNerCombatPhase = 1

        for (const player of this.players.values()) {
            if (player.isDummy) {
                player.dummyDefaultDisplayName = "야생 스핔이"
                this.resetRaiseSpeakiPlayer(player, { preservePosition: true })
            } else if (player.isPumpkinNpc) {
                this.applyRaiseSpeakiLevel(player, DEFAULT_PUMPKIN_LEVEL)
            }
        }
        this.ensureNeutralPumpkinCount()
    }

    addNerNpcPlayer() {
        return null
    }

    getEncounterCountdownSecondsRemaining() {
        return 0
    }

    maybeResetAfterInputIdle() {}

    clearEncounterAnnouncement() {
        this.encounterAnnouncementKey = ""
        this.encounterAnnouncementUntil = 0
        this.encounterCountdownUntil = 0
    }

    resetEncounterToInitial() {
        this.pendingRoundResetAt = 0
        this.roundResetAnnouncementUntil = 0
        this.clearEncounterAnnouncement()
        this.encounterStage = 0
        this.encounterFinaleUntil = 0
        this.encounterFinaleRewarded = false
    }

    killAllHumansForEncounterFailure() {}
    beginStageOneHouseEncounter() {}
    beginStageTwoHouseEncounter() {}
    beginStageThreeHouseEncounter() {}
    beginStageTwoNer() {}
    beginStageThreeNer() {}
    beginEncounterFinale() {}

    ensureNeutralPumpkinCount() {
        const neutralPumpkins = this.getPumpkinPlayers().filter((player) => Boolean(player.isNeutralPumpkinNpc))
        for (let index = neutralPumpkins.length; index < NEUTRAL_PUMPKIN_COUNT; index += 1) {
            const spawnPosition = this.getRandomNeutralPumpkinSpawnPosition()
            const pumpkin = this.spawnPumpkinNpc(spawnPosition, null)
            pumpkin.isNeutralPumpkinNpc = true
            pumpkin.pumpkinOwnerConnectionKey = ""
            pumpkin.pumpkinOriginalOwnerConnectionKey = ""
            this.applyRaiseSpeakiLevel(pumpkin, DEFAULT_PUMPKIN_LEVEL)
        }
    }

    processPendingNeutralPumpkinRespawns() {
        const respawnCount = Math.max(0, Math.round(Number(this.pendingNeutralPumpkinRespawns || 0)))
        if (respawnCount <= 0) {
            return
        }
        const currentNeutralPumpkins = this.getPumpkinPlayers().filter((player) => Boolean(player.isNeutralPumpkinNpc)).length
        const missingNeutralPumpkins = Math.max(0, NEUTRAL_PUMPKIN_COUNT - currentNeutralPumpkins)
        const spawnCount = Math.min(respawnCount, missingNeutralPumpkins)
        this.pendingNeutralPumpkinRespawns = 0
        for (let index = 0; index < spawnCount; index += 1) {
            const spawnPosition = this.getRandomNeutralPumpkinSpawnPosition()
            const pumpkin = this.spawnPumpkinNpc(spawnPosition, null)
            pumpkin.isNeutralPumpkinNpc = true
            pumpkin.pumpkinOwnerConnectionKey = ""
            pumpkin.pumpkinOriginalOwnerConnectionKey = ""
            this.applyRaiseSpeakiLevel(pumpkin, DEFAULT_PUMPKIN_LEVEL)
        }
    }

    normalizeNeutralPumpkinCount() {
        const neutralPumpkins = this.getPumpkinPlayers()
            .filter((player) => Boolean(player.isNeutralPumpkinNpc))
            .sort((left, right) => Number(left.pumpkinFadeOutStartedAt || 0) - Number(right.pumpkinFadeOutStartedAt || 0))
        for (let index = NEUTRAL_PUMPKIN_COUNT; index < neutralPumpkins.length; index += 1) {
            this.removePumpkinNpc(neutralPumpkins[index])
        }
    }

    createRaiseSpeakiLevelDrop(position = {}, scatterScale = 1, now = Date.now()) {
        const angle = Math.random() * Math.PI * 2
        const safeScatterScale = Math.max(0.6, Number(scatterScale || 1))
        const scatterRadius = RAISE_SPEAKI_LEVEL_DROP_SCATTER_RADIUS * safeScatterScale * 1.5
        const distance = Math.random() * scatterRadius
        const id = `raise-speaki-drop-${this.nextRaiseSpeakiLevelDropId++}`
        const directionX = distance > 0.001 ? Math.cos(angle) : 0
        const directionY = distance > 0.001 ? Math.sin(angle) : 0
        const x = this.clampToWorld(Number(position.x || 0) + Math.cos(angle) * distance)
        const y = this.clampToWorld(Number(position.y || 0) + Math.sin(angle) * distance)
        return {
            id,
            x,
            y,
            originX: this.clampToWorld(Number(position.x || 0)),
            originY: this.clampToWorld(Number(position.y || 0)),
            driftDirectionX: directionX,
            driftDirectionY: directionY,
            lastUpdatedAt: now,
            createdAt: now,
            fadeStartsAt: now + RAISE_SPEAKI_LEVEL_DROP_SOLID_DURATION_MS,
            expiresAt: now + RAISE_SPEAKI_LEVEL_DROP_LIFETIME_MS,
        }
    }

    spawnRaiseSpeakiLevelDrops(position = {}, amount = 0, now = Date.now()) {
        const safeAmount = Math.max(0, Math.round(Number(amount || 0)))
        const scatterScale = Math.max(0.6, Number(position.sizeMultiplier || 1))
        for (let index = 0; index < safeAmount; index += 1) {
            this.raiseSpeakiLevelDrops.push(this.createRaiseSpeakiLevelDrop(position, scatterScale, now))
        }
    }

    getRaiseSpeakiDropCollectorPoints(player) {
        if (!player || player.isNpc || player.isHouse || player.isPumpkinNpc || this.isPlayerDead(player)) {
            return []
        }
        if (player.isDoubleSkin && Array.isArray(player.doubleUnits)) {
            return getDoubleAliveUnitIndices(player).map((unitIndex) => {
                const unit = player.doubleUnits[unitIndex]
                return unit ? { player, unit, unitIndex, x: Number(unit.x || player.x || 0), y: Number(unit.y || player.y || 0) } : null
            }).filter(Boolean)
        }
        return [{ player, unit: null, unitIndex: -1, x: Number(player.x || 0), y: Number(player.y || 0) }]
    }

    applyRaiseSpeakiLevelDropCollection(collector) {
        if (!collector || !collector.player) {
            return
        }
        if (collector.unit) {
            const nextLevel = this.getRaiseSpeakiDoubleUnitLevel(collector.unit) + 1
            this.applyRaiseSpeakiDoubleUnitLevel(collector.unit, nextLevel, { preserveHealth: true })
            this.syncRaiseSpeakiPlayerStats(collector.player)
        } else {
            const nextLevel = Math.max(1, Number(collector.player.level || DEFAULT_LEVEL) + 1)
            this.applyRaiseSpeakiLevel(collector.player, nextLevel)
        }
        collector.player.playerWinVisualUntil = Date.now() + 350
        if (isPersistentHumanPlayer(collector.player)) {
            this.updateStoredPlayerProgress(collector.player)
        }
    }

    processRaiseSpeakiLevelDrops(now = Date.now()) {
        for (let index = this.raiseSpeakiLevelDrops.length - 1; index >= 0; index -= 1) {
            const drop = this.raiseSpeakiLevelDrops[index]
            if (!drop) {
                this.raiseSpeakiLevelDrops.splice(index, 1)
                continue
            }
            if (Number(drop.expiresAt || 0) <= now) {
                this.raiseSpeakiLevelDrops.splice(index, 1)
                continue
            }
            const elapsedMs = Math.max(0, Number(now) - Number(drop.lastUpdatedAt || now))
            if (elapsedMs > 0) {
                const driftDistance = (RAISE_SPEAKI_LEVEL_DROP_DRIFT_SPEED_PER_SECOND * elapsedMs) / 1000
                drop.x = this.clampToWorld(Number(drop.x || 0) + Number(drop.driftDirectionX || 0) * driftDistance)
                drop.y = this.clampToWorld(Number(drop.y || 0) + Number(drop.driftDirectionY || 0) * driftDistance)
                drop.lastUpdatedAt = now
            }
            let bestCollector = null
            let bestDistance = Infinity
            for (const player of this.players.values()) {
                const collectorPoints = this.getRaiseSpeakiDropCollectorPoints(player)
                collectorPoints.forEach((collector) => {
                    const distance = Math.hypot(Number(collector.x || 0) - Number(drop.x || 0), Number(collector.y || 0) - Number(drop.y || 0))
                    if (distance <= RAISE_SPEAKI_LEVEL_DROP_PICKUP_RADIUS && distance < bestDistance) {
                        bestCollector = collector
                        bestDistance = distance
                    }
                })
            }
            if (!bestCollector) {
                continue
            }
            this.applyRaiseSpeakiLevelDropCollection(bestCollector)
            this.raiseSpeakiLevelDrops.splice(index, 1)
        }
    }

    getNearestRaiseSpeakiLevelDrop(player, maxDistance = RAISE_SPEAKI_LEVEL_DROP_AI_DETECTION_RADIUS) {
        if (!player || !Array.isArray(this.raiseSpeakiLevelDrops) || !this.raiseSpeakiLevelDrops.length) {
            return null
        }
        let nearestDrop = null
        let nearestDistance = Math.max(0, Number(maxDistance || 0))
        this.raiseSpeakiLevelDrops.forEach((drop) => {
            if (!drop) {
                return
            }
            const distance = Math.hypot(Number(drop.x || 0) - Number(player.x || 0), Number(drop.y || 0) - Number(player.y || 0))
            if (distance <= nearestDistance) {
                nearestDrop = drop
                nearestDistance = distance
            }
        })
        return nearestDrop
    }

    removePumpkinNpc(player) {
        const shouldRespawnNeutral = Boolean(player && player.isNeutralPumpkinNpc && player.raiseSpeakiRespawnNeutral)
        super.removePumpkinNpc(player)
        if (shouldRespawnNeutral) {
            this.pendingNeutralPumpkinRespawns = Math.max(0, Number(this.pendingNeutralPumpkinRespawns || 0)) + 1
        }
    }

    syncDoubleSkinState(player, now = Date.now()) {
        super.syncDoubleSkinState(player, now)
        if (player && player.isDoubleSkin && !player.isPumpkinNpc) {
            this.syncRaiseSpeakiDoubleUnits(player)
        }
    }

    getRaiseSpeakiDoubleUnitLevel(unit) {
        return Math.max(1, Math.round(Number(unit && unit.raiseSpeakiLevel || DEFAULT_LEVEL)))
    }

    getRaiseSpeakiDoubleUnitCurrentHealth(unit) {
        const maxHealth = this.getRaiseSpeakiDoubleUnitLevel(unit)
        return Math.max(0, Math.min(maxHealth, Math.round(Number(unit && unit.health || 0))))
    }

    applyRaiseSpeakiDoubleUnitLevel(unit, level = DEFAULT_LEVEL, options = {}) {
        if (!unit) {
            return
        }
        const safeLevel = Math.min(MAX_LEVEL, Math.max(1, Math.round(Number(level || DEFAULT_LEVEL))))
        const preserveHealth = options.preserveHealth === true
        const nextHealth = preserveHealth
            ? Math.max(0, Math.min(safeLevel, Math.round(Number(unit.health || 0))))
            : safeLevel
        unit.raiseSpeakiLevel = safeLevel
        unit.raiseSpeakiMaxHealthSegments = safeLevel
        unit.raiseSpeakiAttackDamage = safeLevel
        unit.sizeMultiplier = Math.pow(LEVEL_SCALE_FACTOR, safeLevel - 1)
        unit.health = nextHealth
    }

    syncRaiseSpeakiDoubleUnits(player, options = {}) {
        if (!player || !player.isDoubleSkin || !Array.isArray(player.doubleUnits)) {
            return
        }
        const resetLevels = options.resetLevels === true
        player.doubleUnits.forEach((unit) => {
            const fallbackLevel = resetLevels ? DEFAULT_LEVEL : this.getRaiseSpeakiDoubleUnitLevel(unit)
            this.applyRaiseSpeakiDoubleUnitLevel(unit, fallbackLevel, {
                preserveHealth: !resetLevels,
            })
        })
        this.syncRaiseSpeakiPlayerStats(player)
    }

    syncRaiseSpeakiPlayerStats(player) {
        if (!player) {
            return
        }
        if (player.isDoubleSkin && Array.isArray(player.doubleUnits)) {
            const totalLevel = player.doubleUnits.reduce((sum, unit) => sum + this.getRaiseSpeakiDoubleUnitLevel(unit), 0)
            const totalHealth = player.doubleUnits.reduce((sum, unit) => sum + this.getRaiseSpeakiDoubleUnitCurrentHealth(unit), 0)
            const sizeScales = player.doubleUnits.map((unit) => Math.max(0.6, Number(unit && unit.sizeMultiplier || 1)))
            player.level = Math.max(1, totalLevel)
            player.raiseSpeakiLevel = player.level
            player.raiseSpeakiMaxHealthSegments = Math.max(1, totalLevel)
            player.raiseSpeakiAttackDamage = player.level
            player.raiseSpeakiAttackDamageScale = 1
            player.currentHealth = Math.max(0, totalHealth)
            player.maxHealth = Math.max(1, totalLevel)
            player.sizeMultiplier = sizeScales.length
                ? (sizeScales.reduce((sum, value) => sum + value, 0) / sizeScales.length)
                : 1
            return
        }
        player.currentHealth = this.getRaiseSpeakiCurrentHealth(player)
        player.maxHealth = Math.max(1, Number(player.raiseSpeakiMaxHealthSegments || player.level || 1))
    }

    initializeRaiseSpeakiCombatState(player) {
        if (!player) {
            return
        }
        player.raiseSpeakiAttackSequence = Number(player.raiseSpeakiAttackSequence || 0)
        player.raiseSpeakiAttackActive = Boolean(player.raiseSpeakiAttackActive)
        if (!player.raiseSpeakiReceivedAttackSequences || typeof player.raiseSpeakiReceivedAttackSequences !== "object") {
            player.raiseSpeakiReceivedAttackSequences = {}
        }
    }

    syncRaiseSpeakiAttackSequences() {
        for (const player of this.players.values()) {
            this.updateRaiseSpeakiAttackSequence(player)
        }
    }

    updateRaiseSpeakiAttackSequence(player) {
        if (!player) {
            return
        }
        this.initializeRaiseSpeakiCombatState(player)
        const isAttacking = isPlayerAttackingForCollision(player)
        if (isAttacking && !player.raiseSpeakiAttackActive) {
            player.raiseSpeakiAttackSequence = Number(player.raiseSpeakiAttackSequence || 0) + 1
        }
        player.raiseSpeakiAttackActive = isAttacking
    }

    hasRaiseSpeakiDashHitProtection(targetPlayer, attacker) {
        if (!targetPlayer || !attacker) {
            return false
        }
        this.initializeRaiseSpeakiCombatState(targetPlayer)
        this.initializeRaiseSpeakiCombatState(attacker)
        const attackerId = String(attacker.id || "")
        if (!attackerId) {
            return false
        }
        return Number(targetPlayer.raiseSpeakiReceivedAttackSequences[attackerId] || 0) === Number(attacker.raiseSpeakiAttackSequence || 0)
    }

    markRaiseSpeakiDashHit(targetPlayer, attacker) {
        if (!targetPlayer || !attacker) {
            return
        }
        this.initializeRaiseSpeakiCombatState(targetPlayer)
        const attackerId = String(attacker.id || "")
        if (!attackerId) {
            return
        }
        targetPlayer.raiseSpeakiReceivedAttackSequences[attackerId] = Number(attacker.raiseSpeakiAttackSequence || 0)
    }

    getRaiseSpeakiAttackDamage(player, normalX = 0, normalY = 0) {
        if (!player) {
            return DEFAULT_LEVEL
        }
        if (player.isDoubleSkin && Array.isArray(player.doubleUnits)) {
            const attackUnitIndex = this.getDoubleHitUnitIndex(player, normalX, normalY)
            const attackUnit = player.doubleUnits[attackUnitIndex]
            return Math.max(1, Number(attackUnit && attackUnit.raiseSpeakiAttackDamage || attackUnit && attackUnit.raiseSpeakiLevel || DEFAULT_LEVEL))
        }
        const baseDamage = Math.max(1, Number(player.raiseSpeakiAttackDamage || player.level || DEFAULT_LEVEL))
        if (isPumpkinSkinPlayer(player) && !player.isPumpkinNpc) {
            return baseDamage + 1
        }
        return baseDamage
    }

    getRaiseSpeakiAttackRewardSource(player, normalX = 0, normalY = 0) {
        if (!player || !player.isDoubleSkin || !Array.isArray(player.doubleUnits)) {
            return null
        }
        const cachedIndex = Number(player.raiseSpeakiLastRewardUnitIndex)
        if (Number.isInteger(cachedIndex) && cachedIndex >= 0 && cachedIndex < player.doubleUnits.length) {
            return {
                unit: player.doubleUnits[cachedIndex] || null,
                unitIndex: cachedIndex,
            }
        }
        const attackUnitIndex = this.getDoubleHitUnitIndex(player, normalX, normalY)
        return {
            unit: player.doubleUnits[attackUnitIndex] || null,
            unitIndex: attackUnitIndex,
        }
    }

    applyRaiseSpeakiLevel(player, level = DEFAULT_LEVEL) {
        if (!player) {
            return
        }
        if (player.isDoubleSkin && !player.isPumpkinNpc) {
            this.syncRaiseSpeakiDoubleUnits(player)
            return
        }
        const safeLevel = Math.min(MAX_LEVEL, Math.max(1, Math.round(Number(level || DEFAULT_LEVEL))))
        player.level = safeLevel
        player.raiseSpeakiLevel = safeLevel
        player.raiseSpeakiMaxHealthSegments = safeLevel
        player.raiseSpeakiAttackDamage = safeLevel
        player.raiseSpeakiAttackDamageScale = 1
        player.sizeMultiplier = player.isPumpkinNpc ? 1 : Math.pow(LEVEL_SCALE_FACTOR, safeLevel - 1)
        const currentDamage = Math.max(0, Number(player.defeatReceivedCount || 0))
        player.defeatReceivedCount = currentDamage
        this.syncRaiseSpeakiPlayerStats(player)
    }

    getRaiseSpeakiCurrentHealth(player) {
        if (!player) {
            return 0
        }
        const maxHealth = Math.max(1, Number(player.raiseSpeakiMaxHealthSegments || player.level || 1))
        const damageTaken = Math.max(0, Math.min(maxHealth, Number(player.defeatReceivedCount || 0)))
        return Math.max(0, maxHealth - damageTaken)
    }

    resetRaiseSpeakiPlayer(player, options = {}) {
        if (!player) {
            return false
        }
        const now = Date.now()
        const preservePosition = options.preservePosition === true
        const preserveStats = options.preserveStats === true
        const level = player.isPumpkinNpc ? DEFAULT_PUMPKIN_LEVEL : (preserveStats ? Number(player.level || DEFAULT_LEVEL) : DEFAULT_LEVEL)
        this.applyRaiseSpeakiLevel(player, level)
        if (!preserveStats) {
            player.defeatReceivedCount = 0
            if (player.isDoubleSkin) {
                this.syncRaiseSpeakiDoubleUnits(player, { resetLevels: true })
            } else {
                player.currentHealth = player.maxHealth
            }
        } else if (player.isDoubleSkin) {
            this.syncRaiseSpeakiDoubleUnits(player)
        }
        if (!preservePosition) {
            let spawnPosition
            if (player.isDummy) {
                spawnPosition = this.getRandomQuadrantSpawnPosition(player.dummyQuadrant || 1)
            } else if (player.isPumpkinNpc && player.isNeutralPumpkinNpc) {
                spawnPosition = this.getRandomNeutralPumpkinSpawnPosition()
            } else {
                spawnPosition = this.getRandomEdgeSpawnPosition()
            }
            player.x = spawnPosition.x
            player.y = spawnPosition.y
        }
        player.currentSpeed = Number(player.baseSpeed || player.currentSpeed || 0)
        player.boostState = "idle"
        player.boostDirectionX = 0
        player.boostDirectionY = 0
        player.input = {
            up: false,
            down: false,
            left: false,
            right: false,
            boost: false,
            special: false,
            respawn: false,
            moveX: 0,
            moveY: 0,
        }
        player.lastMoveX = 0
        player.lastMoveY = 0
        player.collisionVisualUntil = 0
        player.collisionImpactUntil = 0
        player.collisionVisualType = "win"
        player.npcDefeatDamageRatio = 0
        player.npcWinVisualUntil = 0
        player.playerWinVisualUntil = 0
        player.collisionImpactX = 0
        player.collisionImpactY = 0
        player.collisionRecoveryStartedAt = 0
        player.collisionRecoveryUntil = 0
        player.boostDisabledStartedAt = now
        player.boostDisabledUntil = now
        player.deathStartedAt = 0
        player.deathUntil = 0
        player.respawnRequested = false
        player.npcRespawnAt = 0
        player.raiseSpeakiLastRewardUnitIndex = -1
        player.raiseSpeakiSpecialPressed = false
        player.raiseSpeakiSpecialRequested = false
        player.raiseSpeakiAttackSequence = 0
        player.raiseSpeakiAttackActive = false
        player.raiseSpeakiReceivedAttackSequences = {}
        if (player.isDummy) {
            player.dummyRetaliationTargetId = ""
            player.dummyState = "idle"
            player.dummyPhase = 1
            player.dummyChargeDistanceRemaining = 0
            player.dummyChargeDistanceTotal = 0
            player.dummyChargeWindupStartedAt = 0
            player.dummyChargeWindupUntil = 0
            player.dummyRestUntil = 0
            player.dummyQueuedExtraCharges = 0
        }
        this.ensureDoubleUnitLayout(player, now)
        this.syncRaiseSpeakiPlayerStats(player)
        this.grid.move(player)
        if (isPersistentHumanPlayer(player)) {
            this.updateStoredPlayerProgress(player)
        }
        return true
    }

    addPlayer(connectionKey, displayId = connectionKey, options = {}) {
        const player = super.addPlayer(connectionKey, displayId, options)
        const savedProgress = this.getStoredPlayerProgress(player.connectionKey)
        const savedLevel = savedProgress && Number(savedProgress.level || 0) > 0
            ? Number(savedProgress.level || DEFAULT_LEVEL)
            : DEFAULT_LEVEL
        this.applyRaiseSpeakiLevel(player, savedLevel)
        if (savedProgress) {
            player.defeatReceivedCount = Math.max(0, Number(savedProgress.defeatReceivedCount || 0))
            player.defeatDealtCount = Math.max(0, Number(savedProgress.defeatDealtCount || 0))
            this.syncRaiseSpeakiPlayerStats(player)
        } else {
            player.defeatReceivedCount = 0
            if (player.isDoubleSkin) {
                this.syncRaiseSpeakiDoubleUnits(player, { resetLevels: true })
            } else {
                player.currentHealth = player.maxHealth
            }
        }
        this.updateStoredPlayerProgress(player)
        return player
    }

    updateStoredPlayerProgress(player) {
        super.updateStoredPlayerProgress(player)
        if (!player || player.isNpc || player.isDummy) {
            return
        }
        const connectionKey = String(player.connectionKey || player.id || "").trim()
        const savedProgress = connectionKey ? this.playerProgress.get(connectionKey) : null
        if (!savedProgress) {
            return
        }
        savedProgress.level = Math.max(1, Number(player.level || DEFAULT_LEVEL))
        savedProgress.maxHealth = Math.max(1, Number(player.maxHealth || savedProgress.level || DEFAULT_LEVEL))
        savedProgress.currentHealth = Math.max(0, Number(player.currentHealth || 0))
        if (player.isDoubleSkin && Array.isArray(player.doubleUnits) && Array.isArray(savedProgress.doubleUnits)) {
            savedProgress.doubleUnits = savedProgress.doubleUnits.map((unit, index) => ({
                ...unit,
                raiseSpeakiLevel: this.getRaiseSpeakiDoubleUnitLevel(player.doubleUnits[index]),
                raiseSpeakiMaxHealthSegments: Math.max(1, Number(player.doubleUnits[index] && player.doubleUnits[index].raiseSpeakiMaxHealthSegments || this.getRaiseSpeakiDoubleUnitLevel(player.doubleUnits[index]))),
                sizeMultiplier: Math.max(0.6, Number(player.doubleUnits[index] && player.doubleUnits[index].sizeMultiplier || 1)),
            }))
        }
        this.playerProgress.set(connectionKey, savedProgress)
    }

    respawnPlayer(player) {
        return this.resetRaiseSpeakiPlayer(player, {
            preservePosition: false,
            preserveStats: false,
        })
    }

    triggerPlayerDeath(player, now, defeatedByPlayer = null, options = {}) {
        if (!player || player.isNpc || player.isDummy || this.isPlayerDead(player)) {
            return
        }
        player.deathStartedAt = now
        player.deathUntil = now + PLAYER_DEATH_DURATION_MS
        player.boostState = "idle"
        player.input = {
            up: false,
            down: false,
            left: false,
            right: false,
            boost: false,
            special: false,
            respawn: false,
            moveX: 0,
            moveY: 0,
        }
        player.currentSpeed = 0
        player.boostDirectionX = 0
        player.boostDirectionY = 0
        player.respawnRequested = false
        player.collisionVisualType = "defeat"
        player.npcDefeatDamageRatio = 1
        player.collisionVisualUntil = player.deathUntil
        player.collisionImpactUntil = 0
        player.collisionImpactX = 0
        player.collisionImpactY = 0
        player.collisionRecoveryStartedAt = 0
        player.collisionRecoveryUntil = 0
        player.boostDisabledUntil = Math.max(player.boostDisabledUntil || 0, player.deathUntil)
        player.lastMoveX = 0
        player.lastMoveY = 0
        player.currentHealth = 0
        if (isPersistentHumanPlayer(defeatedByPlayer)) {
            defeatedByPlayer.playerWinVisualUntil = now + 3000
            postStatsUpdate(defeatedByPlayer.id, { player_kills: 1 })
        }
        this.updateStoredPlayerProgress(player)
        postStatsUpdate(player.id, { deaths: 1 })
        if (defeatedByPlayer && options.skipKillReward !== true) {
            this.handleRaiseSpeakiKillReward(defeatedByPlayer, player, now)
        }
    }

    triggerDummyDeath(player, now, defeatedByPlayer = null, options = {}) {
        if (!player || !player.isDummy || this.isPlayerDead(player)) {
            return
        }
        if (isPumpkinSkinPlayer(player) && !player.isPumpkinNpc) {
            this.dropPumpkinFromPlayer(player, now, {
                x: player.x,
                y: player.y,
            })
        }
        player.deathStartedAt = now
        player.deathUntil = now + PLAYER_DEATH_DURATION_MS
        player.npcRespawnAt = player.deathUntil + AI_RESPAWN_DELAY_MS
        player.boostState = "idle"
        player.input = {
            up: false,
            down: false,
            left: false,
            right: false,
            boost: false,
            special: false,
            respawn: false,
            moveX: 0,
            moveY: 0,
        }
        player.currentSpeed = 0
        player.boostDirectionX = 0
        player.boostDirectionY = 0
        player.respawnRequested = false
        player.collisionVisualType = "defeat"
        player.npcDefeatDamageRatio = 1
        player.collisionVisualUntil = player.deathUntil
        player.collisionImpactUntil = 0
        player.npcWinVisualUntil = 0
        player.playerWinVisualUntil = 0
        player.collisionImpactX = 0
        player.collisionImpactY = 0
        player.collisionRecoveryStartedAt = 0
        player.collisionRecoveryUntil = 0
        player.boostDisabledUntil = Math.max(player.boostDisabledUntil || 0, player.deathUntil)
        player.lastMoveX = 0
        player.lastMoveY = 0
        player.dummyRetaliationTargetId = ""
        player.dummyState = "idle"
        player.dummyPhase = 1
        player.dummyChargeDistanceRemaining = 0
        player.dummyChargeDistanceTotal = 0
        player.dummyChargeWindupStartedAt = 0
        player.dummyChargeWindupUntil = 0
        player.dummyRestUntil = 0
        player.dummyQueuedExtraCharges = 0
        player.currentHealth = 0
        if (isPersistentHumanPlayer(defeatedByPlayer)) {
            defeatedByPlayer.playerWinVisualUntil = now + 3000
            postStatsUpdate(defeatedByPlayer.id, { dummy_kills: 1 })
        }
        if (defeatedByPlayer && options.skipKillReward !== true) {
            this.handleRaiseSpeakiKillReward(defeatedByPlayer, player, now)
        }
    }

    fadeOutPumpkinNpc(player, now) {
        const didFade = super.fadeOutPumpkinNpc(player, now)
        if (didFade && player && player.isNeutralPumpkinNpc && !player.raiseSpeakiRespawnNeutral) {
            player.raiseSpeakiRespawnNeutral = true
        }
        return didFade
    }

    handleRaiseSpeakiKillReward(attacker, defeatedPlayer, now) {
        if (!attacker || attacker.isHouse || attacker.isPumpkinNpc || this.isPlayerDead(attacker)) {
            return
        }
        if (attacker.isDoubleSkin) {
            const rewardTarget = this.getRaiseSpeakiAttackRewardSource(attacker)
            if (rewardTarget && rewardTarget.unit) {
                this.handleRaiseSpeakiDoubleUnitKillReward(attacker, rewardTarget.unit, defeatedPlayer, now)
                return
            }
        }
        const defeatedLevel = Math.max(1, Number(defeatedPlayer.level || DEFAULT_LEVEL))
        this.spawnRaiseSpeakiLevelDrops(defeatedPlayer, Math.max(1, Math.round(defeatedLevel / 2)), now)
        attacker.playerWinVisualUntil = now + 900
        if (isPersistentHumanPlayer(attacker)) {
            this.updateStoredPlayerProgress(attacker)
        }
        attacker.raiseSpeakiLastRewardUnitIndex = -1
    }

    handleRaiseSpeakiDoubleUnitKillReward(attacker, attackerUnit, defeatedTarget, now) {
        if (!attacker || !attackerUnit || !defeatedTarget || attacker.isHouse || attacker.isPumpkinNpc || this.isPlayerDead(attacker)) {
            return
        }
        const defeatedLevel = defeatedTarget && defeatedTarget.raiseSpeakiLevel
            ? Math.max(1, Number(defeatedTarget.raiseSpeakiLevel || DEFAULT_LEVEL))
            : Math.max(1, Number(defeatedTarget.level || DEFAULT_LEVEL))
        this.spawnRaiseSpeakiLevelDrops({
            x: Number(defeatedTarget.x || attacker.x || 0),
            y: Number(defeatedTarget.y || attacker.y || 0),
        }, Math.max(1, Math.round(defeatedLevel / 2)), now)
        this.syncRaiseSpeakiPlayerStats(attacker)
        attacker.playerWinVisualUntil = now + 900
        if (isPersistentHumanPlayer(attacker)) {
            this.updateStoredPlayerProgress(attacker)
        }
        attacker.raiseSpeakiLastRewardUnitIndex = -1
    }

    chooseRaiseSpeakiDummyTarget(player) {
        const canTargetNeutralPumpkin = !isPumpkinSkinPlayer(player)
        const candidates = Array.from(this.players.values()).filter((candidate) => (
            candidate.id !== player.id &&
            !candidate.isHouse &&
            (!candidate.isPumpkinNpc || (canTargetNeutralPumpkin && candidate.isNeutralPumpkinNpc)) &&
            !this.isPlayerDead(candidate)
        ))
        if (!candidates.length) {
            player.dummyRetaliationTargetId = ""
            return null
        }
        const nextTarget = candidates[Math.floor(Math.random() * candidates.length)]
        player.dummyRetaliationTargetId = nextTarget.id
        return nextTarget
    }

    getDummyRetaliationTarget(player) {
        if (!player || !player.isDummy) {
            return null
        }
        const targetId = String(player.dummyRetaliationTargetId || "").trim()
        if (!targetId) {
            return this.chooseRaiseSpeakiDummyTarget(player)
        }
        const target = this.players.get(targetId)
        const canTargetNeutralPumpkin = !isPumpkinSkinPlayer(player)
        const invalidPumpkinTarget = Boolean(target && target.isPumpkinNpc && (!canTargetNeutralPumpkin || !target.isNeutralPumpkinNpc))
        if (!target || target.isHouse || invalidPumpkinTarget || this.isPlayerDead(target) || target.id === player.id) {
            return this.chooseRaiseSpeakiDummyTarget(player)
        }
        return target
    }

    startDummyRetaliationCharge(player, target) {
        if (!player || !player.isDummy || !target) {
            return
        }
        const diffX = target.x - player.x
        const diffY = target.y - player.y
        const distance = Math.hypot(diffX, diffY)
        if (distance > 0.001) {
            player.boostDirectionX = diffX / distance
            player.boostDirectionY = diffY / distance
        } else {
            const fallbackAngle = Number.isFinite(player.facingAngle) ? player.facingAngle : Math.random() * Math.PI * 2
            player.boostDirectionX = Math.cos(fallbackAngle)
            player.boostDirectionY = Math.sin(fallbackAngle)
        }
        player.currentSpeed = DUMMY_BASE_SPEED_PER_SECOND
        player.dummyChargeDistanceTotal = Math.max(1, distance) * NPC_EXTRA_CHARGE_DISTANCE_MULTIPLIER
        player.dummyChargeDistanceRemaining = player.dummyChargeDistanceTotal
        player.facingAngle = Math.atan2(player.boostDirectionY, player.boostDirectionX)
        player.dummyQueuedExtraCharges = 0
        player.dummyChargeWindupStartedAt = Date.now()
        player.dummyChargeWindupUntil = player.dummyChargeWindupStartedAt + RAISE_SPEAKI_AI_WINDUP_DURATION_MS
        player.dummyState = "windup"
        player.boostState = "idle"
    }

    updateDummy(player) {
        if (!player || !player.isDummy) {
            return { dx: 0, dy: 0 }
        }

        player.dummyPhase = 1
        const nearbyDrop = this.getNearestRaiseSpeakiLevelDrop(player)
        const target = this.getDummyRetaliationTarget(player)
        if (!target && !nearbyDrop) {
            player.dummyState = "idle"
            player.boostState = "idle"
            player.currentSpeed = DUMMY_BASE_SPEED_PER_SECOND
            player.boostDirectionX = 0
            player.boostDirectionY = 0
            return { dx: 0, dy: 0 }
        }

        const movementTarget = nearbyDrop || target
        const diffX = Number(movementTarget.x || 0) - Number(player.x || 0)
        const diffY = Number(movementTarget.y || 0) - Number(player.y || 0)
        const distance = Math.hypot(diffX, diffY)

        if (player.dummyState === "rest") {
            player.boostState = "idle"
            player.currentSpeed = DUMMY_BASE_SPEED_PER_SECOND
            if (player.dummyRestUntil > Date.now()) {
                return { dx: 0, dy: 0 }
            }
            if (player.dummyQueuedExtraCharges > 0) {
                player.dummyQueuedExtraCharges = Math.max(0, player.dummyQueuedExtraCharges - 1)
                player.boostDirectionX = diffX / Math.max(1, distance)
                player.boostDirectionY = diffY / Math.max(1, distance)
                player.dummyChargeDistanceTotal = distance * NPC_EXTRA_CHARGE_DISTANCE_MULTIPLIER
                player.dummyChargeDistanceRemaining = player.dummyChargeDistanceTotal
                player.facingAngle = Math.atan2(player.boostDirectionY, player.boostDirectionX)
                if (player.dummyPhase >= 3) {
                    player.dummyState = "charging"
                    player.boostState = "charging"
                } else {
                    player.dummyState = "windup"
                    player.boostState = "idle"
                    player.dummyChargeWindupStartedAt = Date.now()
                    player.dummyChargeWindupUntil = player.dummyChargeWindupStartedAt + RAISE_SPEAKI_AI_WINDUP_DURATION_MS
                }
                return { dx: 0, dy: 0 }
            }
            player.dummyState = "chase"
        }

        if (player.dummyState === "windup") {
            if (player.dummyChargeWindupUntil > Date.now()) {
                if (distance > 0.001) {
                    player.boostDirectionX = diffX / distance
                    player.boostDirectionY = diffY / distance
                    player.facingAngle = Math.atan2(player.boostDirectionY, player.boostDirectionX)
                }
                return { dx: 0, dy: 0 }
            }
            player.dummyState = "charging"
            player.boostState = "charging"
            player.dummyChargeWindupStartedAt = 0
            player.dummyChargeWindupUntil = 0
            return {
                dx: player.boostDirectionX || 0,
                dy: player.boostDirectionY || 0,
            }
        }

        if (player.dummyState === "charging") {
            if (Math.hypot(Number(player.boostDirectionX || 0), Number(player.boostDirectionY || 0)) < 0.001) {
                player.dummyState = "chase"
                player.boostState = "idle"
                player.currentSpeed = DUMMY_BASE_SPEED_PER_SECOND
                return { dx: 0, dy: 0 }
            }
            return {
                dx: player.boostDirectionX || 0,
                dy: player.boostDirectionY || 0,
            }
        }

        if (!nearbyDrop && distance <= NPC_CHARGE_TRIGGER_DISTANCE) {
            this.startDummyRetaliationCharge(player, target)
            return { dx: 0, dy: 0 }
        }

        if (distance < 0.001) {
            return { dx: 0, dy: 0 }
        }

        player.dummyState = "chase"
        return {
            dx: diffX / distance,
            dy: diffY / distance,
        }
    }

    applyRaiseSpeakiDamage(targetPlayer, damageAmount) {
        if (!targetPlayer || targetPlayer.isNpc || targetPlayer.isDoubleSkin) {
            return
        }
        targetPlayer.defeatReceivedCount = Math.max(0, Number(targetPlayer.defeatReceivedCount || 0)) + damageAmount
        this.syncRaiseSpeakiPlayerStats(targetPlayer)
    }

    shouldRaiseSpeakiPlayerDie(player) {
        if (!player || player.isNpc || player.isDoubleSkin) {
            return false
        }
        const deathTriggerCount = Math.max(1, getPlayerDeathTriggerCount(player))
        return Number(player.defeatReceivedCount || 0) >= deathTriggerCount
    }

    applyDoubleSkinDefeat(player, now, normalX, normalY, defeatedByPlayer = null, splitBounceMagnitude = null, damageAmount = 1) {
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

        const appliedDamageAmount = Math.max(1, Math.round(Number(damageAmount || 1)))
        const nextHealth = Math.max(0, this.getRaiseSpeakiDoubleUnitCurrentHealth(targetUnit) - appliedDamageAmount)
        const shouldSplitOnly = aliveIndices.length > 1 && player.doubleMerged && Math.random() < DOUBLE_SPLIT_PROBABILITY
        if (shouldSplitOnly) {
            targetUnit.health = nextHealth
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
            const unitABounceDistance = Math.hypot(leftBounce.dx, leftBounce.dy) || 1
            const unitBBounceDistance = Math.hypot(rightBounce.dx, rightBounce.dy) || 1
            unitA.lastMoveX = (leftBounce.dx / unitABounceDistance) * appliedSplitBounceMagnitude
            unitA.lastMoveY = (leftBounce.dy / unitABounceDistance) * appliedSplitBounceMagnitude
            unitB.lastMoveX = (rightBounce.dx / unitBBounceDistance) * appliedSplitBounceMagnitude
            unitB.lastMoveY = (rightBounce.dy / unitBBounceDistance) * appliedSplitBounceMagnitude
            unitA.x = this.clampToWorld(unitA.x + unitA.lastMoveX * 0.35)
            unitA.y = this.clampToWorld(unitA.y + unitA.lastMoveY * 0.35)
            unitB.x = this.clampToWorld(unitB.x + unitB.lastMoveX * 0.35)
            unitB.y = this.clampToWorld(unitB.y + unitB.lastMoveY * 0.35)
            if (targetUnit.health <= 0) {
                targetUnit.inactiveUntil = now + DOUBLE_INACTIVE_FADE_MS
                this.handleRaiseSpeakiUnitDeath(player, targetUnit, defeatedByPlayer, now)
            }
            this.recenterDoublePlayer(player)
            this.syncRaiseSpeakiPlayerStats(player)
            return true
        }

        targetUnit.health = nextHealth
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
            this.handleRaiseSpeakiUnitDeath(player, targetUnit, defeatedByPlayer, now)
        }

        const stillAlive = getDoubleAliveUnitIndices(player)
        if (!stillAlive.length) {
            this.syncRaiseSpeakiPlayerStats(player)
            this.triggerPlayerDeath(player, now, defeatedByPlayer, { skipKillReward: true })
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
        this.syncRaiseSpeakiPlayerStats(player)
        return true
    }

    handleRaiseSpeakiUnitDeath(player, defeatedUnit, defeatedByPlayer, now) {
        if (!player || !defeatedUnit) {
            return
        }
        defeatedUnit.raiseSpeakiLevel = this.getRaiseSpeakiDoubleUnitLevel(defeatedUnit)
        if (defeatedByPlayer) {
            const rewardSource = this.getRaiseSpeakiAttackRewardSource(defeatedByPlayer, player.x - defeatedByPlayer.x, player.y - defeatedByPlayer.y)
            if (rewardSource && rewardSource.unit) {
                this.handleRaiseSpeakiDoubleUnitKillReward(defeatedByPlayer, rewardSource.unit, defeatedUnit, now)
            } else {
                this.handleRaiseSpeakiKillReward(defeatedByPlayer, defeatedUnit, now)
            }
        }
    }

    handleInput(player, data) {
        super.handleInput(player, data)
        if (!player) {
            return
        }
        const specialActive = Boolean(player.input && player.input.special)
        if (specialActive && !player.raiseSpeakiSpecialPressed) {
            player.raiseSpeakiSpecialRequested = true
        }
        player.raiseSpeakiSpecialPressed = specialActive
    }

    canUseRaiseSpeakiDoubleReviveSkill(player) {
        if (!player || player.isNpc || player.isDummy || player.isPumpkinNpc || this.isPlayerDead(player) || !player.isDoubleSkin || !Array.isArray(player.doubleUnits)) {
            return false
        }
        const aliveIndices = getDoubleAliveUnitIndices(player)
        if (aliveIndices.length !== 1) {
            return false
        }
        const liveUnit = player.doubleUnits[aliveIndices[0]]
        if (!liveUnit) {
            return false
        }
        return this.getRaiseSpeakiDoubleUnitLevel(liveUnit) >= 2 && this.getRaiseSpeakiDoubleUnitCurrentHealth(liveUnit) >= 2
    }

    useRaiseSpeakiDoubleReviveSkill(player, now) {
        if (!this.canUseRaiseSpeakiDoubleReviveSkill(player)) {
            return false
        }
        const aliveIndices = getDoubleAliveUnitIndices(player)
        const liveIndex = aliveIndices[0]
        const reviveIndex = liveIndex === 0 ? 1 : 0
        const liveUnit = player.doubleUnits[liveIndex]
        const revivedUnit = player.doubleUnits[reviveIndex]
        if (!liveUnit || !revivedUnit) {
            return false
        }

        const liveLevel = this.getRaiseSpeakiDoubleUnitLevel(liveUnit)
        const liveHealth = this.getRaiseSpeakiDoubleUnitCurrentHealth(liveUnit)
        const revivedLevel = Math.floor(liveLevel / 2)
        const remainingLevel = liveLevel - revivedLevel
        const revivedHealth = Math.floor(liveHealth / 2)
        const remainingHealth = liveHealth - revivedHealth
        if (revivedLevel < 1 || revivedHealth < 1) {
            return false
        }

        const revivedState = createDoubleUnitState(now)
        Object.assign(revivedUnit, revivedState)
        this.applyRaiseSpeakiDoubleUnitLevel(liveUnit, remainingLevel, { preserveHealth: true })
        this.applyRaiseSpeakiDoubleUnitLevel(revivedUnit, revivedLevel, { preserveHealth: false })
        liveUnit.health = Math.max(1, Math.min(remainingLevel, remainingHealth))
        revivedUnit.health = Math.max(1, Math.min(revivedLevel, revivedHealth))

        player.doubleMerged = true
        player.doubleSeparationPhase = "merged"
        player.doubleMergeLockUntil = 0
        player.doubleSeparatedAt = 0
        player.doubleDefeatProtectedUntil = 0
        player.doubleDefeatProtectedById = ""
        player.doubleSplitProtectedUntil = 0
        player.doubleSplitProtectedById = ""
        liveUnit.x = this.clampToWorld(player.x)
        liveUnit.y = this.clampToWorld(player.y)
        revivedUnit.x = this.clampToWorld(player.x)
        revivedUnit.y = this.clampToWorld(player.y)
        this.ensureDoubleUnitLayout(player, now)
        this.recenterDoublePlayer(player)
        this.syncRaiseSpeakiPlayerStats(player)
        this.updateStoredPlayerProgress(player)
        return true
    }

    processRaiseSpeakiSpecialSkills(now) {
        for (const player of this.players.values()) {
            if (!player || !player.raiseSpeakiSpecialRequested) {
                continue
            }
            player.raiseSpeakiSpecialRequested = false
            this.useRaiseSpeakiDoubleReviveSkill(player, now)
        }
    }

    resolvePlayerCollisions() {
        const players = Array.from(this.players.values())
        const now = Date.now()

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
                    if (this.claimPumpkinNpc(otherPlayer, pumpkinPlayer, now)) {
                        continue
                    }
                    if (this.applyPumpkinNpcDefeat(pumpkinPlayer, otherPlayer, now)) {
                        continue
                    }
                    this.applyStandardCollisionBounce(playerA, playerB, now, normalX, normalY, overlap)
                    continue
                }

                if (playerA.isHouse || playerB.isHouse) {
                    continue
                }

                const relativeMoveX = playerB.lastMoveX - playerA.lastMoveX
                const relativeMoveY = playerB.lastMoveY - playerA.lastMoveY
                const relativeImpactSpeed = Math.max(0, -(relativeMoveX * normalX + relativeMoveY * normalY))
                const bounceDistance = Math.min(
                    COLLISION_MAX_BOUNCE_DISTANCE,
                    COLLISION_BOUNCE_DISTANCE + relativeImpactSpeed * COLLISION_SPEED_BOUNCE_MULTIPLIER
                )
                const separation = overlap / 2 + bounceDistance
                const separationProfile = this.getCollisionSeparationProfile(playerA, playerB)
                const scaledSeparation = separation * separationProfile.totalScale
                const collisionVisualDuration = Math.min(
                    COLLISION_VISUAL_MAX_DURATION_MS,
                    COLLISION_VISUAL_BASE_DURATION_MS + relativeImpactSpeed * COLLISION_VISUAL_SPEED_DURATION_MULTIPLIER_MS
                )
                const collisionVisualUntil = now + collisionVisualDuration
                const collisionImpactUntil = now + COLLISION_IMPACT_DURATION_MS
                const playerAPumpkinBoostSplitting = isPumpkinSkinPlayer(playerA) &&
                    !playerA.isNpc &&
                    !playerA.isHouse &&
                    !playerA.isPumpkinNpc &&
                    (playerA.boostState === "charging" || playerA.boostState === "cooldown")
                const playerBPumpkinBoostSplitting = isPumpkinSkinPlayer(playerB) &&
                    !playerB.isNpc &&
                    !playerB.isHouse &&
                    !playerB.isPumpkinNpc &&
                    (playerB.boostState === "charging" || playerB.boostState === "cooldown")
                const playerAAttackDot = playerA.lastMoveX * normalX + playerA.lastMoveY * normalY
                const playerBAttackDot = -(playerB.lastMoveX * normalX + playerB.lastMoveY * normalY)
                const playerAAttacking = isPlayerAttackingForCollision(playerA) && playerAAttackDot > COLLISION_ATTACK_DIRECTION_THRESHOLD
                const playerBAttacking = isPlayerAttackingForCollision(playerB) && playerBAttackDot > COLLISION_ATTACK_DIRECTION_THRESHOLD
                this.updateRaiseSpeakiAttackSequence(playerA)
                this.updateRaiseSpeakiAttackSequence(playerB)
                const playerAProtectedFromB = this.isSplitDefeatProtected(playerA, playerB, now)
                const playerBProtectedFromA = this.isSplitDefeatProtected(playerB, playerA, now)
                const playerAAlreadyHitByB = this.hasRaiseSpeakiDashHitProtection(playerA, playerB)
                const playerBAlreadyHitByA = this.hasRaiseSpeakiDashHitProtection(playerB, playerA)
                const playerADamage = this.getRaiseSpeakiAttackDamage(playerA, normalX, normalY)
                const playerBDamage = this.getRaiseSpeakiAttackDamage(playerB, -normalX, -normalY)

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

                if (playerAAttacking && playerBAttacking) {
                    if (!playerAProtectedFromB && !playerAAlreadyHitByB) {
                        playerA.collisionVisualType = "defeat"
                        playerA.collisionImpactX = -normalX
                        playerA.collisionImpactY = -normalY
                        this.applyRaiseSpeakiDamage(playerA, playerBDamage)
                        this.markRaiseSpeakiDashHit(playerA, playerB)
                        playerB.defeatDealtCount += 1
                    }
                    if (!playerBProtectedFromA && !playerBAlreadyHitByA) {
                        playerB.collisionVisualType = "defeat"
                        playerB.collisionImpactX = normalX
                        playerB.collisionImpactY = normalY
                        playerA.raiseSpeakiLastRewardUnitIndex = playerA.isDoubleSkin ? this.getRaiseSpeakiAttackRewardSource(playerA, normalX, normalY).unitIndex : -1
                        this.applyRaiseSpeakiDamage(playerB, playerADamage)
                        this.markRaiseSpeakiDashHit(playerB, playerA)
                        playerA.defeatDealtCount += 1
                    }
                } else if (playerAAttacking) {
                    if (!playerBProtectedFromA && !playerBAlreadyHitByA) {
                        playerB.collisionVisualType = "defeat"
                        playerB.collisionImpactX = normalX
                        playerB.collisionImpactY = normalY
                        playerA.defeatDealtCount += 1
                        playerA.raiseSpeakiLastRewardUnitIndex = playerA.isDoubleSkin ? this.getRaiseSpeakiAttackRewardSource(playerA, normalX, normalY).unitIndex : -1
                        this.applyRaiseSpeakiDamage(playerB, playerADamage)
                        this.markRaiseSpeakiDashHit(playerB, playerA)
                        if (playerB.isDummy && !playerA.isNpc && !playerA.isDummy) {
                            playerB.dummyRetaliationTargetId = playerA.id
                        }
                    }
                } else if (playerBAttacking) {
                    if (!playerAProtectedFromB && !playerAAlreadyHitByB) {
                        playerA.collisionVisualType = "defeat"
                        playerA.collisionImpactX = -normalX
                        playerA.collisionImpactY = -normalY
                        playerB.defeatDealtCount += 1
                        playerB.raiseSpeakiLastRewardUnitIndex = playerB.isDoubleSkin ? this.getRaiseSpeakiAttackRewardSource(playerB, -normalX, -normalY).unitIndex : -1
                        this.applyRaiseSpeakiDamage(playerA, playerBDamage)
                        this.markRaiseSpeakiDashHit(playerA, playerB)
                        if (playerA.isDummy && !playerB.isNpc && !playerB.isDummy) {
                            playerA.dummyRetaliationTargetId = playerB.id
                        }
                    }
                }

                this.applyCollisionSlow(playerA, now, collisionVisualUntil)
                this.applyCollisionSlow(playerB, now, collisionVisualUntil)

                let doubleAHandled = false
                let doubleBHandled = false
                let pumpkinASplitHandled = false
                let pumpkinBSplitHandled = false
                let pumpkinABoostSplitHandled = false
                let pumpkinBBoostSplitHandled = false
                if (playerA.collisionVisualType === "defeat" && playerA.isDoubleSkin) {
                    doubleAHandled = this.applyDoubleSkinDefeat(playerA, now, normalX, normalY, playerB, scaledSeparation, playerBDamage)
                }
                if (playerB.collisionVisualType === "defeat" && playerB.isDoubleSkin) {
                    doubleBHandled = this.applyDoubleSkinDefeat(playerB, now, -normalX, -normalY, playerA, scaledSeparation, playerADamage)
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

                if (playerA.collisionVisualType === "defeat" && !playerA.isDoubleSkin && !playerA.isNpc && this.shouldRaiseSpeakiPlayerDie(playerA)) {
                    if (playerA.isDummy) {
                        this.triggerDummyDeath(playerA, now, playerB)
                    } else {
                        this.triggerPlayerDeath(playerA, now, playerB)
                    }
                }
                if (playerB.collisionVisualType === "defeat" && !playerB.isDoubleSkin && !playerB.isNpc && this.shouldRaiseSpeakiPlayerDie(playerB)) {
                    if (playerB.isDummy) {
                        this.triggerDummyDeath(playerB, now, playerA)
                    } else {
                        this.triggerPlayerDeath(playerB, now, playerA)
                    }
                }

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

                this.applyCollisionPush(playerA, -normalX, -normalY, scaledSeparation * pushRatioA * pushScaleA)
                this.applyCollisionPush(playerB, normalX, normalY, scaledSeparation * pushRatioB * pushScaleB)
            }
        }
    }

    update() {
        this.syncRaiseSpeakiAttackSequences()
        this.processRaiseSpeakiSpecialSkills(Date.now())
        super.update()
        this.syncRaiseSpeakiAttackSequences()
        this.processRaiseSpeakiLevelDrops(Date.now())
        this.processPendingNeutralPumpkinRespawns()
        this.normalizeNeutralPumpkinCount()
        for (const player of Array.from(this.players.values())) {
            if (player.isHouse) {
                this.grid.remove(player)
                this.players.delete(player.id)
                continue
            }
            if (!this.isPlayerDead(player)) {
                this.applyRaiseSpeakiLevel(player, player.isPumpkinNpc ? DEFAULT_PUMPKIN_LEVEL : Number(player.level || DEFAULT_LEVEL))
            } else {
                player.currentHealth = 0
            }
        }
    }
}

module.exports = RaiseSpeakiWorld
