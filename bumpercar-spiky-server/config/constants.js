// 게임플레이 설정(gameplaySettings)에 의존하지 않는 하드코딩 상수들을 모아 둔 파일이다.
// 충돌 판정, 반발, 시각 효과, 사망/리스폰, NPC·더미·집·인카운터·스킨별 수치 등을 포함한다.

// ─────────────────────────────────────────────
// 플레이어 충돌 반지름 (아이콘 비율 기반 둥근 직사각형)
// ─────────────────────────────────────────────
// 유저 충돌 판정은 아이콘 비율에 맞춘 둥근 직사각형 기반으로 계산한다.
const PLAYER_COLLISION_HALF_HEIGHT = 20
const PLAYER_COLLISION_HALF_WIDTH = PLAYER_COLLISION_HALF_HEIGHT * (300 / 306)

// ─────────────────────────────────────────────
// 펌킨 충돌 배율
// ─────────────────────────────────────────────
const PUMPKIN_PLAYER_COLLISION_SCALE = 1.5
const PUMPKIN_NPC_COLLISION_WIDTH_SCALE = PUMPKIN_PLAYER_COLLISION_SCALE * 0.8
const PUMPKIN_NPC_COLLISION_HEIGHT_SCALE = PUMPKIN_PLAYER_COLLISION_SCALE * 0.5

// ─────────────────────────────────────────────
// NPC(네르) 충돌 크기
// ─────────────────────────────────────────────
const NPC_COLLISION_SCALE = 3.75
const NPC_COLLISION_SIZE_MULTIPLIER = 0.6
const NPC_COLLISION_HALF_HEIGHT = PLAYER_COLLISION_HALF_HEIGHT * NPC_COLLISION_SCALE * NPC_COLLISION_SIZE_MULTIPLIER
const NPC_COLLISION_HALF_WIDTH = NPC_COLLISION_HALF_HEIGHT * 0.5

// ─────────────────────────────────────────────
// 충돌 반발 / 시각 효과 / 가속 잠금 공통 상수
// ─────────────────────────────────────────────
// 아래 값들은 충돌 반발/시각효과/가속 잠금에 대한 공통 상수다.
const COLLISION_BOUNCE_DISTANCE = 30
const COLLISION_SPEED_BOUNCE_MULTIPLIER = 5.4
const COLLISION_MAX_BOUNCE_DISTANCE = 78
const WALL_BOUNCE_DISTANCE = 36
const WALL_BOUNCE_SPEED_BOUNCE_MULTIPLIER = 5.4
const WALL_MAX_BOUNCE_DISTANCE = 90
const COLLISION_VISUAL_BASE_DURATION_MS = 1000
const COLLISION_IMPACT_DURATION_MS = 360
const COLLISION_VISUAL_SPEED_DURATION_MULTIPLIER_MS = 90
const COLLISION_VISUAL_MAX_DURATION_MS = 3000
const COLLISION_RECOVERY_DURATION_MS = 1600
const COLLISION_BOOST_LOCK_DURATION_MS = 3000
const COLLISION_ATTACK_DIRECTION_THRESHOLD = 0.001

// ─────────────────────────────────────────────
// 플레이어 사망 / 리스폰
// ─────────────────────────────────────────────
const PLAYER_DEATH_TRIGGER_COUNT = 3
const PLAYER_DEATH_DURATION_MS = 3000
const DUMMY_RESPAWN_DELAY_MS = 3 * 60 * 1000
const RESPAWN_EDGE_PADDING = 120

// ─────────────────────────────────────────────
// NPC 사망 / 페이즈 전환 / 더미 반격 / 반발 배율
// ─────────────────────────────────────────────
const NPC_DEATH_ANIMATION_DURATION_MS = 5000
const NPC_PHASE_THREE_TRIGGER_DISTANCE_MULTIPLIER = 1.5
const DUMMY_RETALIATION_DISTANCE_MULTIPLIER = 1.2
const NPC_DEFEAT_BOUNCE_MULTIPLIER = 1.5

// ─────────────────────────────────────────────
// 집(House) 인카운터 스테이지 ID / 체력
// ─────────────────────────────────────────────
const HOUSE_STAGE_ONE_ID = "house-1"
const HOUSE_STAGE_TWO_ID = "house-2"
const HOUSE_STAGE_THREE_ID = "house-3"
const HOUSE_STAGE_ONE_HEALTH = 30
const HOUSE_STAGE_TWO_HEALTH = 30
const HOUSE_STAGE_THREE_HEALTH = 30

// ─────────────────────────────────────────────
// 집 충돌 크기 / 폴리곤
// ─────────────────────────────────────────────
const HOUSE_COLLISION_SCALE = 0.5
const HOUSE_COLLISION_HALF_WIDTH = 110 * HOUSE_COLLISION_SCALE
const HOUSE_COLLISION_HALF_HEIGHT = HOUSE_COLLISION_HALF_WIDTH * (508 / 815)
const HOUSE_COLLISION_POLYGON = [
    { x: -0.291, y: -0.42 },
    { x: 0.265, y: -0.42 },
    { x: 0.308, y: -0.34 },
    { x: 0.305, y: -0.22 },
    { x: 0.369, y: -0.1 },
    { x: 0.348, y: 0.06 },
    { x: 0.399, y: 0.22 },
    { x: 0.47, y: 0.38 },
    { x: 0.217, y: 0.5 },
    { x: -0.242, y: 0.5 },
    { x: -0.473, y: 0.38 },
    { x: -0.399, y: 0.22 },
    { x: -0.407, y: 0.06 },
    { x: -0.399, y: -0.1 },
    { x: -0.354, y: -0.22 },
    { x: -0.32, y: -0.34 },
]

// ─────────────────────────────────────────────
// 인카운터 타이머 / 목숨 / 안내 키
// ─────────────────────────────────────────────
const ENCOUNTER_STAGE_ONE_COUNTDOWN_MS = 3 * 60 * 1000
const ENCOUNTER_STAGE_TWO_COUNTDOWN_MS = 2 * 60 * 1000
const ENCOUNTER_STAGE_THREE_COUNTDOWN_MS = 60 * 1000
const ENCOUNTER_FINALE_DURATION_MS = 20 * 1000
const ENCOUNTER_STAGE_ONE_LIVES = 4
const ENCOUNTER_STAGE_TWO_LIVES = 5
const ENCOUNTER_ANNOUNCEMENT_STAGE_ONE = "ner_knocks_door"
const ENCOUNTER_ANNOUNCEMENT_STAGE_TWO = "ner_breaks_door"
const ENCOUNTER_ANNOUNCEMENT_STAGE_THREE = "ner_holds_deed"
const ENCOUNTER_ANNOUNCEMENT_FINALE = "ner_true_finale"

// ─────────────────────────────────────────────
// 유휴 입력 초기화 기준 시간
// ─────────────────────────────────────────────
// 전체 인간 유저 입력이 이 시간 동안 없으면 진행 상태를 초기화한다.
const INPUT_IDLE_RESET_MS = 10 * 60 * 1000

// ─────────────────────────────────────────────
// 스킨 이름 상수
// ─────────────────────────────────────────────
const EVOLUTION_SKIN_NAME = "evolution"
const DEFAULT_SKIN_NAME = "default"
const MANY_SKIN_NAME = "many"
const DOUBLE_SKIN_NAME = "double"
const PUMPKIN_SKIN_NAME = "pumkin"

// ─────────────────────────────────────────────
// 스킨별 기본 속도 배율 / 통합 맵
// ─────────────────────────────────────────────
const DEFAULT_PLAYER_SPEED_MULTIPLIER = 1
const MANY_SPEED_MULTIPLIER = 1
const DOUBLE_SPEED_MULTIPLIER = 1
const EVOLUTION_SPEED_MULTIPLIER = 0.8
const PUMPKIN_SPEED_MULTIPLIER = 1.4
const PLAYER_SPEED_MULTIPLIERS = {
    [DEFAULT_SKIN_NAME]: DEFAULT_PLAYER_SPEED_MULTIPLIER,
    [MANY_SKIN_NAME]: MANY_SPEED_MULTIPLIER,
    [DOUBLE_SKIN_NAME]: DOUBLE_SPEED_MULTIPLIER,
    [EVOLUTION_SKIN_NAME]: EVOLUTION_SPEED_MULTIPLIER,
    [PUMPKIN_SKIN_NAME]: PUMPKIN_SPEED_MULTIPLIER,
}

// ─────────────────────────────────────────────
// 스킨별 체력 세그먼트 수
// ─────────────────────────────────────────────
const EVOLUTION_HEALTH_SEGMENTS = 5
const PUMPKIN_NPC_HEALTH_SEGMENTS = 4
const MANY_HEALTH_SEGMENTS = 5

// ─────────────────────────────────────────────
// 펌킨 NPC 타이머 / 패딩 / ID 접두사
// ─────────────────────────────────────────────
const PUMPKIN_NPC_DEFEAT_DASH_DURATION_MS = 420
const PUMPKIN_NPC_DASH_PROTECTION_MS = 260
const PUMPKIN_NPC_CLAIM_LOCK_MS = 500
const PUMPKIN_NPC_DAMAGE_INVULNERABLE_MS = 1000
const PUMPKIN_NPC_FADE_OUT_DURATION_MS = 520
const NEUTRAL_PUMPKIN_SPAWN_PADDING = 180
const PUMPKIN_NPC_ID_PREFIX = "pumpkin-"

// ─────────────────────────────────────────────
// Double 스킨 수치
// ─────────────────────────────────────────────
const DOUBLE_UNIT_HEALTH = 2
const DOUBLE_UNIT_COUNT = 2
const DOUBLE_SEPARATION_ANGLE_DEGREES = 7
const DOUBLE_SEPARATION_ANGLE_RADIANS = DOUBLE_SEPARATION_ANGLE_DEGREES * (Math.PI / 180)
// PLAYER_COLLISION_HALF_WIDTH 기반으로 병합 상태의 유닛 간 측면 오프셋을 계산한다.
const DOUBLE_MERGED_SIDE_OFFSET = PLAYER_COLLISION_HALF_WIDTH * 0.72
const DOUBLE_SPLIT_PROBABILITY = 0.3
const DOUBLE_REJOIN_EXTRA_DISTANCE = PLAYER_COLLISION_HALF_HEIGHT * 0.25
const DOUBLE_REMERGE_LOCK_MS = 3000
const DOUBLE_SPLIT_PROTECTION_MS = 1000
const SPLIT_DEFEAT_PROTECTION_MS = 300
const DOUBLE_IDLE_REMERGE_DELAY_MS = 1000
const DOUBLE_STEER_MIN_RADIANS = 5 * (Math.PI / 180)
const DOUBLE_STEER_MAX_RADIANS = 45 * (Math.PI / 180)
const DOUBLE_STEER_DEADZONE_RADIANS = 3 * (Math.PI / 180)
const DOUBLE_ALIGNMENT_DEADZONE_DISTANCE = DOUBLE_MERGED_SIDE_OFFSET * 0.35
const DOUBLE_INACTIVE_FADE_MS = 200

// ─────────────────────────────────────────────
// NPC ID / 더미 스펙
// ─────────────────────────────────────────────
const NPC_ID = "네르"
const DUMMY_SPECS = [
    { id: "dummy-1", quadrant: 1, displayName: "저는 네르에요" },
    { id: "dummy-2", quadrant: 2, displayName: "제가 네르에요" },
    { id: "dummy-3", quadrant: 3, displayName: "네르는 네르에요" },
    { id: "dummy-4", quadrant: 4, displayName: "세계수 교단의 제사장, 네르입니다" },
]

module.exports = {
    PLAYER_COLLISION_HALF_HEIGHT,
    PLAYER_COLLISION_HALF_WIDTH,
    PUMPKIN_PLAYER_COLLISION_SCALE,
    PUMPKIN_NPC_COLLISION_WIDTH_SCALE,
    PUMPKIN_NPC_COLLISION_HEIGHT_SCALE,
    NPC_COLLISION_SCALE,
    NPC_COLLISION_SIZE_MULTIPLIER,
    NPC_COLLISION_HALF_HEIGHT,
    NPC_COLLISION_HALF_WIDTH,
    COLLISION_BOUNCE_DISTANCE,
    COLLISION_SPEED_BOUNCE_MULTIPLIER,
    COLLISION_MAX_BOUNCE_DISTANCE,
    WALL_BOUNCE_DISTANCE,
    WALL_BOUNCE_SPEED_BOUNCE_MULTIPLIER,
    WALL_MAX_BOUNCE_DISTANCE,
    COLLISION_VISUAL_BASE_DURATION_MS,
    COLLISION_IMPACT_DURATION_MS,
    COLLISION_VISUAL_SPEED_DURATION_MULTIPLIER_MS,
    COLLISION_VISUAL_MAX_DURATION_MS,
    COLLISION_RECOVERY_DURATION_MS,
    COLLISION_BOOST_LOCK_DURATION_MS,
    COLLISION_ATTACK_DIRECTION_THRESHOLD,
    PLAYER_DEATH_TRIGGER_COUNT,
    PLAYER_DEATH_DURATION_MS,
    DUMMY_RESPAWN_DELAY_MS,
    RESPAWN_EDGE_PADDING,
    NPC_DEATH_ANIMATION_DURATION_MS,
    NPC_PHASE_THREE_TRIGGER_DISTANCE_MULTIPLIER,
    DUMMY_RETALIATION_DISTANCE_MULTIPLIER,
    NPC_DEFEAT_BOUNCE_MULTIPLIER,
    HOUSE_STAGE_ONE_ID,
    HOUSE_STAGE_TWO_ID,
    HOUSE_STAGE_THREE_ID,
    HOUSE_STAGE_ONE_HEALTH,
    HOUSE_STAGE_TWO_HEALTH,
    HOUSE_STAGE_THREE_HEALTH,
    HOUSE_COLLISION_SCALE,
    HOUSE_COLLISION_HALF_WIDTH,
    HOUSE_COLLISION_HALF_HEIGHT,
    HOUSE_COLLISION_POLYGON,
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
    INPUT_IDLE_RESET_MS,
    EVOLUTION_SKIN_NAME,
    DEFAULT_SKIN_NAME,
    MANY_SKIN_NAME,
    DOUBLE_SKIN_NAME,
    PUMPKIN_SKIN_NAME,
    DEFAULT_PLAYER_SPEED_MULTIPLIER,
    MANY_SPEED_MULTIPLIER,
    DOUBLE_SPEED_MULTIPLIER,
    EVOLUTION_SPEED_MULTIPLIER,
    PUMPKIN_SPEED_MULTIPLIER,
    PLAYER_SPEED_MULTIPLIERS,
    EVOLUTION_HEALTH_SEGMENTS,
    PUMPKIN_NPC_HEALTH_SEGMENTS,
    MANY_HEALTH_SEGMENTS,
    PUMPKIN_NPC_DEFEAT_DASH_DURATION_MS,
    PUMPKIN_NPC_DASH_PROTECTION_MS,
    PUMPKIN_NPC_CLAIM_LOCK_MS,
    PUMPKIN_NPC_DAMAGE_INVULNERABLE_MS,
    PUMPKIN_NPC_FADE_OUT_DURATION_MS,
    NEUTRAL_PUMPKIN_SPAWN_PADDING,
    PUMPKIN_NPC_ID_PREFIX,
    DOUBLE_UNIT_HEALTH,
    DOUBLE_UNIT_COUNT,
    DOUBLE_SEPARATION_ANGLE_DEGREES,
    DOUBLE_SEPARATION_ANGLE_RADIANS,
    DOUBLE_MERGED_SIDE_OFFSET,
    DOUBLE_SPLIT_PROBABILITY,
    DOUBLE_REJOIN_EXTRA_DISTANCE,
    DOUBLE_REMERGE_LOCK_MS,
    DOUBLE_SPLIT_PROTECTION_MS,
    SPLIT_DEFEAT_PROTECTION_MS,
    DOUBLE_IDLE_REMERGE_DELAY_MS,
    DOUBLE_STEER_MIN_RADIANS,
    DOUBLE_STEER_MAX_RADIANS,
    DOUBLE_STEER_DEADZONE_RADIANS,
    DOUBLE_ALIGNMENT_DEADZONE_DISTANCE,
    DOUBLE_INACTIVE_FADE_MS,
    NPC_ID,
    DUMMY_SPECS,
}
