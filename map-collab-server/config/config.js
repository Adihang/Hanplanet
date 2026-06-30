require("dotenv").config()
module.exports = {
    PORT:                 Number(process.env.PORT || 8083),
    ADMIN_HOST:           process.env.ADMIN_HOST || "127.0.0.1",
    ADMIN_PORT:           Number(process.env.ADMIN_PORT || 8084),
    JWT_SECRET:           process.env.JWT_SECRET  || "",
    JWT_ISSUER:           process.env.JWT_ISSUER  || "https://hanplanet.com",
    JWT_AUDIENCE:         process.env.JWT_AUDIENCE || "hanplanet-game",
    MAX_STROKES_PER_ROOM: 100,
    PRESENCE_TTL_MS:      30000,
}
