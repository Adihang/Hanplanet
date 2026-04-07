/**
 * worldEncounter.js — 하우스 인카운터 이벤트 믹스인
 *
 * 인카운터는 네르 NPC 사망 시 스테이지 순서대로 진행되는 보스 이벤트다.
 * 스테이지 0: 기본 상태 (네르만 존재)
 * 스테이지 1·3·5: 하우스를 보호하는 카운트다운 페이즈 (실패 시 전원 사망)
 * 스테이지 2·4: 추가 네르 스폰 페이즈
 * 스테이지 6: 파이널 보상 페이즈
 * 모든 스테이지를 완료하면 game_clears 통계가 올라가고 인카운터가 초기화된다.
 */
const { WORLD_SIZE } = require("../config/config")
const {
    NPC_ID,
    HOUSE_STAGE_ONE_ID,
    HOUSE_STAGE_TWO_ID,
    HOUSE_STAGE_THREE_ID,
    HOUSE_STAGE_ONE_HEALTH,
    HOUSE_STAGE_TWO_HEALTH,
    HOUSE_STAGE_THREE_HEALTH,
    ENCOUNTER_STAGE_ONE_COUNTDOWN_MS,
    ENCOUNTER_STAGE_TWO_COUNTDOWN_MS,
    ENCOUNTER_STAGE_THREE_COUNTDOWN_MS,
    ENCOUNTER_FINALE_DURATION_MS,
    ENCOUNTER_STAGE_ONE_LIVES,
    ENCOUNTER_STAGE_TWO_LIVES,
    ENCOUNTER_ANNOUNCEMENT_STAGE_ONE,
    ENCOUNTER_ANNOUNCEMENT_STAGE_TWO,
    ENCOUNTER_ANNOUNCEMENT_STAGE_THREE,
    ENCOUNTER_ANNOUNCEMENT_FINALE,
} = require("../config/constants")
const { isPersistentHumanPlayer } = require("./worldHelpers")
const { PLAYER_STARTING_LIVES } = require("./worldSettings")
const Player = require("./player")

module.exports = {
    /**
     * 지정된 스테이지의 하우스 NPC를 스폰한다.
     * 이미 같은 ID의 하우스가 존재하면 기존 인스턴스를 반환한다.
     * @param {number} stage - 하우스 스테이지 번호 (1, 2, 3)
     * @returns {object} 스폰되거나 기존에 존재하는 하우스 플레이어 객체
     */
    spawnHouse(stage) {
        const houseId = stage === 1 ? HOUSE_STAGE_ONE_ID : (stage === 2 ? HOUSE_STAGE_TWO_ID : HOUSE_STAGE_THREE_ID)
        const existing = this.players.get(houseId)
        if (existing) {
            return existing
        }
        const player = new Player(houseId)
        player.isHouse = true
        player.houseStage = stage
        player.houseImageKey = `house${stage}`
        player.houseMaxHealth = stage === 1 ? HOUSE_STAGE_ONE_HEALTH : (stage === 2 ? HOUSE_STAGE_TWO_HEALTH : HOUSE_STAGE_THREE_HEALTH)
        player.houseHealth = player.houseMaxHealth
        player.x = WORLD_SIZE / 2
        player.y = WORLD_SIZE / 2
        this.players.set(houseId, player)
        this.grid.add(player)
        return player
    },

    /**
     * 월드에 존재하는 모든 하우스 플레이어를 제거한다.
     */
    removeHousePlayers() {
        for (const player of Array.from(this.players.values())) {
            if (!player.isHouse) {
                continue
            }
            this.grid.remove(player)
            this.players.delete(player.id)
        }
    },

    /**
     * 현재 월드에 존재하는 모든 하우스 플레이어 배열을 반환한다.
     * @returns {object[]} 하우스 플레이어 객체 배열
     */
    getHousePlayers() {
        return Array.from(this.players.values()).filter((player) => player.isHouse)
    },

    /**
     * 인카운터 카운트다운의 남은 시간을 초 단위로 반환한다.
     * 카운트다운이 없거나 만료되었으면 0을 반환한다.
     * @param {number} now - 현재 타임스탬프 (ms)
     * @returns {number} 남은 카운트다운 시간 (초, 올림)
     */
    getEncounterCountdownSecondsRemaining(now = Date.now()) {
        if (!this.encounterCountdownUntil || now >= this.encounterCountdownUntil) {
            return 0
        }
        return Math.max(0, Math.ceil((this.encounterCountdownUntil - now) / 1000))
    },

    /**
     * 인카운터 공지 및 카운트다운 상태를 초기화한다.
     */
    clearEncounterAnnouncement() {
        // 공지와 실제 카운트다운을 같이 비워야
        // 클라이언트가 남은 타이머를 계속 표시하지 않는다.
        this.encounterAnnouncementKey = ""
        this.encounterAnnouncementUntil = 0
        this.encounterCountdownUntil = 0
    },

    /**
     * 인카운터 공지를 시작한다.
     * 공지 키와 종료 시각, 카운트다운 종료 시각을 설정한다.
     * @param {number} now - 현재 타임스탬프 (ms)
     * @param {string} key - 공지 메시지 키
     * @param {number} durationMs - 공지 지속 시간 (ms)
     */
    startEncounterAnnouncement(now, key, durationMs) {
        // announcement 와 countdown 은 같은 끝 시각을 공유한다.
        this.encounterAnnouncementKey = key
        this.encounterAnnouncementUntil = now + durationMs
        this.encounterCountdownUntil = now + durationMs
    },

    /**
     * 인카운터 실패 처리로 현재 접속 중인 모든 인간 플레이어를 사망시킨다.
     * sharedLivesRemaining을 0으로 설정하고 전원 사망 후 리셋 플래그를 세운다.
     * @param {number} now - 현재 타임스탬프 (ms)
     */
    killAllHumansForEncounterFailure(now) {
        this.sharedLivesRemaining = 0
        this.encounterResetOnAllDead = true
        for (const player of this.players.values()) {
            if (!isPersistentHumanPlayer(player) || this.isPlayerDead(player)) {
                continue
            }
            this.triggerPlayerDeath(player, now, null)
        }
    },

    /**
     * 인카운터 스테이지 1(첫 번째 하우스 카운트다운 페이즈)을 시작한다.
     * 기존 네르 NPC와 하우스를 제거하고 스테이지 1 하우스를 스폰한다.
     * @param {number} now - 현재 타임스탬프 (ms)
     */
    beginStageOneHouseEncounter(now) {
        this.encounterStage = 1
        this.pendingRoundResetAt = 0
        this.encounterFinaleUntil = 0
        this.encounterFinaleRewarded = false
        this.encounterResetOnAllDead = false
        this.removeNerPlayers()
        this.removeHousePlayers()
        this.startEncounterAnnouncement(now, ENCOUNTER_ANNOUNCEMENT_STAGE_ONE, ENCOUNTER_STAGE_ONE_COUNTDOWN_MS)
        this.spawnHouse(1)
    },

    /**
     * 인카운터 스테이지 2(첫 번째 추가 네르 스폰 페이즈)를 시작한다.
     * 하우스를 제거하고 공유 목숨을 ENCOUNTER_STAGE_ONE_LIVES로 설정한 뒤
     * eliminated 펌킨 플레이어를 복구하고 네르 NPC를 스폰한다.
     * @param {number} now - 현재 타임스탬프 (ms)
     */
    beginStageTwoNer(now) {
        this.encounterStage = 2
        this.pendingRoundResetAt = 0
        this.encounterFinaleUntil = 0
        this.encounterFinaleRewarded = false
        this.encounterResetOnAllDead = false
        this.removeHousePlayers()
        this.clearEncounterAnnouncement()
        this.sharedLivesRemaining = ENCOUNTER_STAGE_ONE_LIVES
        for (const player of this.players.values()) {
            if (isPersistentHumanPlayer(player)) {
                player.livesRemaining = this.sharedLivesRemaining
            }
        }
        this.restoreEliminatedPumpkinPlayers(now)
        this.spawnNerNpcPlayer(NPC_ID, {
            x: WORLD_SIZE / 2,
            y: WORLD_SIZE / 2,
            speedMultiplier: 1,
            encounterVariant: "doorboss",
        })
    },

    /**
     * 인카운터 스테이지 3(두 번째 하우스 카운트다운 페이즈)을 시작한다.
     * 기존 네르 NPC와 하우스를 제거하고 스테이지 2 하우스를 스폰한다.
     * @param {number} now - 현재 타임스탬프 (ms)
     */
    beginStageTwoHouseEncounter(now) {
        this.encounterStage = 3
        this.pendingRoundResetAt = 0
        this.encounterFinaleUntil = 0
        this.encounterFinaleRewarded = false
        this.encounterResetOnAllDead = false
        this.removeNerPlayers()
        this.removeHousePlayers()
        this.startEncounterAnnouncement(now, ENCOUNTER_ANNOUNCEMENT_STAGE_TWO, ENCOUNTER_STAGE_TWO_COUNTDOWN_MS)
        this.spawnHouse(2)
    },

    /**
     * 인카운터 스테이지 4(두 번째 추가 네르 스폰 페이즈)를 시작한다.
     * 하우스를 제거하고 공유 목숨을 ENCOUNTER_STAGE_TWO_LIVES로 설정한 뒤
     * 인간 플레이어 수 + 1 개의 네르 NPC를 일렬로 스폰한다.
     * @param {number} now - 현재 타임스탬프 (ms)
     */
    beginStageThreeNer(now) {
        this.encounterStage = 4
        this.pendingRoundResetAt = 0
        this.encounterFinaleUntil = 0
        this.encounterFinaleRewarded = false
        this.encounterResetOnAllDead = false
        this.removeHousePlayers()
        this.clearEncounterAnnouncement()
        this.sharedLivesRemaining = ENCOUNTER_STAGE_TWO_LIVES
        for (const player of this.players.values()) {
            if (isPersistentHumanPlayer(player)) {
                player.livesRemaining = this.sharedLivesRemaining
            }
        }
        this.restoreEliminatedPumpkinPlayers(now)
        const humanCount = Math.max(1, this.getHumanPlayerCount())
        const spawnCount = humanCount + 1
        const spacing = 140
        const startX = (WORLD_SIZE / 2) - ((spawnCount - 1) * spacing / 2)
        for (let index = 0; index < spawnCount; index += 1) {
            this.spawnNerNpcPlayer(`${NPC_ID}-${index + 1}`, {
                x: startX + (index * spacing),
                y: WORLD_SIZE / 2,
                speedMultiplier: 1,
            })
        }
    },

    /**
     * 인카운터 스테이지 5(세 번째 하우스 카운트다운 페이즈)를 시작한다.
     * 기존 네르 NPC와 하우스를 제거하고 스테이지 3 하우스를 스폰한다.
     * @param {number} now - 현재 타임스탬프 (ms)
     */
    beginStageThreeHouseEncounter(now) {
        this.encounterStage = 5
        this.pendingRoundResetAt = 0
        this.encounterFinaleUntil = 0
        this.encounterFinaleRewarded = false
        this.encounterResetOnAllDead = false
        this.removeNerPlayers()
        this.removeHousePlayers()
        this.startEncounterAnnouncement(now, ENCOUNTER_ANNOUNCEMENT_STAGE_THREE, ENCOUNTER_STAGE_THREE_COUNTDOWN_MS)
        this.spawnHouse(3)
    },

    /**
     * 인카운터 스테이지 6(파이널 보상 페이즈)를 시작한다.
     * 모든 네르 NPC와 하우스를 제거하고 파이널 공지를 설정한다.
     * @param {number} now - 현재 타임스탬프 (ms)
     */
    beginEncounterFinale(now) {
        this.encounterStage = 6
        this.pendingRoundResetAt = 0
        this.encounterResetOnAllDead = false
        this.removeNerPlayers()
        this.removeHousePlayers()
        this.encounterAnnouncementKey = ENCOUNTER_ANNOUNCEMENT_FINALE
        this.encounterAnnouncementUntil = now + ENCOUNTER_FINALE_DURATION_MS
        this.encounterCountdownUntil = 0
        this.encounterFinaleUntil = now + ENCOUNTER_FINALE_DURATION_MS
        this.encounterFinaleRewarded = false
    },

    /**
     * 인카운터를 스테이지 0(초기 상태)으로 완전히 초기화한다.
     * 모든 NPC를 제거하고, 플레이어 목숨을 초기값으로 복원하며,
     * 네르 NPC와 중립 펌킨 NPC를 새로 스폰한다.
     * @param {number} now - 현재 타임스탬프 (ms)
     */
    resetEncounterToInitial(now, options = {}) {
        const respawnHumans = options.respawnHumans !== false
        this.encounterStage = 0
        this.pendingRoundResetAt = 0
        this.encounterFinaleUntil = 0
        this.encounterFinaleRewarded = false
        this.encounterResetOnAllDead = false
        this.clearEncounterAnnouncement()
        this.removeHousePlayers()
        this.removePumpkinPlayers()
        this.lastTrackedNerCombatPhase = 1
        this.restoreInitialPumpkinPlayersForFullReset(now)
        for (const player of Array.from(this.players.values())) {
            if (player.isNpc) {
                this.grid.remove(player)
                this.players.delete(player.id)
            }
        }
        this.sharedLivesRemaining = PLAYER_STARTING_LIVES
        for (const savedProgress of this.playerProgress.values()) {
            if (!savedProgress) {
                continue
            }
            savedProgress.defeatReceivedCount = 0
            savedProgress.defeatDealtCount = 0
            savedProgress.collisionVisualUntil = 0
            savedProgress.collisionImpactUntil = 0
            savedProgress.npcDefeatDamageRatio = 0
            savedProgress.collisionImpactX = 0
            savedProgress.collisionImpactY = 0
            savedProgress.collisionRecoveryStartedAt = 0
            savedProgress.collisionRecoveryUntil = 0
            savedProgress.boostDisabledStartedAt = 0
            savedProgress.boostDisabledUntil = 0
            if (respawnHumans) {
                savedProgress.deathStartedAt = 0
                savedProgress.deathUntil = 0
            }
            savedProgress.respawnRequested = false
        }
        for (const player of this.players.values()) {
            if (player.isDummy) {
                continue
            }
            if (isPersistentHumanPlayer(player)) {
                player.defeatReceivedCount = 0
                player.defeatDealtCount = 0
                player.livesRemaining = this.sharedLivesRemaining
                player.respawnRequested = false
                player.input.respawn = false
                if (respawnHumans) {
                    this.respawnPlayer(player, now, { consumeSharedLife: false })
                } else {
                    player.freeRespawnAfterReset = true
                    player.boostState = "idle"
                    player.currentSpeed = 0
                    player.boostDirectionX = 0
                    player.boostDirectionY = 0
                    player.lastMoveX = 0
                    player.lastMoveY = 0
                    player.input = {
                        up: false,
                        down: false,
                        left: false,
                        right: false,
                        boost: false,
                        respawn: false,
                        moveX: 0,
                        moveY: 0,
                    }
                    this.updateStoredPlayerProgress(player)
                }
            }
        }
        this.addNerNpcPlayer()
        this.spawnNeutralPumpkinNpc()
    },
}
