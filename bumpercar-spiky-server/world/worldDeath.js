/**
 * worldDeath.js — 플레이어 사망·리스폰 처리 믹스인
 *
 * 인간 유저(triggerPlayerDeath), 더미(triggerDummyDeath), NPC(triggerNpcDeath)
 * 각각의 사망 시작 로직과 공통 리스폰(respawnPlayer) 로직을 담는다.
 * isPlayerDead / isPlayerDeathAnimating 은 worldCollision.js 에 정의돼 있으므로
 * 여기서는 중복 선언하지 않는다.
 */

const {
    PLAYER_DEATH_DURATION_MS,
    NPC_DEATH_ANIMATION_DURATION_MS,
    DUMMY_RESPAWN_DELAY_MS,
    DOUBLE_UNIT_COUNT,
} = require("../config/constants")
const {
    isPersistentHumanPlayer,
    getBaseSpeedForPlayer,
} = require("./worldHelpers")
const { createDoubleUnitState } = require("./worldSettings")
const { postStatsUpdate } = require("../services/accountStats")

module.exports = {
    /**
     * 인간 유저의 사망을 시작한다.
     * 공용 목숨을 1 깎고, 입력·속도를 전부 초기화한 뒤 deathUntil 을 설정한다.
     * defeatedByPlayer 가 있으면 승리 비주얼을 켜고 통계를 업데이트한다.
     * 전원 탈락이면 pendingRoundResetAt 을 예약한다.
     * @param {object} player - 사망할 인간 플레이어
     * @param {number} now - 현재 타임스탬프(ms)
     * @param {object|null} defeatedByPlayer - 사망을 유발한 플레이어 (없으면 null)
     */
    triggerPlayerDeath(player, now, defeatedByPlayer = null) {
        if (!player || player.isNpc || player.isDummy || this.isPlayerDead(player)) {
            return
        }

        // 유저 사망은 입력과 이동을 모두 멈춘다.
        // 공용 목숨은 death 시작 시점이 아니라 respawn 시점 기준으로 차감/복원 흐름을 맞춘다.
        player.livesRemaining = this.sharedLivesRemaining
        player.deathStartedAt = now
        player.deathUntil = now + PLAYER_DEATH_DURATION_MS
        player.boostState = "idle"
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
        player.freeRespawnAfterReset = false
        if (defeatedByPlayer && defeatedByPlayer.isNpc) {
            defeatedByPlayer.npcWinVisualUntil = now + 3000
        }
        if (isPersistentHumanPlayer(defeatedByPlayer) && !defeatedByPlayer.isNpc && !defeatedByPlayer.isDummy) {
            defeatedByPlayer.playerWinVisualUntil = now + 3000
            postStatsUpdate(defeatedByPlayer.id, { player_kills: 1 })
        }
        this.updateStoredPlayerProgress(player)
        postStatsUpdate(player.id, { deaths: 1 })

        // 공용 목숨이 모두 소진되고 전원이 쓰러졌다면
        // 마지막 사망 연출이 끝나는 시점으로 라운드 리셋을 예약한다.
        if (this.areAllHumanPlayersOut()) {
            this.pendingRoundResetAt = Math.max(Number(this.pendingRoundResetAt || 0), player.deathUntil)
        }
    },

    /**
     * 더미 플레이어의 사망을 시작한다.
     * 공용 목숨과 무관하며, 사망 연출 후 npcRespawnAt 까지 대기한 뒤 자동 리스폰한다.
     * @param {object} player - 사망할 더미 플레이어
     * @param {number} now - 현재 타임스탬프(ms)
     * @param {object|null} defeatedByPlayer - 사망을 유발한 플레이어 (없으면 null)
     */
    triggerDummyDeath(player, now, defeatedByPlayer = null) {
        if (!player || !player.isDummy || this.isPlayerDead(player)) {
            return
        }

        // 더미는 공용 목숨과 무관하게 사망 연출 후 3분 뒤 자동 리스폰한다.
        player.deathStartedAt = now
        player.deathUntil = now + PLAYER_DEATH_DURATION_MS
        player.npcRespawnAt = player.deathUntil + DUMMY_RESPAWN_DELAY_MS
        player.boostState = "idle"
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
        player.freeRespawnAfterReset = false
        player.dummyRetaliationTargetId = ""
        player.dummyState = "idle"
        player.dummyPhase = 1
        player.dummyChargeDistanceRemaining = 0
        player.dummyChargeDistanceTotal = 0
        player.dummyChargeWindupStartedAt = 0
        player.dummyChargeWindupUntil = 0
        player.dummyRestUntil = 0
        player.dummyQueuedExtraCharges = 0
        if (isPersistentHumanPlayer(defeatedByPlayer)) {
            defeatedByPlayer.playerWinVisualUntil = now + 3000
            postStatsUpdate(defeatedByPlayer.id, { dummy_kills: 1 })
        }
    },

    /**
     * 네르 NPC의 사망을 시작한다.
     * 즉시 "dead" 상태로 전환하고, 애니메이션이 끝나면 월드에서 제거된다.
     * defeatedByPlayer 통계 업데이트와 인카운터 다음 스테이지 진행을 처리한다.
     * @param {object} player - 사망할 NPC 플레이어
     * @param {number} now - 현재 타임스탬프(ms)
     * @param {object|null} defeatedByPlayer - 사망을 유발한 플레이어 (없으면 null)
     */
    triggerNpcDeath(player, now, defeatedByPlayer = null) {
        if (!player || !player.isNpc || this.isPlayerDead(player)) {
            return
        }

        // 네르는 체력이 0 이하가 되면 즉시 dead 상태로 들어가고,
        // 애니메이션이 끝나면 월드에서 제거된다.
        player.deathStartedAt = now
        player.deathUntil = now + NPC_DEATH_ANIMATION_DURATION_MS
        player.npcRespawnAt = 0
        player.npcHealth = 0
        player.npcState = "dead"
        player.npcTargetId = ""
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
        player.boostState = "idle"
        player.currentSpeed = 0
        player.boostDirectionX = 0
        player.boostDirectionY = 0
        player.input.boost = false
        player.collisionVisualType = "defeat"
        player.npcDefeatDamageRatio = 1
        player.collisionVisualUntil = player.deathUntil
        player.collisionImpactUntil = 0
        player.npcWinVisualUntil = 0
        player.playerWinVisualUntil = 0
        player.boostDisabledStartedAt = now
        player.boostDisabledUntil = player.deathUntil
        player.lastMoveX = 0
        player.lastMoveY = 0
        if (isPersistentHumanPlayer(defeatedByPlayer)) {
            defeatedByPlayer.playerWinVisualUntil = now + 3000
            postStatsUpdate(defeatedByPlayer.id, { ner_kills: 1 })
        }
        const connectedHumans = Array.from(this.players.values()).filter((candidate) => isPersistentHumanPlayer(candidate))
        const connectedHumanCount = connectedHumans.length
        if (connectedHumanCount > 0) {
            connectedHumans.forEach((connectedPlayer) => {
                postStatsUpdate(connectedPlayer.id, {}, { max_ner_party_size: connectedHumanCount })
            })
        }
        const remainingAliveNers = this.getAliveNerPlayers().filter((candidate) => candidate.id !== player.id)
        if (this.encounterStage === 0) {
            this.beginStageOneHouseEncounter(now)
        } else if (this.encounterStage === 2) {
            this.beginStageTwoHouseEncounter(now)
        } else if (this.encounterStage === 4 && remainingAliveNers.length === 0) {
            this.beginStageThreeHouseEncounter(now)
        }
    },

    /**
     * 플레이어를 리스폰한다.
     * 인간 유저는 공용 목숨이 남아 있어야 하며, 네르와 다른 사분면 가장자리에 스폰한다.
     * 더미는 고유 사분면, NPC는 별도 초기화 처리를 거친다.
     * @param {object} player - 리스폰할 플레이어
     * @param {number} now - 현재 타임스탬프(ms)
     * @param {object} [options]
     * @param {boolean} [options.consumeSharedLife=true] - 인간 유저 리스폰 시 공용 목숨 차감 여부
     * @returns {boolean} 리스폰 성공 여부
     */
    respawnPlayer(player, now, options = {}) {
        if (!player) {
            return false
        }
        const consumeSharedLife = options.consumeSharedLife !== false
        this.syncDoubleSkinState(player, now)

        // 인간 유저는 공용 목숨이 남아 있을 때만 리스폰 가능하다.
        player.livesRemaining = this.sharedLivesRemaining
        if (!player.isNpc && !player.isDummy && Number(this.sharedLivesRemaining || 0) <= 0) {
            player.respawnRequested = false
            player.input.respawn = false
            this.updateStoredPlayerProgress(player)
            return false
        }

        // 인간 유저 리스폰 시 공용 목숨을 1 소모한다.
        if (!player.isNpc && !player.isDummy && consumeSharedLife) {
            this.sharedLivesRemaining = Math.max(0, Number(this.sharedLivesRemaining || 0) - 1)
            player.livesRemaining = this.sharedLivesRemaining
        }

        // 더미는 고유 사분면, 인간 유저는 네르와 다른 사분면 가장자리에서 리스폰한다.
        let spawnPosition
        if (player.isDummy) {
            spawnPosition = this.getRandomQuadrantSpawnPosition(player.dummyQuadrant || 1)
        } else {
            const aliveNerPlayers = this.getNerPlayers().filter((p) => !this.isPlayerDead(p))
            if (aliveNerPlayers.length > 0) {
                const ner = aliveNerPlayers[0]
                const nerQuadrant = this.getQuadrantFromPosition(ner.x, ner.y)
                const availableQuadrants = [1, 2, 3, 4].filter((q) => q !== nerQuadrant)
                const chosenQuadrant = availableQuadrants[Math.floor(Math.random() * availableQuadrants.length)]
                spawnPosition = this.getRandomEdgeSpawnPositionInQuadrant(chosenQuadrant)
            } else {
                spawnPosition = this.getRandomEdgeSpawnPosition()
            }
        }
        player.x = spawnPosition.x
        player.y = spawnPosition.y
        player.currentSpeed = getBaseSpeedForPlayer(player)
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
        player.lastActiveInputAt = now
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
        player.freeRespawnAfterReset = false
        if (player.isDoubleSkin) {
            player.doubleMerged = true
            player.doubleSeparationPhase = "merged"
            player.doubleMergeLockUntil = 0
            player.doubleUnits = [createDoubleUnitState(now), createDoubleUnitState(now)]
        }
        if (player.isNpc) {
            player.npcMaxHealth = this.getScaledNpcMaxHealth()
            player.npcHealth = player.npcMaxHealth
            player.npcRespawnAt = 0
            player.npcState = "idle"
            player.npcTargetId = ""
            player.npcChargeDistanceRemaining = 0
            player.npcChargeDistanceTotal = 0
            player.npcChargeRedirected = false
            player.npcChargeTargetId = ""
            player.npcChargeHitTarget = false
            player.npcChargeIsPhaseAttack = false
            player.npcChargeWindupStartedAt = 0
            player.npcChargeWindupUntil = 0
            player.npcRestUntil = 0
            player.npcQueuedExtraCharges = 0
        } else if (player.isDummy) {
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
        this.grid.move(player)
        this.updateStoredPlayerProgress(player)
        return true
    },
}
