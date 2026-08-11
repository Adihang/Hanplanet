/**
 * world.js — 게임 월드 핵심 클래스
 *
 * World 클래스는 게임 시뮬레이션의 진입점이다.
 * 생성자·addPlayer·removePlayer·handleInput·markHumanInput·update 의
 * 6개 핵심 메서드만 이 파일에 정의하며, 나머지 기능은 Object.assign 믹스인으로 주입한다.
 *
 * 믹스인 파일 목록:
 *   worldSpawn     — 스폰 위치 계산
 *   worldProgress  — 플레이어 진행도 저장/복원
 *   worldRound     — 라운드·목숨 관리
 *   worldPumpkin   — 펌킨 NPC 전반
 *   worldEncounter — 인카운터(하우스 이벤트) 전반
 *   worldNpc       — 네르 NPC AI
 *   worldDummy     — 더미 AI
 *   worldDouble    — 더블 스킨 유닛 처리
 *   worldCollision — 충돌 감지·해소 (isPlayerDead 포함)
 *   worldDeath     — 사망·리스폰 처리
 */

const Player = require("./player")
const SpatialGrid = require("./spatialGrid")
const { CELL_SIZE, WORLD_SIZE } = require("../config/config")
const {
    PUMPKIN_SKIN_NAME,
    DOUBLE_UNIT_COUNT,
    DOUBLE_UNIT_HEALTH,
} = require("../config/constants")
const {
    getBaseSpeedForPlayer,
    getCollisionSlowSpeedForPlayer,
    isPumpkinSkinPlayer,
    getMaxBoostedSpeedForPlayer,
    getBoostAccelerationForPlayer,
    getBoostCooldownForPlayer,
    getNpcBaseSpeed,
    getNpcPhase,
    isPersistentHumanPlayer,
} = require("./worldHelpers")
const {
    PLAYER_STARTING_LIVES,
    TICK_DELTA_SECONDS,
    PUMPKIN_NPC_DEFEAT_DASH_SPEED_PER_SECOND,
    NPC_MAX_BOOSTED_SPEED_PER_SECOND,
    NPC_BOOST_ACCELERATION_PER_SECOND,
    NPC_BOOST_COOLDOWN_PER_SECOND,
    BOOST_ACCELERATION_PER_SECOND,
    BOOST_COOLDOWN_PER_SECOND,
    USER_POST_BOOST_COOLDOWN_MS,
    NPC_REST_DURATION_MS,
    NPC_EXTRA_CHARGE_DISTANCE_MULTIPLIER,
    DUMMY_BASE_SPEED_PER_SECOND,
    createDoubleUnitState,
} = require("./worldSettings")
const { postStatsUpdate } = require("../services/accountStats")

class World {
    /**
     * World 인스턴스를 초기화한다.
     * 플레이어 맵, 공용 목숨, 인카운터 타이머 등 초기 상태를 설정하고
     * 더미·NPC·중립 펌킨 NPC를 스폰한다.
     */
    constructor() {
        // players: 현재 월드에 존재하는 모든 엔티티 (인간·NPC·더미·펌킨·하우스)
        // playerProgress: 재접속 시 이어붙일 인간 유저 진행도
        // encounter* 필드: 하우스 인카운터의 현재 단계와 공지/카운트다운 타이머
        this.players = new Map()
        this.playerProgress = new Map()
        this.sharedLivesRemaining = PLAYER_STARTING_LIVES
        this.lastHumanInputAt = Date.now()
        this.roundResetAnnouncementUntil = 0
        this.pendingRoundResetAt = 0
        this.encounterStage = 0
        this.encounterAnnouncementKey = ""
        this.encounterAnnouncementUntil = 0
        this.encounterCountdownUntil = 0
        this.encounterFinaleUntil = 0
        this.encounterFinaleRewarded = false
        this.encounterResetOnAllDead = false
        this.lastTrackedNerCombatPhase = 1
        this.grid = new SpatialGrid(CELL_SIZE)
        this.addDummyPlayers()
        this.addNerNpcPlayer()
        this.spawnNeutralPumpkinNpc()
    }

    /**
     * 새 인간 플레이어를 월드에 추가하고 반환한다.
     * 같은 connectionKey 로 재접속하면 저장된 진행도를 이어받는다.
     * 스킨 복원, double 유닛 상태 복원, NPC 체력 재조정도 수행한다.
     * @param {string} connectionKey - 소켓 단위 고유 연결 키
     * @param {string} [displayId] - 월드 내 표시 ID (기본값: connectionKey)
     * @param {object} [options] - 추가 옵션 ({ skinName })
     * @returns {Player} 생성된 플레이어 객체
     */
    addPlayer(connectionKey, displayId = connectionKey, options = {}) {
        // addPlayer 는 "접속"과 "재접속 복원"을 동시에 처리한다.
        // 따라서 savedProgress 복원, 스킨 복원, double 상태 복원이 함께 들어 있다.
        const resolvedConnectionKey = String(connectionKey || displayId || "").trim()
        const resolvedDisplayId = String(displayId || resolvedConnectionKey || "").trim()
        const existingPlayer = this.players.get(resolvedDisplayId)
        if (existingPlayer) {
            this.grid.remove(existingPlayer)
            this.players.delete(resolvedDisplayId)
        }

        const player = new Player(resolvedDisplayId)
        player.connectionKey = resolvedConnectionKey || resolvedDisplayId
        const requestedSkinName = String(options.skinName || "").trim() || ""
        player.skinName = requestedSkinName || "default"
        player.initialSkinName = player.skinName
        player.pumpkinEliminated = false
        if (isPumpkinSkinPlayer(player)) {
            player.pumpkinOwnerConnectionKey = player.connectionKey
            player.pumpkinOriginalOwnerConnectionKey = player.connectionKey
        }
        player.baseSpeed = getBaseSpeedForPlayer(player)
        player.currentSpeed = getBaseSpeedForPlayer(player)
        player.collisionSlowSpeed = getCollisionSlowSpeedForPlayer(player)
        this.syncDoubleSkinState(player)

        // 같은 connectionKey 로 재접속하면 이전 통계를 이어받는다.
        const savedProgress = this.getStoredPlayerProgress(player.connectionKey)
        if (savedProgress) {
            const savedSkinName = String(savedProgress.skinName || player.skinName || "default").trim() || "default"
            const savedInitialSkinName = String(savedProgress.initialSkinName || player.initialSkinName || "default").trim() || "default"
            const requestedNormalizedSkinName = String(requestedSkinName || "").trim() || ""
            const savedPumpkinEliminated = Boolean(savedProgress.pumpkinEliminated)
            const savedPumpkinNtrTriggerCount = Number(savedProgress.pumpkinNtrTriggerCount || 0)
            const savedPumpkinBaseSkinName = String(savedProgress.pumpkinBaseSkinName || "")
            const savedPumpkinBaseDoubleHealth = Number(savedProgress.pumpkinBaseDoubleHealth || 0)
            const shouldHonorRequestedSkinDirectly = Boolean(
                requestedNormalizedSkinName &&
                requestedNormalizedSkinName !== PUMPKIN_SKIN_NAME
            )
            const canSwitchToRequestedPumpkin =
                requestedNormalizedSkinName === PUMPKIN_SKIN_NAME &&
                savedSkinName !== PUMPKIN_SKIN_NAME &&
                !savedPumpkinEliminated

            if (shouldHonorRequestedSkinDirectly) {
                player.skinName = requestedNormalizedSkinName
                player.initialSkinName = requestedNormalizedSkinName
                player.pumpkinEliminated = false
            } else {
                player.skinName = canSwitchToRequestedPumpkin
                    ? PUMPKIN_SKIN_NAME
                    : savedSkinName
                player.initialSkinName = canSwitchToRequestedPumpkin
                    ? PUMPKIN_SKIN_NAME
                    : savedInitialSkinName
                player.pumpkinEliminated = canSwitchToRequestedPumpkin
                    ? false
                    : savedPumpkinEliminated
            }
            player.pumpkinNtrTriggerCount = savedPumpkinNtrTriggerCount
            player.pumpkinBaseSkinName = savedPumpkinBaseSkinName
            player.pumpkinBaseDoubleHealth = savedPumpkinBaseDoubleHealth
            if (isPumpkinSkinPlayer(player)) {
                player.pumpkinOwnerConnectionKey = player.connectionKey
                player.pumpkinOriginalOwnerConnectionKey = player.connectionKey
            } else {
                player.pumpkinOwnerConnectionKey = ""
                player.pumpkinOriginalOwnerConnectionKey = ""
                player.pumpkinBaseSkinName = ""
                player.pumpkinBaseDoubleHealth = 0
            }
            player.baseSpeed = getBaseSpeedForPlayer(player)
            player.collisionSlowSpeed = getCollisionSlowSpeedForPlayer(player)
            this.syncDoubleSkinState(player)
            player.x = this.clampToWorld(Number(savedProgress.x || player.x))
            player.y = this.clampToWorld(Number(savedProgress.y || player.y))
            player.facingAngle = typeof savedProgress.facingAngle === "number"
                ? savedProgress.facingAngle
                : player.facingAngle
            player.currentSpeed = Math.max(
                getBaseSpeedForPlayer(player),
                Number(savedProgress.currentSpeed || getBaseSpeedForPlayer(player))
            )
            player.defeatReceivedCount = Number(savedProgress.defeatReceivedCount || 0)
            player.defeatDealtCount = Number(savedProgress.defeatDealtCount || 0)
            player.collisionVisualUntil = Number(savedProgress.collisionVisualUntil || 0)
            player.collisionImpactUntil = Number(savedProgress.collisionImpactUntil || 0)
            player.collisionVisualType = savedProgress.collisionVisualType || "win"
            player.npcDefeatDamageRatio = Number(savedProgress.npcDefeatDamageRatio || 0)
            player.collisionImpactX = Number(savedProgress.collisionImpactX || 0)
            player.collisionImpactY = Number(savedProgress.collisionImpactY || 0)
            player.collisionRecoveryStartedAt = Number(savedProgress.collisionRecoveryStartedAt || 0)
            player.collisionRecoveryUntil = Number(savedProgress.collisionRecoveryUntil || 0)
            player.boostDisabledStartedAt = Number(savedProgress.boostDisabledStartedAt || 0)
            player.boostDisabledUntil = Number(savedProgress.boostDisabledUntil || 0)
            player.deathStartedAt = Number(savedProgress.deathStartedAt || 0)
            player.deathUntil = Number(savedProgress.deathUntil || 0)
            player.respawnRequested = Boolean(savedProgress.respawnRequested)
            player.freeRespawnAfterReset = false
            player.lastActiveInputAt = Number(savedProgress.lastActiveInputAt || player.lastActiveInputAt || Date.now())
            const hasSavedDoubleState = Array.isArray(savedProgress.doubleUnits) && savedProgress.doubleUnits.length === DOUBLE_UNIT_COUNT
            if (hasSavedDoubleState && player.isDoubleSkin) {
                player.doubleMerged = typeof savedProgress.doubleMerged === "boolean" ? savedProgress.doubleMerged : true
                player.doubleSeparationPhase = String(savedProgress.doubleSeparationPhase || (player.doubleMerged ? "merged" : "split"))
                player.doubleMergeLockUntil = Number(savedProgress.doubleMergeLockUntil || 0)
                player.doubleUnits = savedProgress.doubleUnits.map((unit) => ({
                    ...createDoubleUnitState(Date.now()),
                    ...(unit || {}),
                    health: Math.max(
                        0,
                        Math.min(
                            DOUBLE_UNIT_HEALTH,
                            Number(unit && unit.health !== undefined ? unit.health : DOUBLE_UNIT_HEALTH)
                        )
                    ),
                }))
            } else if (player.isDoubleSkin) {
                player.doubleMerged = true
                player.doubleSeparationPhase = "merged"
                player.doubleMergeLockUntil = 0
                player.doubleUnits = [createDoubleUnitState(Date.now()), createDoubleUnitState(Date.now())]
            }
        }
        player.livesRemaining = this.sharedLivesRemaining
        this.syncDoubleSkinState(player)

        this.players.set(resolvedDisplayId, player)
        this.grid.add(player)
        this.updateStoredPlayerProgress(player)
        this.rebalanceNpcHealthForHumanCount()

        return player
    }

    /**
     * 플레이어를 월드에서 제거한다.
     * 펌킨 소유권을 회수하고, 진행도를 저장하며, NPC 체력을 재조정한다.
     * @param {Player} player - 제거할 플레이어
     */
    removePlayer(player) {
        const now = Date.now()
        this.revokePumpkinOwnershipForConnection(player && player.connectionKey, now)
        if (player && !player.isNpc && !player.isDummy) {
            const sessionStartedAt = Number(player.sessionStartedAt || 0)
            const elapsedSeconds = sessionStartedAt > 0 ? Math.floor((now - sessionStartedAt) / 1000) : 0
            if (elapsedSeconds > 0) {
                postStatsUpdate(player.id, { play_seconds: elapsedSeconds })
            }
        }
        this.updateStoredPlayerProgress(player)
        this.grid.remove(player)
        this.players.delete(player.id)
        this.rebalanceNpcHealthForHumanCount()
    }

    /**
     * 클라이언트에서 수신한 입력 데이터를 플레이어에 반영한다.
     * data 는 websocket.js 에서 이미 파싱된 객체이므로 JSON.parse 를 다시 호출하지 않는다.
     * moveX/moveY 는 크기가 1을 초과하면 정규화한다.
     * @param {Player} player - 입력을 받을 플레이어
     * @param {object} data - 파싱된 입력 객체
     */
    handleInput(player, data) {
        try {
            // data 는 websocket.js 에서 이미 파싱된 객체다.
            const input = data
            const rawMoveX = Number(input.moveX || 0)
            const rawMoveY = Number(input.moveY || 0)
            let moveX = Number.isFinite(rawMoveX) ? rawMoveX : 0
            let moveY = Number.isFinite(rawMoveY) ? rawMoveY : 0
            const moveMagnitude = Math.hypot(moveX, moveY)
            if (moveMagnitude > 1) {
                moveX /= moveMagnitude
                moveY /= moveMagnitude
            }
            const requestedBoost = Boolean(input.boost)
            if (!requestedBoost) {
                player.boostReleaseRequired = false
            }

            // 클라이언트 입력 구조는 이 키 집합으로 고정한다.
            player.input = {
                up: Boolean(input.up),
                down: Boolean(input.down),
                left: Boolean(input.left),
                right: Boolean(input.right),
                boost: requestedBoost && !player.boostReleaseRequired,
                special: Boolean(input.special),
                respawn: Boolean(input.respawn),
                moveX,
                moveY
            }
        } catch (error) {
            player.boostReleaseRequired = false
            player.input = {
                up: false,
                down: false,
                left: false,
                right: false,
                boost: false,
                special: false,
                respawn: false,
                moveX: 0,
                moveY: 0
            }
        }
    }

    /**
     * 인간 플레이어의 입력 시각을 기록한다.
     * 소켓 단위 idle close 와는 별도로,
     * "라운드 전체 유휴 초기화" 기준 시각(lastHumanInputAt)을 갱신한다.
     * @param {Player} player - 입력을 보낸 플레이어
     * @param {number} [at] - 기록할 타임스탬프 (기본값: Date.now())
     */
    markHumanInput(player, at = Date.now()) {
        if (!player || player.isNpc || player.isDummy) {
            return
        }

        // 소켓 단위 idle close 와는 별도로,
        // "라운드 전체 유휴 초기화" 기준 시각을 갱신한다.
        this.lastHumanInputAt = at
        player.lastActiveInputAt = at
    }

    /**
     * 게임 틱을 1회 진행한다.
     * 순서: 라운드/인카운터 리셋 확인 → 각 엔티티 이동·부스트·거리 소모 →
     *        벽 충돌 → NPC 연속 돌진 체인 → 플레이어 간 충돌 해소 → grid 갱신
     */
    update() {
        const now = Date.now()
        this.maybeResetAfterInputIdle(now)
        if (this.pendingRoundResetAt) {
            if (now < this.pendingRoundResetAt) {
                // 아직 대기 중 — 매 틱 로그는 너무 많으니 생략
            } else {
                const allOut = this.areAllHumanPlayersOut()
                console.log(`[world.update] pendingReset 도달 now=${now} pending=${this.pendingRoundResetAt} allOut=${allOut} encounterResetOnAllDead=${this.encounterResetOnAllDead}`)
                if (allOut) {
                    // 공용 목숨이 0이 된 상태에서 전원 사망하면 항상 전체 인카운터를 초기화한다.
                    // 라운드만 리셋하면 encounterStage가 유지되어 배경색/BGM이 이전 페이즈에 남는다.
                    this.resetEncounterToInitial(now, { respawnHumans: false })
                    return
                }
            }
        }
        if (this.encounterStage > 0 && this.encounterCountdownUntil && now >= this.encounterCountdownUntil) {
            if (this.encounterStage === 1 || this.encounterStage === 3 || this.encounterStage === 5) {
                this.killAllHumansForEncounterFailure(now)
                this.clearEncounterAnnouncement()
            }
        }
        if (this.encounterFinaleUntil && now >= this.encounterFinaleUntil) {
            if (!this.encounterFinaleRewarded) {
                for (const player of this.players.values()) {
                    if (isPersistentHumanPlayer(player)) {
                        postStatsUpdate(player.id, { game_clears: 1 })
                    }
                }
                this.encounterFinaleRewarded = true
            }
            this.resetEncounterToInitial(now)
            return
        }

        for (const player of this.players.values()) {
            // 사망 상태는 이동/충돌보다 먼저 처리한다.
            if (player.deathUntil !== 0) {
                player.livesRemaining = this.sharedLivesRemaining
                if (!player.isNpc && player.input.respawn && Number(this.sharedLivesRemaining || 0) > 0) {
                    player.respawnRequested = true
                }

                player.boostState = "idle"
                player.currentSpeed = 0
                player.lastMoveX = 0
                player.lastMoveY = 0

                if (player.deathUntil > now) {
                    continue
                }

                if (player.isNpc) {
                    this.grid.remove(player)
                    this.players.delete(player.id)
                    continue
                }

                if (player.isDummy) {
                    if (player.npcRespawnAt > now) {
                        continue
                    }
                    this.respawnPlayer(player, now)
                    continue
                }

                if (player.respawnRequested && Number(this.sharedLivesRemaining || 0) > 0) {
                    this.respawnPlayer(player, now, {
                        consumeSharedLife: !player.freeRespawnAfterReset,
                    })
                }
                continue
            }

            if (player.isPumpkinNpc) {
                if (Number(player.pumpkinFadeOutUntil || 0) > now) {
                    player.currentSpeed = 0
                    player.lastMoveX = 0
                    player.lastMoveY = 0
                    player.boostState = "idle"
                    continue
                }
                if (Number(player.pumpkinFadeOutUntil || 0) !== 0 && Number(player.pumpkinFadeOutUntil || 0) <= now) {
                    this.removePumpkinNpc(player)
                    continue
                }
                if (Number(player.pumpkinDashUntil || 0) > now) {
                    const dashDirectionX = Number(player.pumpkinDashDirectionX || 0)
                    const dashDirectionY = Number(player.pumpkinDashDirectionY || 0)
                    player.boostState = "charging"
                    player.currentSpeed = PUMPKIN_NPC_DEFEAT_DASH_SPEED_PER_SECOND
                    player.facingAngle = Math.atan2(dashDirectionY, dashDirectionX)
                    player.lastMoveX = dashDirectionX * player.currentSpeed * TICK_DELTA_SECONDS
                    player.lastMoveY = dashDirectionY * player.currentSpeed * TICK_DELTA_SECONDS
                    player.x = this.clampToWorld(player.x + player.lastMoveX)
                    player.y = this.clampToWorld(player.y + player.lastMoveY)
                    continue
                }
                if (Number(player.pumpkinDashUntil || 0) !== 0) {
                    player.pumpkinDashDirectionX = 0
                    player.pumpkinDashDirectionY = 0
                    player.pumpkinDashStartedAt = 0
                    player.pumpkinDashUntil = 0
                }
                player.boostState = "idle"
                player.currentSpeed = 0
                player.lastMoveX = 0
                player.lastMoveY = 0
                continue
            }

            let dx = 0
            let dy = 0

            if (player.isNpc) {
                // 네르는 자체 AI 상태머신이 방향 벡터를 결정한다.
                const npcVector = this.updateNpc(player, now)
                dx = npcVector.dx
                dy = npcVector.dy
            } else if (player.isDummy) {
                const dummyVector = this.updateDummy(player)
                dx = dummyVector.dx
                dy = dummyVector.dy
            } else {
                const inputMoveX = Number(player.input && player.input.moveX !== undefined ? player.input.moveX : 0)
                const inputMoveY = Number(player.input && player.input.moveY !== undefined ? player.input.moveY : 0)
                const inputMagnitude = Math.hypot(inputMoveX, inputMoveY)
                if (Number.isFinite(inputMagnitude) && inputMagnitude > 0.001) {
                    dx = inputMoveX
                    dy = inputMoveY
                    if (inputMagnitude > 1) {
                        dx /= inputMagnitude
                        dy /= inputMagnitude
                    }
                } else {
                    if (player.input.left) dx -= 1
                    if (player.input.right) dx += 1
                    if (player.input.up) dy -= 1
                    if (player.input.down) dy += 1
                }
            }

            const isMoving = dx !== 0 || dy !== 0

            if (dx !== 0 && dy !== 0) {
                dx *= Math.SQRT1_2
                dy *= Math.SQRT1_2
            }

            if (player.isDoubleSkin && !player.isNpc && !player.isDummy) {
                const doubleVector = this.updateDoubleUnits(player, now, dx, dy)
                player.lastMoveX = Number(doubleVector.dx || 0)
                player.lastMoveY = Number(doubleVector.dy || 0)
                if (player.lastMoveX !== 0 || player.lastMoveY !== 0) {
                    player.facingAngle = Math.atan2(player.lastMoveY, player.lastMoveX)
                }
                continue
            }

            if (player.collisionRecoveryUntil > now) {
                // 충돌 회복 시간 동안은 지정된 느린 속도에서 기본속도로 선형 복귀한다.
                const recoveryDuration = player.collisionRecoveryUntil - player.collisionRecoveryStartedAt
                const recoveryProgress = recoveryDuration > 0
                    ? (now - player.collisionRecoveryStartedAt) / recoveryDuration
                    : 1
                const clampedRecoveryProgress = Math.max(0, Math.min(1, recoveryProgress))
                const easedRecoveryProgress = 1 - Math.pow(1 - clampedRecoveryProgress, 2)

                player.boostState = "idle"
                const baseSpeed = getBaseSpeedForPlayer(player)
                player.currentSpeed = player.collisionSlowSpeed +
                    (baseSpeed - player.collisionSlowSpeed) * easedRecoveryProgress
            } else {
                if (player.collisionRecoveryUntil !== 0) {
                    player.collisionRecoveryStartedAt = 0
                    player.collisionRecoveryUntil = 0
                    player.currentSpeed = getBaseSpeedForPlayer(player)
                }

                const boostLocked = player.boostDisabledUntil > now

                if (boostLocked) {
                    player.boostState = "idle"
                    player.input.boost = false
                    player.boostDirectionX = 0
                    player.boostDirectionY = 0
                }

                if (player.isDummy && player.dummyState === "charging" && player.boostState === "idle") {
                    player.boostState = "charging"
                } else if (player.isNpc && player.npcState === "charging" && player.boostState === "idle") {
                    player.boostState = "charging"
                } else if (player.input.boost && !boostLocked && player.boostState === "idle" && isMoving) {
                    // 유저 돌진은 시작 방향 저장 후 charging 으로 진입한다.
                    player.boostState = "charging"
                    player.boostDirectionX = dx
                    player.boostDirectionY = dy
                }

                if (player.boostState === "charging") {
                    // charging / cooldown 동안 유저는 시작 방향 고정 직진이다.
                    if (player.isDummy && player.dummyState === "charging") {
                        dx = player.boostDirectionX
                        dy = player.boostDirectionY
                    } else if (!player.isNpc) {
                        dx = player.boostDirectionX
                        dy = player.boostDirectionY
                    }
                    const maxBoostedSpeed = player.isNpc ? NPC_MAX_BOOSTED_SPEED_PER_SECOND : getMaxBoostedSpeedForPlayer(player)
                    const boostAcceleration = player.isNpc ? NPC_BOOST_ACCELERATION_PER_SECOND : getBoostAccelerationForPlayer(player)
                    player.currentSpeed = Math.min(
                        maxBoostedSpeed,
                        player.currentSpeed + boostAcceleration * TICK_DELTA_SECONDS
                    )
                    if (player.currentSpeed >= maxBoostedSpeed) {
                        player.boostState = "cooldown"
                    }
                } else if (player.boostState === "cooldown") {
                    if (player.isDummy && player.dummyState === "charging") {
                        dx = player.boostDirectionX
                        dy = player.boostDirectionY
                    } else if (!player.isNpc) {
                        dx = player.boostDirectionX
                        dy = player.boostDirectionY
                    }
                    const boostCooldown = player.isNpc ? NPC_BOOST_COOLDOWN_PER_SECOND : getBoostCooldownForPlayer(player)
                    const baseSpeed = getBaseSpeedForPlayer(player)
                    player.currentSpeed = Math.max(
                        baseSpeed,
                        player.currentSpeed - boostCooldown * TICK_DELTA_SECONDS
                    )
                    if (player.currentSpeed <= baseSpeed) {
                        player.currentSpeed = baseSpeed
                        if (player.isNpc) {
                            player.npcState = "rest"
                            player.npcRestUntil = now + NPC_REST_DURATION_MS
                            if (player.npcQueuedExtraCharges <= 0) {
                                player.npcTargetId = ""
                            }
                            player.boostState = "idle"
                            player.boostDirectionX = 0
                            player.boostDirectionY = 0
                        } else if (player.isDummy) {
                            player.boostState = "idle"
                            player.currentSpeed = getBaseSpeedForPlayer(player)
                            player.dummyChargeDistanceRemaining = 0
                            player.dummyChargeDistanceTotal = 0
                            player.dummyState = "rest"
                            player.dummyRestUntil = now + NPC_REST_DURATION_MS
                        } else if (!player.input.boost) {
                            player.boostState = "idle"
                            player.boostDirectionX = 0
                            player.boostDirectionY = 0
                            if (player.boostDisabledUntil <= now) {
                                player.boostDisabledStartedAt = now
                                player.boostDisabledUntil = now + USER_POST_BOOST_COOLDOWN_MS
                            }
                        }
                    }
                } else if (!isMoving) {
                    // 멈춘 상태에서는 남아 있던 속도를 자연스럽게 기본속도로 낮춘다.
                    const baseSpeed = getBaseSpeedForPlayer(player)
                    player.currentSpeed = Math.max(
                        baseSpeed,
                        player.currentSpeed - BOOST_COOLDOWN_PER_SECOND * TICK_DELTA_SECONDS
                    )
                } else {
                    player.currentSpeed = getBaseSpeedForPlayer(player)
                    player.boostDirectionX = 0
                    player.boostDirectionY = 0
                }
            }

            if (dx !== 0 || dy !== 0) {
                // 돌진 잠금으로 보정된 최종 이동 방향 기준으로만 회전 각도를 갱신한다.
                player.facingAngle = Math.atan2(dy, dx)
            }

            player.lastMoveX = dx * player.currentSpeed * TICK_DELTA_SECONDS
            player.lastMoveY = dy * player.currentSpeed * TICK_DELTA_SECONDS

            if (player.isNpc && player.npcState === "charging") {
                player.npcChargeDistanceRemaining = Math.max(
                    0,
                    (player.npcChargeDistanceRemaining || 0) - Math.hypot(player.lastMoveX, player.lastMoveY)
                )
            } else if (player.isDummy && player.dummyState === "charging") {
                player.dummyChargeDistanceRemaining = Math.max(
                    0,
                    (player.dummyChargeDistanceRemaining || 0) - Math.hypot(player.lastMoveX, player.lastMoveY)
                )
                if (player.dummyChargeDistanceRemaining <= 0) {
                    if (player.dummyQueuedExtraCharges > 0) {
                        player.boostState = "idle"
                        player.currentSpeed = getBaseSpeedForPlayer(player)
                        player.dummyState = "rest"
                        player.dummyRestUntil = now
                    } else {
                        player.boostState = "idle"
                        player.currentSpeed = DUMMY_BASE_SPEED_PER_SECOND
                        player.dummyState = "rest"
                        player.dummyRestUntil = now + NPC_REST_DURATION_MS
                    }
                }
            }

            const nextX = player.x + player.lastMoveX
            const nextY = player.y + player.lastMoveY
            const hitLeftWall = nextX < 0
            const hitRightWall = nextX > WORLD_SIZE
            const hitTopWall = nextY < 0
            const hitBottomWall = nextY > WORLD_SIZE

            player.x = this.applyWallBouncePosition(nextX, player.lastMoveX)
            player.y = this.applyWallBouncePosition(nextY, player.lastMoveY)

            if (
                (player.boostState === "charging" || player.boostState === "cooldown") &&
                (hitLeftWall || hitRightWall || hitTopWall || hitBottomWall)
            ) {
                const hitNormalX = hitLeftWall ? 1 : (hitRightWall ? -1 : 0)
                const hitNormalY = hitTopWall ? 1 : (hitBottomWall ? -1 : 0)
                if (player.isNpc) {
                    this.recordNpcPhaseAttackDodge(player)
                }
                this.handleWallBoostCollision(player, now, hitNormalX, hitNormalY)
            }

            if (player.isNpc && player.npcState === "charging" && player.npcChargeDistanceRemaining <= 0) {
                let chainedExtraCharge = false
                if (player.npcQueuedExtraCharges > 0) {
                    const retainedTarget = this.getNpcTarget(player)
                    if (retainedTarget) {
                        const retainedDiffX = retainedTarget.x - player.x
                        const retainedDiffY = retainedTarget.y - player.y
                        const retainedDistance = Math.hypot(retainedDiffX, retainedDiffY)
                        const chargePattern = this.getNpcChargePattern(player, player.npcPhase || getNpcPhase(player))
                        const instantExtraCharge = chargePattern.instantExtraCharge
                        player.npcQueuedExtraCharges = Math.max(0, player.npcQueuedExtraCharges - 1)
                        player.lastMoveX = 0
                        player.lastMoveY = 0
                        this.startNpcChargeSkill(
                            player,
                            retainedDiffX,
                            retainedDiffY,
                            retainedDistance,
                            {
                                queueExtraCharge: false,
                                instant: instantExtraCharge,
                                distanceMultiplier: NPC_EXTRA_CHARGE_DISTANCE_MULTIPLIER,
                                targetId: retainedTarget.id,
                                isPhaseAttack: true,
                            }
                        )
                        chainedExtraCharge = true
                    } else {
                        player.npcQueuedExtraCharges = 0
                    }
                }
                if (!chainedExtraCharge && player.npcQueuedExtraCharges <= 0) {
                    this.recordNpcPhaseAttackDodge(player)
                    // 돌진 거리를 다 쓰면 네르는 rest 로 들어가고 다음 타겟 선정까지 대기한다.
                    player.npcState = "rest"
                    player.npcRestUntil = now + NPC_REST_DURATION_MS
                    player.npcTargetId = ""
                    player.npcChargeDistanceRemaining = 0
                    player.boostState = "idle"
                    player.currentSpeed = getNpcBaseSpeed(player)
                    player.lastMoveX = 0
                    player.lastMoveY = 0
                }
            }
        }

        // 이동이 끝난 뒤 한 번에 충돌을 해소한다.
        this.resolvePlayerCollisions()

        for (const player of this.players.values()) {
            // 최종 위치 기준으로 spatial grid 도 갱신한다.
            this.grid.move(player)
        }
    }
}

// ── 믹스인 주입 ──────────────────────────────────────────────────────────────
// 각 파일은 World.prototype 에 메서드 집합을 추가한다.
// 주입 순서: 의존 관계가 있는 경우 피의존 모듈을 먼저 주입한다.
// (예: worldDeath → worldCollision.isPlayerDead 에 의존 → worldCollision 먼저)
Object.assign(World.prototype, require("./worldSpawn"))
Object.assign(World.prototype, require("./worldProgress"))
Object.assign(World.prototype, require("./worldRound"))
Object.assign(World.prototype, require("./worldPumpkin"))
Object.assign(World.prototype, require("./worldEncounter"))
Object.assign(World.prototype, require("./worldNpc"))
Object.assign(World.prototype, require("./worldDummy"))
Object.assign(World.prototype, require("./worldDouble"))
Object.assign(World.prototype, require("./worldCollision"))
Object.assign(World.prototype, require("./worldDeath"))

module.exports = World
