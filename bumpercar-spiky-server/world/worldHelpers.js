// 클래스 밖에서 사용하는 독립 헬퍼 함수들을 모아 둔 파일이다.
// 플레이어 종류 판별, 속도 계산, 사망 판정, NPC/더미 페이즈 결정 등 순수 함수들이 포함된다.

const { getGameplaySettings } = require("../config/gameplaySettings")
const {
    DEFAULT_SKIN_NAME,
    DOUBLE_SKIN_NAME,
    PUMPKIN_SKIN_NAME,
    EVOLUTION_SKIN_NAME,
    MANY_SKIN_NAME,
    PLAYER_SPEED_MULTIPLIERS,
    DEFAULT_PLAYER_SPEED_MULTIPLIER,
    MANY_HEALTH_SEGMENTS,
    EVOLUTION_HEALTH_SEGMENTS,
    PLAYER_DEATH_TRIGGER_COUNT,
    DOUBLE_UNIT_HEALTH,
} = require("../config/constants")

const GAMEPLAY_SETTINGS = getGameplaySettings()
const BASE_PLAYER_SPEED_PER_SECOND = GAMEPLAY_SETTINGS.user_base_speed
const DUMMY_BASE_SPEED_PER_SECOND = BASE_PLAYER_SPEED_PER_SECOND * 1.5
const NPC_BASE_SPEED_PER_SECOND = GAMEPLAY_SETTINGS.npc_base_speed
const MAX_BOOSTED_SPEED_PER_SECOND = GAMEPLAY_SETTINGS.user_max_boost_speed
const DEFAULT_PLAYER_BOOST_SPEED_MULTIPLIER = Math.max(1, MAX_BOOSTED_SPEED_PER_SECOND / Math.max(1, BASE_PLAYER_SPEED_PER_SECOND))
const NPC_MAX_BOOSTED_SPEED_PER_SECOND = GAMEPLAY_SETTINGS.npc_max_boost_speed
const NPC_MAX_HEALTH = GAMEPLAY_SETTINGS.npc_max_health
const NPC_PHASE_TWO_HEALTH_RATIO = GAMEPLAY_SETTINGS.npc_phase_two_health_ratio
const NPC_PHASE_THREE_HEALTH_RATIO = GAMEPLAY_SETTINGS.npc_phase_three_health_ratio
const RAISE_SPEAKI_LEVEL_BOOST_SCALE_FACTOR = 1.1

// NPC(네르)의 기본 이동 속도를 반환한다.
// player.npcSpeedMultiplier 가 있으면 기본 속도에 곱해 반환하며, 최솟값은 0.1배다.
function getNpcBaseSpeed(player) {
    const multiplier = Math.max(0.1, Number(player && player.npcSpeedMultiplier || 1))
    return NPC_BASE_SPEED_PER_SECOND * multiplier
}

// 스킨 이름(skinName)에 해당하는 캐릭터 게임플레이 설정을 반환한다.
// 설정 파일에 값이 없으면 스킨별 기본값으로 폴백하며,
// 반환값에는 기본속도 배율, 최대 부스트 속도 배율, 최대 체력 세그먼트, 이동 타입이 포함된다.
function getCharacterGameplaySettings(skinName) {
    const normalizedSkinName = String(skinName || DEFAULT_SKIN_NAME).trim().toLowerCase() || DEFAULT_SKIN_NAME
    const configuredSettings = GAMEPLAY_SETTINGS.character_settings && typeof GAMEPLAY_SETTINGS.character_settings === "object"
        ? GAMEPLAY_SETTINGS.character_settings[normalizedSkinName]
        : null
    const fallbackSettings = {
        base_speed_multiplier: PLAYER_SPEED_MULTIPLIERS[normalizedSkinName] || DEFAULT_PLAYER_SPEED_MULTIPLIER,
        max_boost_speed_multiplier: DEFAULT_PLAYER_BOOST_SPEED_MULTIPLIER,
        max_health_segments: normalizedSkinName === MANY_SKIN_NAME
            ? MANY_HEALTH_SEGMENTS
            : (normalizedSkinName === DOUBLE_SKIN_NAME
                ? 4
                : (normalizedSkinName === EVOLUTION_SKIN_NAME
                    ? EVOLUTION_HEALTH_SEGMENTS
                    : PLAYER_DEATH_TRIGGER_COUNT)),
        movement_type: normalizedSkinName === EVOLUTION_SKIN_NAME ? "evolution" : "classic",
    }
    return {
        base_speed_multiplier: Math.max(0.1, Number(configuredSettings && configuredSettings.base_speed_multiplier || fallbackSettings.base_speed_multiplier)),
        max_boost_speed_multiplier: Math.max(0.1, Number(configuredSettings && configuredSettings.max_boost_speed_multiplier || fallbackSettings.max_boost_speed_multiplier)),
        max_health_segments: Math.max(1, Math.round(Number(configuredSettings && configuredSettings.max_health_segments || fallbackSettings.max_health_segments))),
        movement_type: String(configuredSettings && configuredSettings.movement_type || fallbackSettings.movement_type).trim().toLowerCase() === "evolution"
            ? "evolution"
            : "classic",
    }
}

// 플레이어 스킨에 따른 기본 속도 배율을 반환한다.
function getPlayerSpeedMultiplier(player) {
    return getCharacterGameplaySettings(player && player.skinName).base_speed_multiplier
}

// 플레이어 종류(NPC·더미·일반)에 따른 기본 이동 속도를 반환한다.
// NPC는 getNpcBaseSpeed, 더미는 고정 상수, 일반 유저는 스킨 배율을 적용한다.
function getBaseSpeedForPlayer(player) {
    if (player && player.isNpc) {
        return getNpcBaseSpeed(player)
    }
    if (player && player.isDummy) {
        return DUMMY_BASE_SPEED_PER_SECOND
    }
    return BASE_PLAYER_SPEED_PER_SECOND * getPlayerSpeedMultiplier(player)
}

// 플레이어가 "double" 스킨인지 여부를 반환한다.
function isDoubleSkinPlayer(player) {
    return Boolean(player) && String(player.skinName || "").trim().toLowerCase() === DOUBLE_SKIN_NAME
}

// 플레이어가 "pumkin" 스킨인지 여부를 반환한다.
function isPumpkinSkinPlayer(player) {
    return Boolean(player) && String(player.skinName || "").trim().toLowerCase() === PUMPKIN_SKIN_NAME
}

// 플레이어가 NPC·더미·집·펌킨NPC가 아닌 "default" 스킨 일반 유저인지 반환한다.
function isClassicDefaultPlayer(player) {
    return Boolean(player) &&
        !player.isNpc &&
        !player.isDummy &&
        !player.isHouse &&
        !player.isPumpkinNpc &&
        String(player.skinName || "").trim().toLowerCase() === "default"
}

// double 스킨 유닛 중 살아 있는 유닛이 정확히 1개인 플레이어인지 반환한다.
function isSingleDoublePlayer(player) {
    return Boolean(player) &&
        !player.isNpc &&
        !player.isDummy &&
        !player.isHouse &&
        !player.isPumpkinNpc &&
        isDoubleSkinPlayer(player) &&
        getDoubleAliveUnitIndices(player).length === 1
}

// 살아 있는 double 유닛이 1개인 플레이어의 남은 체력을 반환한다.
// 살아 있는 유닛이 없으면 0을 반환한다.
function getSingleDoublePlayerHealth(player) {
    const aliveIndices = getDoubleAliveUnitIndices(player)
    if (!aliveIndices.length) {
        return 0
    }
    const liveUnit = player.doubleUnits[aliveIndices[0]]
    return Math.max(0, Math.min(DOUBLE_UNIT_HEALTH, Number(liveUnit && liveUnit.health || 0)))
}

// 펌킨 스킨 플레이어의 생명 세그먼트 수를 반환한다.
// pumpkinBaseSkinName 이 "double_single" 이면 DOUBLE_UNIT_HEALTH, 아니면 기본 사망 트리거 횟수다.
function getPumpkinLifeSegments(player) {
    if (player && Number(player.raiseSpeakiMaxHealthSegments || 0) > 0) {
        return Math.max(1, Math.round(Number(player.raiseSpeakiMaxHealthSegments || 1)))
    }
    if (player && String(player.pumpkinBaseSkinName || "").trim().toLowerCase() === "double_single") {
        return DOUBLE_UNIT_HEALTH
    }
    return PLAYER_DEATH_TRIGGER_COUNT
}

// 플레이어의 공격 피해 배율을 반환한다.
// double 스킨은 0.65배, 그 외 스킨은 1배다.
function getPlayerAttackDamageScale(player) {
    if (player && Number(player.raiseSpeakiAttackDamageScale || 0) > 0) {
        return Math.max(0.1, Number(player.raiseSpeakiAttackDamageScale || 1))
    }
    if (isDoubleSkinPlayer(player)) {
        return 0.65
    }
    return 1
}

// 일반 유저 플레이어가 현재 부스트 공격 중인지 판단한다.
// boostState 가 charging/cooldown 이거나 현재 속도가 기본 속도를 초과하면 true를 반환한다.
function isUserBoostAttacking(player) {
    if (!player || player.isNpc || player.isDummy || player.isPumpkinNpc || player.isHouse) {
        return false
    }
    return (
        player.boostState === "charging" ||
        player.boostState === "cooldown" ||
        Number(player.currentSpeed || 0) > getBaseSpeedForPlayer(player)
    )
}

// 충돌 판정 시 플레이어가 공격 상태인지 반환한다.
// NPC는 charging 상태, 더미는 dummyState charging, 일반 유저는 isUserBoostAttacking 기준이다.
function isPlayerAttackingForCollision(player) {
    if (!player) {
        return false
    }
    if (player.isNpc) {
        return player.npcState === "charging"
    }
    if (player.isDummy) {
        return player.dummyState === "charging"
    }
    return isUserBoostAttacking(player)
}

// double 스킨 플레이어에서 체력이 남아 있는 유닛의 인덱스 배열을 반환한다.
// doubleUnits 가 없거나 유닛이 모두 죽었으면 빈 배열을 반환한다.
function getDoubleAliveUnitIndices(player) {
    if (!player || !Array.isArray(player.doubleUnits)) {
        return []
    }
    const indices = []
    player.doubleUnits.forEach((unit, index) => {
        if (unit && Number(unit.health || 0) > 0) {
            indices.push(index)
        }
    })
    return indices
}

// 플레이어의 최대 부스트 속도를 반환한다.
// NPC는 고정 상수, 일반 유저는 기본 속도에 캐릭터 설정 배율을 곱한 값이다.
function getMaxBoostedSpeedForPlayer(player) {
    if (player && player.isNpc) {
        return NPC_MAX_BOOSTED_SPEED_PER_SECOND
    }
    return getBaseSpeedForPlayer(player) * getCharacterGameplaySettings(player && player.skinName).max_boost_speed_multiplier * getRaiseSpeakiBoostDistanceMultiplier(player)
}

function getRaiseSpeakiBoostDistanceMultiplier(entity) {
    const level = Math.max(1, Math.round(Number(entity && (entity.raiseSpeakiLevel || entity.level) || 1)))
    if (!entity || Number(entity.raiseSpeakiLevel || entity.level || 0) <= 0) {
        return 1
    }
    return Math.pow(RAISE_SPEAKI_LEVEL_BOOST_SCALE_FACTOR, level - 1)
}

// 플레이어의 스킨별 부스트 acceleration 을 반환한다.
// deltaSpeed 와 user_boost_duration_ms 로부터 유도해 모든 스킨이 동일한 부스트 시간을 갖도록 한다.
// NPC·더미·펌킨NPC 는 fallback(전역 설정값)을 반환한다.
const USER_BOOST_DURATION_SECONDS = Math.max(0.001, GAMEPLAY_SETTINGS.user_boost_duration_ms / 1000)
const FALLBACK_BOOST_ACCELERATION = GAMEPLAY_SETTINGS.user_boost_acceleration
function getBoostAccelerationForPlayer(player) {
    if (!player || player.isNpc || player.isDummy || player.isPumpkinNpc || player.isHouse) {
        return FALLBACK_BOOST_ACCELERATION
    }
    const baseSpd = getBaseSpeedForPlayer(player)
    const maxBoostedSpd = getMaxBoostedSpeedForPlayer(player)
    const deltaSpd = Math.max(0, maxBoostedSpd - baseSpd)
    if (deltaSpd <= 0) {
        return FALLBACK_BOOST_ACCELERATION
    }
    return (3 * deltaSpd) / (2 * USER_BOOST_DURATION_SECONDS)
}

// 플레이어의 스킨별 부스트 cooldown 을 반환한다.
// getBoostAccelerationForPlayer 의 2배로, charging 과 cooldown 시간 비율이 1:2 를 유지한다.
function getBoostCooldownForPlayer(player) {
    return getBoostAccelerationForPlayer(player) * 2
}

// 충돌 직후 적용되는 감속 속도를 반환한다.
// 기본 속도의 35% 값이며, NPC·더미·일반 유저 각각 기준 속도가 다르다.
function getCollisionSlowSpeedForPlayer(player) {
    if (player && player.isNpc) {
        return NPC_BASE_SPEED_PER_SECOND * 0.35
    }
    if (player && player.isDummy) {
        return DUMMY_BASE_SPEED_PER_SECOND * 0.35
    }
    return getBaseSpeedForPlayer(player) * 0.35
}

// 플레이어가 사망 판정을 받기까지 누적해야 하는 피격 횟수(체력 세그먼트)를 반환한다.
// 펌킨 스킨은 getPumpkinLifeSegments, 그 외 스킨은 캐릭터 설정값을 사용한다.
function getPlayerDeathTriggerCount(player) {
    if (player && Number(player.raiseSpeakiMaxHealthSegments || 0) > 0) {
        return Math.max(1, Math.round(Number(player.raiseSpeakiMaxHealthSegments || 1)))
    }
    if (!player || player.isNpc || player.isDummy) {
        return PLAYER_DEATH_TRIGGER_COUNT
    }
    const skinName = String(player.skinName || "").trim().toLowerCase()
    if (skinName === PUMPKIN_SKIN_NAME) {
        return getPumpkinLifeSegments(player)
    }
    return getCharacterGameplaySettings(skinName).max_health_segments
}

// NPC(네르)의 현재 전투 페이즈(1~3)를 반환한다.
// 남은 체력 비율이 낮을수록 높은 페이즈로 전환되며, NPC가 아니면 항상 1을 반환한다.
function getNpcPhase(player) {
    if (!player || !player.isNpc) {
        return 1
    }
    const npcMaxHealth = Math.max(1, Number(player.npcMaxHealth || NPC_MAX_HEALTH))
    const healthRatio = npcMaxHealth > 0
        ? Math.max(0, Math.min(1, (player.npcHealth || 0) / npcMaxHealth))
        : 1

    if (healthRatio <= NPC_PHASE_THREE_HEALTH_RATIO) {
        return 3
    }
    if (healthRatio <= NPC_PHASE_TWO_HEALTH_RATIO) {
        return 2
    }
    return 1
}

// 더미 플레이어의 현재 전투 페이즈(1~3)를 반환한다.
// 현재 생명 주기에서 남은 체력 세그먼트 수로 페이즈를 결정하며, 더미가 아니면 1을 반환한다.
function getDummyPhase(player) {
    if (!player || !player.isDummy) {
        return 1
    }
    const deathTriggerCount = Math.max(1, getPlayerDeathTriggerCount(player))
    const defeatsInCurrentLife = Number(player.defeatReceivedCount || 0) % deathTriggerCount
    const remainingHealthSegments = Math.max(0, deathTriggerCount - defeatsInCurrentLife)

    if (remainingHealthSegments <= 1) {
        return 3
    }
    if (remainingHealthSegments <= 2) {
        return 2
    }
    return 1
}

// 플레이어가 지속적으로 존재하는 인간 유저인지 반환한다.
// NPC·더미·펌킨NPC·집은 제외된다.
function isPersistentHumanPlayer(player) {
    return Boolean(player) && !player.isNpc && !player.isDummy && !player.isPumpkinNpc && !player.isHouse
}

module.exports = {
    getNpcBaseSpeed,
    getCharacterGameplaySettings,
    getPlayerSpeedMultiplier,
    getBaseSpeedForPlayer,
    isDoubleSkinPlayer,
    isPumpkinSkinPlayer,
    isClassicDefaultPlayer,
    isSingleDoublePlayer,
    getSingleDoublePlayerHealth,
    getPumpkinLifeSegments,
    getPlayerAttackDamageScale,
    isUserBoostAttacking,
    isPlayerAttackingForCollision,
    getDoubleAliveUnitIndices,
    getMaxBoostedSpeedForPlayer,
    getBoostAccelerationForPlayer,
    getBoostCooldownForPlayer,
    getRaiseSpeakiBoostDistanceMultiplier,
    getCollisionSlowSpeedForPlayer,
    getPlayerDeathTriggerCount,
    getNpcPhase,
    getDummyPhase,
    isPersistentHumanPlayer,
}
