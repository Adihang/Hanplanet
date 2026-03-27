const { WORLD_SIZE } = require("../config/config")

class Player {
    constructor(id, options = {}) {
        const now = Date.now()
        const safeId = String(id || "").trim() || Math.random().toString(36).slice(2)

        this.id = safeId
        this.connectionKey = String(options.connectionKey || safeId).trim() || safeId
        this.displayName = String(options.displayName || safeId).trim() || safeId
        this.skinName = String(options.skinName || "default").trim() || "default"
        this.isAi = Boolean(options.isAi)
        this.isGuest = Boolean(options.isGuest)
        this.isPumpkinNpc = Boolean(options.isPumpkinNpc)

        this.x = Math.random() * WORLD_SIZE
        this.y = Math.random() * WORLD_SIZE
        this.lastMoveX = 0
        this.lastMoveY = 0
        this.facingAngle = 0

        this.input = {
            up: false,
            down: false,
            left: false,
            right: false,
            boost: false,
            respawn: false,
            moveX: 0,
            moveY: 0,
        }

        this.level = 1
        this.maxHealth = 1
        this.health = 1
        this.attack = 1
        this.sizeMultiplier = 1

        this.baseSpeed = 220
        this.maxBoostSpeed = 320
        this.boostAcceleration = 360
        this.boostCooldownPerSecond = 280
        this.boostDurationMs = 1238
        this.postBoostCooldownMs = 3000
        this.currentSpeed = this.baseSpeed
        this.boostState = "idle"
        this.boostDirectionX = 0
        this.boostDirectionY = 0
        this.boostStartedAt = 0
        this.boostEndsAt = 0
        this.boostDisabledStartedAt = 0
        this.boostDisabledUntil = 0

        this.collisionVisualUntil = 0
        this.collisionImpactUntil = 0
        this.collisionVisualType = "win"
        this.collisionImpactX = 0
        this.collisionImpactY = 0
        this.collisionRecoveryStartedAt = 0
        this.collisionRecoveryUntil = 0
        this.playerWinVisualUntil = 0

        this.deathStartedAt = 0
        this.deathUntil = 0
        this.respawnRequested = false

        this.defeatReceivedCount = 0
        this.defeatDealtCount = 0
        this.killCount = 0
        this.deathCount = 0

        this.lastActiveInputAt = now
        this.sessionStartedAt = now
        this.attackCooldownUntil = 0
        this.lastDamagedById = ""
        this.targetId = ""
    }
}

module.exports = Player
