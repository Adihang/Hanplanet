const jwt = require("jsonwebtoken")
const { JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE } = require("../config/config")

function verifyToken(token) {
    if (!token) {
        return { valid: false, userId: null, payload: null }
    }

    if (!JWT_SECRET) {
        return { valid: true, userId: token, payload: null }
    }

    try {
        const payload = jwt.verify(token, JWT_SECRET, {
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
            algorithms: ["HS256"]
        })
        return { valid: true, userId: payload.userId || payload.sub || null, payload }
    } catch (error) {
        return { valid: false, userId: null, payload: null }
    }
}

module.exports = { verifyToken }
