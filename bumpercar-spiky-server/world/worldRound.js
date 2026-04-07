/**
 * worldRound.js
 * 라운드 및 목숨(lives) 관리 모듈.
 * 플레이어 수 기반 NPC 체력 조정, 라운드 종료 판정, 라운드 리셋,
 * 유휴(idle) 타임아웃 후 진행 상태 초기화 등의 기능을 담당한다.
 */

const { WORLD_SIZE } = require("../config/config")
const {
    PLAYER_DEATH_DURATION_MS,
    INPUT_IDLE_RESET_MS,
} = require("../config/constants")
const { getNpcBaseSpeed, getNpcPhase, isPersistentHumanPlayer } = require("./worldHelpers")
const { NPC_MAX_HEALTH, PLAYER_STARTING_LIVES } = require("./worldSettings")

module.exports = {
    /**
     * 현재 접속 중인 인간 플레이어(persistent human player)의 수를 반환한다.
     * NPC 및 더미는 카운트에서 제외된다.
     * @returns {number}
     */
    getHumanPlayerCount() {
        return Array.from(this.players.values()).filter((player) => isPersistentHumanPlayer(player)).length
    },

    /**
     * 현재 인간 플레이어 수에 따라 조정된 NPC 최대 체력 값을 반환한다.
     * 현재는 항상 NPC_MAX_HEALTH 고정값을 반환한다.
     * @returns {number}
     */
    getScaledNpcMaxHealth() {
        return NPC_MAX_HEALTH
    },

    /**
     * 현재 인간 플레이어 수에 맞게 모든 NPC의 최대 체력을 재조정한다.
     * 기존 체력 비율을 유지한 채 새 최대 체력 기준으로 현재 체력을 비례 변환하고
     * NPC 페이즈도 갱신한다.
     */
    rebalanceNpcHealthForHumanCount() {
        for (const npc of this.getNerPlayers()) {
            const previousMaxHealth = Math.max(1, Number(npc.npcMaxHealth || NPC_MAX_HEALTH))
            const nextMaxHealth = this.getScaledNpcMaxHealth()
            const currentRatio = Math.max(0, Math.min(1, Number(npc.npcHealth || 0) / previousMaxHealth))
            npc.npcMaxHealth = nextMaxHealth
            npc.npcHealth = Math.max(0, Math.min(nextMaxHealth, Math.round(nextMaxHealth * currentRatio)))
            npc.npcPhase = getNpcPhase(npc)
        }
    },

    /**
     * 모든 NPC의 체력을 지정한 값(nextHealth)으로 직접 설정한다.
     * NPC가 없으면 null을 반환하고, 있으면 갱신된 NPC 목록과 개수를 반환한다.
     * @param {number} nextHealth
     * @returns {{ count: number, ners: Array<{ id: string, npcHealth: number, npcMaxHealth: number, npcPhase: number }> }|null}
     */
    setNpcHealth(nextHealth) {
        const ners = this.getNerPlayers()
        if (!ners.length) {
            return null
        }

        const updatedNers = ners.map((npc) => {
            const safeHealth = Math.max(0, Math.min(Number(npc.npcMaxHealth || NPC_MAX_HEALTH), Number(nextHealth || 0)))
            npc.npcHealth = safeHealth
            npc.npcPhase = getNpcPhase(npc)
            return {
                id: npc.id,
                npcHealth: npc.npcHealth,
                npcMaxHealth: npc.npcMaxHealth,
                npcPhase: npc.npcPhase || 1,
            }
        })
        return {
            count: updatedNers.length,
            ners: updatedNers,
        }
    },

    /**
     * 모든 인간 플레이어가 탈락(dead 또는 미접속) 상태인지 여부를 반환한다.
     * 공용 목숨이 0이고, 접속 중인 인간 플레이어가 전원 사망 상태일 때 true를 반환한다.
     * @returns {boolean}
     */
    areAllHumanPlayersOut() {
        if (this.sharedLivesRemaining > 0) {
            return false
        }

        const allPlayers = Array.from(this.players.values())
        const humanPlayers = allPlayers.filter((player) => isPersistentHumanPlayer(player))

        if (!humanPlayers.length) {
            return false
        }

        return humanPlayers.every((player) => this.isPlayerDead(player))
    },

    /**
     * 지정한 NPC 플레이어를 새 라운드 시작 상태(idle)로 완전히 초기화한다.
     * 위치, 속도, 충돌 상태, 체력, AI 상태 변수 등을 모두 기본값으로 되돌린다.
     * NPC가 아닌 플레이어는 아무 처리도 하지 않는다.
     * @param {object} player
     * @param {number} now - 현재 타임스탬프(ms)
     */
    resetNpcForNewRound(player, now) {
        if (!player || !player.isNpc) {
            return
        }

        // 라운드 리셋 시 네르는 기본 위치/기본 상태로 완전히 되돌린다.
        player.x = WORLD_SIZE / 2 + 180
        player.y = WORLD_SIZE / 2
        player.currentSpeed = getNpcBaseSpeed(player)
        player.boostState = "idle"
        player.boostDirectionX = 0
        player.boostDirectionY = 0
        player.input = {
            up: false,
            down: false,
            left: false,
            right: false,
            boost: false,
            respawn: false,
            moveX: 0,
            moveY: 0
        }
        player.lastMoveX = 0
        player.lastMoveY = 0
        player.collisionVisualUntil = 0
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
        player.npcMaxHealth = this.getScaledNpcMaxHealth()
        player.npcHealth = player.npcMaxHealth
        player.npcPhase = 1
        player.npcRespawnAt = 0
        player.npcState = "idle"
        player.npcTargetId = ""
        player.npcChargeDirectionX = 0
        player.npcChargeDirectionY = 0
        player.npcChargeDistanceRemaining = 0
        player.npcChargeDistanceTotal = 0
        player.npcChargeRedirected = false
        player.npcCounterWindowTargetId = ""
        player.npcCounterWindowPhase = 0
        player.npcCounterWindowUntil = 0
        player.npcCounterWindowConsumed = false
        player.npcChargeWindupStartedAt = 0
        player.npcChargeWindupUntil = 0
        player.npcRestUntil = 0
        player.npcQueuedExtraCharges = 0
        this.grid.move(player)
    },

    /**
     * 공용 목숨을 초기값으로 리셋하고 모든 플레이어를 새 라운드 상태로 복원한다.
     * NPC는 resetNpcForNewRound로 초기화하고, 인간 플레이어는 목숨과 리스폰 요청을 초기화한 뒤
     * 진행 상태를 저장한다. 라운드 종료 공지 타이머 및 호박 NPC도 함께 처리한다.
     * @param {number} now - 현재 타임스탬프(ms)
     */
    resetRoundLives(now) {
        console.log(`[resetRoundLives] 호출됨 now=${now}`)
        this.sharedLivesRemaining = PLAYER_STARTING_LIVES
        this.roundResetAnnouncementUntil = now + PLAYER_DEATH_DURATION_MS
        this.pendingRoundResetAt = 0
        this.encounterResetOnAllDead = false
        this.removePumpkinPlayers()
        this.lastTrackedNerCombatPhase = 1
        this.restoreInitialPumpkinPlayersForFullReset(now)

        for (const player of this.players.values()) {
            if (player.isNpc) {
                this.resetNpcForNewRound(player, now)
                continue
            }
            if (player.isDummy) {
                continue
            }

            player.livesRemaining = PLAYER_STARTING_LIVES
            player.respawnRequested = false
            this.updateStoredPlayerProgress(player)
        }
        this.spawnNeutralPumpkinNpc()
    },

    /**
     * 장시간 입력이 없었던 후 모든 인간 플레이어의 진행 상태를 초기화한다.
     * 공용 목숨, playerProgress 맵, 전적 통계를 모두 리셋하고
     * 인간 플레이어를 리스폰시키며 NPC를 새 라운드 상태로 되돌린다.
     * @param {number} now - 현재 타임스탬프(ms)
     */
    resetHumanProgressAfterIdle(now) {
        // 장시간 아무 입력이 없으면 "새 판 시작"으로 보고
        // 공용 목숨, 통계, 저장 진행도를 모두 초기화한다.
        this.sharedLivesRemaining = PLAYER_STARTING_LIVES
        this.playerProgress.clear()
        this.removePumpkinPlayers()
        this.lastTrackedNerCombatPhase = 1

        for (const player of this.players.values()) {
            if (player.isNpc) {
                this.resetNpcForNewRound(player, now)
                continue
            }
            if (player.isDummy) {
                continue
            }

            player.defeatReceivedCount = 0
            player.defeatDealtCount = 0
            player.livesRemaining = PLAYER_STARTING_LIVES
            player.respawnRequested = false
            this.respawnPlayer(player, now)
        }
        this.spawnNeutralPumpkinNpc()
    },

    /**
     * 마지막 인간 입력 시각으로부터 INPUT_IDLE_RESET_MS 이상 경과했으면
     * resetHumanProgressAfterIdle을 호출하여 진행 상태를 초기화한다.
     * 아직 타임아웃이 되지 않았다면 아무 동작도 하지 않는다.
     * @param {number} now - 현재 타임스탬프(ms)
     */
    maybeResetAfterInputIdle(now) {
        if (now - (this.lastHumanInputAt || 0) < INPUT_IDLE_RESET_MS) {
            return
        }

        this.resetHumanProgressAfterIdle(now)
        this.lastHumanInputAt = now
    },
}
