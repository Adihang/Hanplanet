const { TICK_RATE } = require("../config/config")
const { getGameplaySettings } = require("../config/gameplaySettings")
const { encode } = require("@msgpack/msgpack")
// 입력이 오래 없으면 연결을 정리해 유령 플레이어가 남지 않게 한다.
const IDLE_TIMEOUT_MS = 180000
const GAMEPLAY_SETTINGS = getGameplaySettings()

// 이전 틱의 플레이어 state를 추적해 delta 계산에 사용한다.
// key: player.id, value: 직전 틱의 state object
const prevStateByPlayer = new Map()

// 두 값이 같은지 비교한다. object/array는 JSON.stringify로 비교한다.
function valueUnchanged(curr, prev) {
    if (curr === prev) return true
    if (curr === null || prev === null) return false
    if (typeof curr === "object") return JSON.stringify(curr) === JSON.stringify(prev)
    return false
}

// 게임 루프를 시작한다. 매 틱마다 월드를 업데이트하고, 유휴 연결을 정리한 뒤
// 모든 연결된 클라이언트에 전체 엔티티 상태를 브로드캐스트한다.
// world: 월드 시뮬레이션 인스턴스
// wss: WebSocket 서버 인스턴스
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

        // 1. 월드 시뮬레이션을 한 틱 진행
        world.update()
        const now = Date.now()

        // 2. 월드 전역 값은 한 번만 계산한다.
        const roundResetAnnouncementActive = now < (world.roundResetAnnouncementUntil || 0)
        const encounterStage = Number(world.encounterStage || 0)
        const encounterAnnouncementKey = String(world.encounterAnnouncementKey || "")
        const encounterCountdownSeconds = world.getEncounterCountdownSecondsRemaining(now)
        const encounterFinaleActive = now < Number(world.encounterFinaleUntil || 0)
        const encounterFinaleUntil = Number(world.encounterFinaleUntil || 0)

        // 3. 모든 클라이언트에 동일한 상태를 내려주므로 state 계산과 직렬화를 한 번만 수행한다.
        const state = Array.from(world.players.values()).map((p) => {
            const displayName = p.isDummy
                ? (p.dummyRetaliationTargetId ? "네르는 이렇게 폭력적인 역할이 아니란 말이에요!" : (p.dummyDefaultDisplayName || "저는 네르에요"))
                : (p.isPumpkinNpc ? "" : p.id)
            const deathActive = Boolean(p.deathUntil)
            const deathAnimating = now < (p.deathUntil || 0)
            const livesRemaining = p.isNpc || p.isDummy || p.isPumpkinNpc ? null : Math.max(0, Number(world.sharedLivesRemaining || 0))
            const deathFadeProgress = deathAnimating && p.deathStartedAt && p.deathUntil > p.deathStartedAt
                ? (now - p.deathStartedAt) / (p.deathUntil - p.deathStartedAt)
                : (deathActive ? 1 : 0)
            const deathRespawnReady = deathActive && now >= p.deathUntil && (livesRemaining === null || livesRemaining > 0)
            const npcChargeWindupProgress = p.isNpc && p.npcChargeWindupStartedAt && p.npcChargeWindupUntil > p.npcChargeWindupStartedAt
                ? (now - p.npcChargeWindupStartedAt) / (p.npcChargeWindupUntil - p.npcChargeWindupStartedAt)
                : 0
            const npcDeathAnimating = p.isNpc && deathActive && now < (p.deathUntil || 0)
            const boostLockRemainingMs = Math.max(0, (p.boostDisabledUntil || 0) - now)
            const boostLockDurationMs = Math.max(0, (p.boostDisabledUntil || 0) - (p.boostDisabledStartedAt || 0))
            const collisionRecoveryRemainingMs = Math.max(0, (p.collisionRecoveryUntil || 0) - now)
            const collisionRecoveryDurationMs = Math.max(0, (p.collisionRecoveryUntil || 0) - (p.collisionRecoveryStartedAt || 0))
            const pumpkinFadeOutActive = p.isPumpkinNpc && now < Number(p.pumpkinFadeOutUntil || 0)
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
                    }))
                }
                : null

            return {
                // 클라이언트는 아래 상태값을 기반으로 보간, 회전, 아이콘 분기,
                // 사망/충돌 UI, 미니맵, 체력바를 렌더한다.
                id: p.id,
                displayName: displayName,
                skinName: p.skinName || "default",
                pumpkinBaseSkinName: String(p.pumpkinBaseSkinName || ""),
                pumpkinNtrTriggerCount: Number(p.pumpkinNtrTriggerCount || 0),
                x: p.x,
                y: p.y,
                velocityX: (p.lastMoveX || 0) * TICK_RATE,
                velocityY: (p.lastMoveY || 0) * TICK_RATE,
                facingAngle: typeof p.facingAngle === "number" ? p.facingAngle : 0,
                isDummy: Boolean(p.isDummy),
                isNpc: Boolean(p.isNpc),
                isPumpkinNpc: Boolean(p.isPumpkinNpc),
                isHouse: Boolean(p.isHouse),
                houseStage: p.isHouse ? Number(p.houseStage || 0) : 0,
                houseHealth: p.isHouse ? Number(p.houseHealth || 0) : null,
                houseMaxHealth: p.isHouse ? Number(p.houseMaxHealth || 0) : null,
                houseImageKey: p.isHouse ? String(p.houseImageKey || "") : "",
                npcPhase: p.isNpc ? Number(p.npcPhase || 1) : 1,
                npcPhaseTwoRatio: p.isNpc ? Number(GAMEPLAY_SETTINGS.npc_phase_two_health_ratio || 0.6) : null,
                npcPhaseThreeRatio: p.isNpc ? Number(GAMEPLAY_SETTINGS.npc_phase_three_health_ratio || 0.2) : null,
                npcState: p.isNpc ? (p.npcState || "idle") : "",
                collisionActive: now < (p.collisionVisualUntil || 0),
                collisionImpactActive: now < (p.collisionImpactUntil || 0),
                collisionVisualType: p.collisionVisualType || "win",
                collisionImpactX: p.collisionImpactX || 0,
                collisionImpactY: p.collisionImpactY || 0,
                boostState: p.boostState || "idle",
                currentSpeed: p.currentSpeed,
                collisionRecoveryActive: now < (p.collisionRecoveryUntil || 0),
                collisionRecoveryRemainingMs: collisionRecoveryRemainingMs,
                collisionRecoveryDurationMs: collisionRecoveryDurationMs,
                pumpkinFadeOutActive: pumpkinFadeOutActive,
                pumpkinFadeOutProgress: Math.max(0, Math.min(1, pumpkinFadeOutProgress)),
                playerWinVisualActive: playerWinVisualActive,
                stopVisualActive: stopVisualActive,
                boostLockedActive: now < (p.boostDisabledUntil || 0),
                boostLockRemainingMs: boostLockRemainingMs,
                boostLockDurationMs: boostLockDurationMs,
                deathActive: deathActive,
                deathFadeProgress: Math.max(0, Math.min(1, deathFadeProgress)),
                deathRespawnReady: deathRespawnReady,
                livesRemaining: livesRemaining,
                npcMaxHealth: typeof p.npcMaxHealth === "number" ? p.npcMaxHealth : null,
                npcHealth: typeof p.npcHealth === "number" ? p.npcHealth : null,
                npcDefeatDamageRatio: p.isNpc ? Number(p.npcDefeatDamageRatio || 0) : 0,
                npcWinVisualActive: p.isNpc ? now < Number(p.npcWinVisualUntil || 0) : false,
                npcDeathAnimating: npcDeathAnimating,
                npcChargeWindupProgress: Math.max(0, Math.min(1, npcChargeWindupProgress)),
                defeatReceivedCount: p.defeatReceivedCount || 0,
                defeatDealtCount: p.defeatDealtCount || 0,
                roundResetAnnouncementActive: roundResetAnnouncementActive,
                doubleState: doubleState,
                encounterStage: encounterStage,
                encounterAnnouncementKey: encounterAnnouncementKey,
                encounterCountdownSeconds: encounterCountdownSeconds,
                encounterFinaleActive: encounterFinaleActive,
                encounterFinaleUntil: encounterFinaleUntil
            }
        })

        // 4. delta 계산: 이전 틱 대비 변경된 필드만 포함해 전송 크기를 줄인다.
        const currentIds = new Set(state.map((p) => p.id))
        const removed = []
        for (const id of prevStateByPlayer.keys()) {
            if (!currentIds.has(id)) removed.push(id)
        }
        const delta = state.map((player) => {
            const prev = prevStateByPlayer.get(player.id)
            if (!prev) {
                // 새로 등장한 플레이어는 전체 state 전송 + __new 플래그
                return Object.assign({ __new: true }, player)
            }
            // 변경된 필드만 포함. id는 항상 포함한다.
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

        // prevState를 현재 state로 교체한다.
        for (const id of removed) prevStateByPlayer.delete(id)
        for (const player of state) prevStateByPlayer.set(player.id, player)

        // 5. msgpack binary로 한 번만 직렬화한다. { d: delta, r: removed }
        const serialized = encode({ d: delta, r: removed })
        // needsFullState 클라이언트용: 모든 플레이어를 __new로 포함한 full state.
        // 실제로 필요한 클라이언트가 있을 때만 lazy하게 인코딩한다.
        let fullStateSerialized = null

        for (const client of activeClients) {
            // 6. 오래 입력이 없는 연결은 종료
            if (client.player && now - (client.lastActiveInputAt || 0) >= IDLE_TIMEOUT_MS) {
                if (client.readyState === 1) {
                    client.send(encode({ type: "idle_timeout" }))
                    client.close(4002, "idle_timeout")
                }
                continue
            }

            if (!client.player) continue
            if (client.readyState !== 1) continue

            if (client.needsFullState) {
                // 7a. 첫 접속/재접속 클라이언트: 모든 플레이어의 전체 state 전송
                if (!fullStateSerialized) {
                    fullStateSerialized = encode({
                        d: state.map((p) => Object.assign({ __new: true }, p)),
                        r: []
                    })
                }
                client.send(fullStateSerialized)
                client.needsFullState = false
            } else {
                // 7b. 기존 클라이언트: delta만 전송
                client.send(serialized)
            }
        }
    }, intervalMs)
}

module.exports = startGameLoop
