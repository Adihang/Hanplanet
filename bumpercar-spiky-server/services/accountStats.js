const http = require("http")
const https = require("https")
const { BUMPERCAR_SPIKY_INTERNAL_SECRET, DJANGO_INTERNAL_BASE_URL } = require("../config/config")

const STATS_ENDPOINT_PATH = "/api/internal/bumpercar-spiky/stats/"

function postStatsUpdate(username, increments, maxima = null) {
    const safeUsername = String(username || "").trim()
    if (!safeUsername || !increments || typeof increments !== "object") {
        return
    }

    const normalizedIncrements = Object.fromEntries(
        Object.entries(increments)
            .map(([key, value]) => [String(key || "").trim(), Number(value || 0)])
            .filter(([key, value]) => key && value !== 0)
    )
    if (!Object.keys(normalizedIncrements).length) {
        if (!maxima || typeof maxima !== "object") {
            return
        }
    }
    const normalizedMaxima = Object.fromEntries(
        Object.entries(maxima || {})
            .map(([key, value]) => [String(key || "").trim(), Number(value || 0)])
            .filter(([key, value]) => key && value > 0)
    )
    if (!Object.keys(normalizedIncrements).length && !Object.keys(normalizedMaxima).length) {
        return
    }

    const baseUrl = new URL(DJANGO_INTERNAL_BASE_URL)
    const transport = baseUrl.protocol === "https:" ? https : http
    const requestBody = JSON.stringify({
        username: safeUsername,
        increments: normalizedIncrements,
        maxima: normalizedMaxima,
    })
    const headers = {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(requestBody),
    }
    if (BUMPERCAR_SPIKY_INTERNAL_SECRET) {
        headers["x-internal-secret"] = BUMPERCAR_SPIKY_INTERNAL_SECRET
    }

    const request = transport.request({
        protocol: baseUrl.protocol,
        hostname: baseUrl.hostname,
        port: baseUrl.port || (baseUrl.protocol === "https:" ? 443 : 80),
        method: "POST",
        path: STATS_ENDPOINT_PATH,
        headers,
        timeout: 2000,
    })

    request.on("error", () => {})
    request.on("timeout", () => {
        request.destroy()
    })
    request.write(requestBody)
    request.end()
}

module.exports = {
    postStatsUpdate,
}
