const WebSocket = require("ws")
const { encode } = require("@msgpack/msgpack")
const { PORT, JWT_SECRET } = require("../config/config")
const { verifyToken } = require("../auth/jwt")
const { joinRoom, leaveRoom, broadcastToRoom, addStroke, getClient, getClientRef } = require("../rooms/roomManager")

const RATE_LIMIT = 30
const MAX_DRAW_POINTS = 2000

function allow(ws) {
    const now = Date.now()
    if (now - ws._rateLimitTs > 1000) { ws._rateLimitTs = now; ws._rateCount = 0 }
    ws._rateCount++
    return ws._rateCount < RATE_LIMIT
}

function createServer() {
    const wss = new WebSocket.Server({
        port: PORT,
        perMessageDeflate: { zlibDeflateOptions: { level: 1 }, threshold: 512 },
    })

    wss.on("connection", (ws, request) => {
        const url = new URL(request.url, "ws://localhost")
        const token = url.searchParams.get("token")
        const verified = verifyToken(token)

        if (JWT_SECRET && !verified.valid) {
            ws.close(4001, "invalid_token")
            return
        }

        const userId = verified.payload?.sub || Math.random().toString(36).slice(2)
        const displayName = verified.payload?.display_name || userId
        const rawGame = String(verified.payload?.game || "").trim()
        const mapPath = rawGame.startsWith("map:") ? rawGame.slice(4) : rawGame

        if (!mapPath) {
            ws.close(4002, "no_map_path")
            return
        }

        ws._rateLimitTs = Date.now()
        ws._rateCount = 0
        ws._lastCursor = { x: 0, y: 0 }
        ws.isAlive = true
        ws.on("pong", () => { ws.isAlive = true })

        const { color, guestNum, strokes, peers } = joinRoom(mapPath, ws, { userId, displayName })
        ws._mapPath = mapPath
        ws._userId = userId
        ws._client = getClientRef(mapPath, ws)

        ws.send(encode({ type: "welcome", id: userId, displayName, color, guestNum, strokes, peers }))
        broadcastToRoom(mapPath, ws, encode({ type: "peer_joined", id: userId, displayName, color, guestNum }))

        ws.on("message", (raw) => {
            if (!allow(ws)) return

            let msg
            try { msg = JSON.parse(raw.toString()) } catch (_) { return }

            const client = getClient(ws)
            if (!client) return

            switch (msg.type) {
                case "ping":
                    ws.send(encode({ type: "pong", sentAt: msg.sentAt || 0 }))
                    break

                case "cursor": {
                    const dx = Math.abs(msg.x - ws._lastCursor.x)
                    const dy = Math.abs(msg.y - ws._lastCursor.y)
                    if (dx + dy < 2) break
                    ws._lastCursor = { x: msg.x, y: msg.y }
                    broadcastToRoom(mapPath, ws, encode({ type: "peer_cursor", id: userId, color: client.color, x: msg.x, y: msg.y }))
                    break
                }

                case "draw_point": {
                    if (client.drawPoints.length >= MAX_DRAW_POINTS) break
                    const last = client.drawPoints[client.drawPoints.length - 1]
                    if (last) {
                        const ddx = msg.x - last.x, ddy = msg.y - last.y
                        if (ddx * ddx + ddy * ddy < 4) break
                    }
                    client.drawPoints.push({ x: msg.x, y: msg.y })
                    broadcastToRoom(mapPath, ws, encode({ type: "peer_draw_point", id: userId, color: client.color, x: msg.x, y: msg.y }))
                    break
                }

                case "draw_end": {
                    let pts = Array.isArray(msg.points) && msg.points.length >= 2
                        ? msg.points.slice()
                        : client.drawPoints.slice()
                    client.drawPoints = []
                    if (pts.length > 2000) pts = pts.filter((_, i) => i % 2 === 0)
                    if (pts.length >= 2) {
                        addStroke(mapPath, { userId, color: client.color, points: pts })
                        broadcastToRoom(mapPath, ws, encode({ type: "peer_draw_end", id: userId, color: client.color, points: pts }), { includeSelf: true })
                    }
                    break
                }

                case "draw_cancel":
                    client.drawPoints = []
                    broadcastToRoom(mapPath, ws, encode({ type: "peer_draw_cancel", id: userId }))
                    break
            }
        })

        ws.on("close", () => {
            const info = leaveRoom(ws)
            if (info) {
                broadcastToRoom(info.mapPath, ws, encode({ type: "peer_left", id: info.client.userId }), { includeSelf: true })
            }
        })
    })

    setInterval(() => {
        wss.clients.forEach(ws => {
            if (ws.isAlive === false) return ws.terminate()
            ws.isAlive = false
            ws.ping()
        })
    }, 30000)

    return wss
}

module.exports = createServer
