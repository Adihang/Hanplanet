const { TICK_RATE } = require("../config/config")
const { getGameplaySettings } = require("../config/gameplaySettings")
const { encode } = require("@msgpack/msgpack")

const IDLE_TIMEOUT_MS = 180000
const GAMEPLAY_SETTINGS = getGameplaySettings()
const prevStateByPlayer = new Map()

function valueUnchanged(curr, prev) {
    if (curr === prev) return true
    if (curr === null || prev === null) return false
    if (typeof curr === "object") return JSON.stringify(curr) === JSON.stringify(prev)
    return false
}

function buildPlayerState(world, p, now) {
    const deathActive = Boolean(p.deathUntil)
    const deathAnimating = now < Number(p.deathUntil || 0)
    const deathFadeProgress = deathAnimating && p.deathStartedAt && p.deathUntil > p.deathStartedAt
        ? (now - p.deathStartedAt) / (p.deathUntil - p.deathStartedAt)
        : (deathActive ? 1 : 0)
    const deathRespawnReady = deathActive && now >= Number(p.deathUntil || 0)
    const boostLockRemainingMs = Math.max(0, Number(p.boostDisabledUntil || 0) - now)
    const boostLockDurationMs = Math.max(0, Number(p.boostDisabledUntil || 0) - Number(p.boostDisabledStartedAt || 0))
    const collisionRecoveryRemainingMs = Math.max(0, Number(p.collisionRecoveryUntil || 0) - now)
    const collisionRecoveryDurationMs = Math.max(0, Number(p.collisionRecoveryUntil || 0) - Number(p.collisionRecoveryStartedAt || 0))
    const pumpkinFadeOutActive = Boolean(p.isPumpkinNpc) && now < Number(p.pumpkinFadeOutUntil || 0)
    const pumpkinFadeOutProgress = pumpkinFadeOutActive && p.pumpkinFadeOutStartedAt && p.pumpkinFadeOutUntil > p.pumpkinFadeOutStartedAt
        ? (now - p.pumpkinFadeOutStartedAt) / (p.pumpkinFadeOutUntil - p.pumpkinFadeOutStartedAt)
        : (pumpkinFadeOutActive ? 0 : 1)
    const playerWinVisualActive = !p.isNpc && !p.isDummy && now < Number(p.playerWinVisualUntil || 0)
    const stopVisualActive = !p.isNpc && !p.isDummy &&
        !deathActive &&
        !playerWinVisualActive &&
        now - Number(p.lastActiveInputAt || 0) >= 3000 &&
        Math.abs(Number(p.lastMoveX || 0)) < 0.001 &&
        Math.abs(Number(p.lastMoveY || 0)) < 0.001 &&
        !Boolean(p.input && (p.input.up || p.input.down || p.input.left || p.input.right || p.input.boost))
    const doubleState = (!p.isNpc && !p.isDummy && p.isDoubleSkin && Array.isArray(p.doubleUnits))
        ? {
            merged: Boolean(p.doubleMerged),
            phase: String(p.doubleSeparationPhase || "merged"),
            units: p.doubleUnits.map((unit) => ({
                health: Number(unit.health || 0),
                level: Math.max(1, Number(unit.raiseSpeakiLevel || 1)),
                currentHealth: Math.max(0, Number(unit.health || 0)),
                maxHealth: Math.max(1, Number(unit.raiseSpeakiMaxHealthSegments || unit.raiseSpeakiLevel || 1)),
                sizeMultiplier: Math.max(0.6, Number(unit.sizeMultiplier || 1)),
                x: Number(unit.x || p.x || 0),
                y: Number(unit.y || p.y || 0),
                velocityX: Number(unit.lastMoveX || 0) * TICK_RATE,
                velocityY: Number(unit.lastMoveY || 0) * TICK_RATE,
                facingAngle: typeof unit.facingAngle === "number" ? unit.facingAngle : 0,
                currentSpeed: Number(unit.currentSpeed || p.currentSpeed || 0),
                boostState: String(unit.boostState || "idle"),
                collisionActive: now < Number(unit.collisionVisualUntil || 0),
                collisionImpactActive: now < Number(unit.collisionImpactUntil || 0),
                collisionVisualType: String(unit.collisionVisualType || "win"),
                collisionImpactX: Number(unit.collisionImpactX || 0),
                collisionImpactY: Number(unit.collisionImpactY || 0),
                collisionRecoveryActive: now < Number(unit.collisionRecoveryUntil || 0),
                collisionRecoveryRemainingMs: Math.max(0, Number(unit.collisionRecoveryUntil || 0) - now),
                collisionRecoveryDurationMs: Math.max(0, Number(unit.collisionRecoveryUntil || 0) - Number(unit.collisionRecoveryStartedAt || 0)),
                boostLockedActive: now < Number(unit.boostDisabledUntil || 0),
                boostLockRemainingMs: Math.max(0, Number(unit.boostDisabledUntil || 0) - now),
                boostLockDurationMs: Math.max(0, Number(unit.boostDisabledUntil || 0) - Number(unit.boostDisabledStartedAt || 0)),
                inactive: Number(unit.health || 0) <= 0 || now < Number(unit.inactiveUntil || 0),
            })),
        }
        : null

    return {
        id: p.id,
        displayName: p.isPumpkinNpc ? "" : String(p.displayName || p.dummyDefaultDisplayName || p.id || ""),
        skinName: p.skinName || "default",
        pumpkinBaseSkinName: String(p.pumpkinBaseSkinName || ""),
        pumpkinNtrTriggerCount: Number(p.pumpkinNtrTriggerCount || 0),
        x: Number(p.x || 0),
        y: Number(p.y || 0),
        velocityX: Number(p.lastMoveX || 0) * TICK_RATE,
        velocityY: Number(p.lastMoveY || 0) * TICK_RATE,
        facingAngle: typeof p.facingAngle === "number" ? p.facingAngle : 0,
        isDummy: Boolean(p.isDummy),
        isNpc: Boolean(p.isNpc),
        isPumpkinNpc: Boolean(p.isPumpkinNpc),
        isHouse: Boolean(p.isHouse),
        houseStage: 0,
        houseHealth: null,
        houseMaxHealth: null,
        houseImageKey: "",
        npcPhase: p.isNpc ? Number(p.npcPhase || 1) : 1,
        npcPhaseTwoRatio: p.isNpc ? Number(GAMEPLAY_SETTINGS.npc_phase_two_health_ratio || 0.6) : null,
        npcPhaseThreeRatio: p.isNpc ? Number(GAMEPLAY_SETTINGS.npc_phase_three_health_ratio || 0.2) : null,
        npcState: p.isNpc ? (p.npcState || "idle") : "",
        collisionActive: now < Number(p.collisionVisualUntil || 0),
        collisionImpactActive: now < Number(p.collisionImpactUntil || 0),
        collisionVisualType: p.collisionVisualType || "win",
        collisionImpactX: Number(p.collisionImpactX || 0),
        collisionImpactY: Number(p.collisionImpactY || 0),
        boostState: p.boostState || "idle",
        currentSpeed: Number(p.currentSpeed || 0),
        collisionRecoveryActive: now < Number(p.collisionRecoveryUntil || 0),
        collisionRecoveryRemainingMs: collisionRecoveryRemainingMs,
        collisionRecoveryDurationMs: collisionRecoveryDurationMs,
        pumpkinFadeOutActive: pumpkinFadeOutActive,
        pumpkinFadeOutProgress: Math.max(0, Math.min(1, pumpkinFadeOutProgress)),
        playerWinVisualActive: playerWinVisualActive,
        stopVisualActive: stopVisualActive,
        boostLockedActive: now < Number(p.boostDisabledUntil || 0),
        boostLockRemainingMs: boostLockRemainingMs,
        boostLockDurationMs: boostLockDurationMs,
        deathActive: deathActive,
        deathFadeProgress: Math.max(0, Math.min(1, deathFadeProgress)),
        deathRespawnReady: deathRespawnReady,
        livesRemaining: p.isNpc || p.isDummy || p.isPumpkinNpc ? null : 1,
        npcMaxHealth: typeof p.npcMaxHealth === "number" ? p.npcMaxHealth : null,
        npcHealth: typeof p.npcHealth === "number" ? p.npcHealth : null,
        npcDefeatDamageRatio: p.isNpc ? Number(p.npcDefeatDamageRatio || 0) : 0,
        npcWinVisualActive: p.isNpc ? now < Number(p.npcWinVisualUntil || 0) : false,
        npcDeathAnimating: p.isNpc ? deathAnimating : false,
        npcChargeWindupProgress: 0,
        defeatReceivedCount: Number(p.defeatReceivedCount || 0),
        defeatDealtCount: Number(p.defeatDealtCount || 0),
        roundResetAnnouncementActive: false,
        doubleState: doubleState,
        encounterStage: 0,
        encounterAnnouncementKey: "",
        encounterCountdownSeconds: 0,
        encounterFinaleActive: false,
        encounterFinaleUntil: 0,
        level: Math.max(1, Number(p.level || 1)),
        currentHealth: Math.max(0, Number(p.currentHealth || 0)),
        maxHealth: Math.max(1, Number(p.maxHealth || p.level || 1)),
        sizeMultiplier: Math.max(0.6, Number(p.sizeMultiplier || 1)),
    }
}

function startGameLoop(world, wss, clientFilter = null) {
    const intervalMs = Math.floor(1000 / TICK_RATE)

    setInterval(() => {
        const activeClients = Array.from(wss.clients).filter((client) => (
            client &&
            client.readyState === 1 &&
            client.player &&
            (typeof clientFilter !== "function" || clientFilter(client))
        ))
        if (!activeClients.length) {
            return
        }

        world.update()
        const now = Date.now()
        const state = Array.from(world.players.values()).map((player) => buildPlayerState(world, player, now))
        const drops = Array.isArray(world.raiseSpeakiLevelDrops)
            ? world.raiseSpeakiLevelDrops.map((drop) => ({
                id: String(drop.id || ""),
                x: Number(drop.x || 0),
                y: Number(drop.y || 0),
                originX: Number(drop.originX || drop.x || 0),
                originY: Number(drop.originY || drop.y || 0),
                createdAt: Number(drop.createdAt || 0),
                fadeStartsAt: Number(drop.fadeStartsAt || 0),
                expiresAt: Number(drop.expiresAt || 0),
            }))
            : []
        const currentIds = new Set(state.map((player) => player.id))
        const removed = []

        for (const id of prevStateByPlayer.keys()) {
            if (!currentIds.has(id)) removed.push(id)
        }

        const delta = state.map((player) => {
            const prev = prevStateByPlayer.get(player.id)
            if (!prev) {
                return Object.assign({ __new: true }, player)
            }
            const diff = { id: player.id }
            let changed = false
            for (const key of Object.keys(player)) {
                if (key === "id") continue
                if (!valueUnchanged(player[key], prev[key])) {
                    diff[key] = player[key]
                    changed = true
                }
            }
            return changed ? diff : { id: player.id }
        })

        for (const id of removed) prevStateByPlayer.delete(id)
        for (const player of state) prevStateByPlayer.set(player.id, player)

        const serialized = encode({ d: delta, r: removed, l: drops })
        let fullStateSerialized = null

        for (const client of activeClients) {
            if (client.player && now - Number(client.lastActiveInputAt || 0) >= IDLE_TIMEOUT_MS) {
                if (client.readyState === 1) {
                    client.send(encode({ type: "idle_timeout" }))
                    client.close(4002, "idle_timeout")
                }
                continue
            }
            if (!client.player || client.readyState !== 1) {
                continue
            }
            if (client.needsFullState) {
                if (!fullStateSerialized) {
                    fullStateSerialized = encode({
                        d: state.map((player) => Object.assign({ __new: true }, player)),
                        r: [],
                        l: drops,
                    })
                }
                client.send(fullStateSerialized)
                client.needsFullState = false
                continue
            }
            client.send(serialized)
        }
    }, intervalMs)
}

module.exports = startGameLoop
