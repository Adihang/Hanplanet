// 런타임 전체에서 공통으로 쓰는 최소 환경설정 모음.
// 값이 없으면 로컬 개발에 바로 쓸 수 있는 기본값으로 동작한다.
module.exports = {
    PORT: Number(process.env.PORT || 8080),
    ADMIN_HOST: process.env.ADMIN_HOST || "127.0.0.1",
    ADMIN_PORT: Number(process.env.ADMIN_PORT || 8082),
    WORLD_SIZE: Number(process.env.WORLD_SIZE || 2000),
    CELL_SIZE: Number(process.env.CELL_SIZE || 200),
    TICK_RATE: Number(process.env.TICK_RATE || 30),
    DJANGO_INTERNAL_BASE_URL: process.env.DJANGO_INTERNAL_BASE_URL || "http://127.0.0.1:8000",
    BUMPERCAR_SPIKY_INTERNAL_SECRET: process.env.BUMPERCAR_SPIKY_INTERNAL_SECRET || "",
    // JWT_SECRET 이 비어 있으면 토큰 검증을 우회하고 단순 문자열 ID도 허용한다.
    // 로컬 디버깅 편의를 위한 fallback 이고, 운영에서는 항상 값이 있어야 한다.
    JWT_SECRET: process.env.JWT_SECRET || "",
    JWT_ISSUER: process.env.JWT_ISSUER || "https://hanplanet.com",
    JWT_AUDIENCE: process.env.JWT_AUDIENCE || "hanplanet-game"
}
