const { PRESENCE_TTL_MS } = require("../config/config")

// ── Presence (lightweight, no WS needed) ─────────────────────────────────────
const presenceRooms = new Map()  // mapPath -> Map<userId, lastSeenMs>

function updatePresence(mapPath, userId) {
    if (!presenceRooms.has(mapPath)) presenceRooms.set(mapPath, new Map())
    presenceRooms.get(mapPath).set(userId, Date.now())
}

function getPresenceCount(mapPath) {
    const pr = presenceRooms.get(mapPath)
    if (!pr) return 0
    const cutoff = Date.now() - PRESENCE_TTL_MS
    for (const [uid, ts] of pr) {
        if (ts < cutoff) pr.delete(uid)
    }
    if (pr.size === 0) { presenceRooms.delete(mapPath); return 0 }
    return pr.size
}

// ── WS Rooms ──────────────────────────────────────────────────────────────────
const PALETTE = [
    "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
    "#42d4f4", "#f032e6", "#bfef45", "#469990", "#9A6324",
    "#e6beff", "#aaffc3",
]

const rooms = new Map()

function getOrCreateRoom(mapPath) {
    if (!rooms.has(mapPath)) {
        rooms.set(mapPath, { clients: new Map(), strokes: [], texts: [], lastActive: Date.now(), guestCounter: 0, strokeCounter: 0, textCounter: 0 })
    }
    return rooms.get(mapPath)
}

setInterval(function () {
    const now = Date.now()
    for (const [mapPath, room] of rooms) {
        if (room.clients.size === 0 && now - room.lastActive > 600000) {
            rooms.delete(mapPath)
        }
    }
}, 60000)

function joinRoom(mapPath, ws, { userId, displayName }) {
    const room = getOrCreateRoom(mapPath)
    const usedColors = new Set([...room.clients.values()].map(c => c.color))
    const color = PALETTE.find(c => !usedColors.has(c)) || PALETTE[room.clients.size % PALETTE.length]
    const isGuest = userId.startsWith("shared-")
    const guestNum = isGuest ? ++room.guestCounter : null
    room.clients.set(ws, { userId, displayName, color, guestNum, drawPoints: [] })
    const peers = []
    for (const c of room.clients.values()) {
        if (c.userId !== userId) peers.push({ id: c.userId, displayName: c.displayName, color: c.color, guestNum: c.guestNum })
    }
    return { color, guestNum, strokes: room.strokes, texts: room.texts, peers }
}

function getClientRef(mapPath, ws) {
    const room = rooms.get(mapPath)
    return room ? (room.clients.get(ws) || null) : null
}

function leaveRoom(ws) {
    for (const [mapPath, room] of rooms) {
        if (room.clients.has(ws)) {
            const client = room.clients.get(ws)
            room.clients.delete(ws)
            if (room.clients.size === 0) rooms.delete(mapPath)
            return { mapPath, client }
        }
    }
    return null
}

function broadcastToRoom(mapPath, senderWs, payload, { includeSelf = false } = {}) {
    const room = rooms.get(mapPath)
    if (!room) return
    room.lastActive = Date.now()
    const clients = []
    for (const client of room.clients.keys()) {
        if (!includeSelf && client === senderWs) continue
        if (client.readyState !== 1) continue
        if (client.bufferedAmount > 1024 * 1024) {
            client.close(4000, "slow_client")
            continue
        }
        clients.push(client)
    }
    for (let i = 0; i < clients.length; i++) {
        try { clients[i].send(payload) } catch (_) {}
    }
}

function addStroke(mapPath, stroke) {
    const room = rooms.get(mapPath)
    if (!room) return null
    const hasRequestedId = stroke.strokeId !== undefined && stroke.strokeId !== null && stroke.strokeId !== ""
    const strokeId = hasRequestedId ? stroke.strokeId : ++room.strokeCounter
    if (typeof strokeId === "number" && strokeId > room.strokeCounter) room.strokeCounter = strokeId
    const existingIdx = room.strokes.findIndex(s => s.strokeId === strokeId)
    if (existingIdx >= 0) room.strokes.splice(existingIdx, 1)
    room.strokes.push({ ...stroke, strokeId })
    if (room.strokes.length > 100) room.strokes.shift()
    return strokeId
}

function removeStroke(mapPath, strokeId) {
    const room = rooms.get(mapPath)
    if (!room) return false
    const idx = room.strokes.findIndex(s => s.strokeId === strokeId)
    if (idx === -1) return false
    room.strokes.splice(idx, 1)
    return true
}

function upsertText(mapPath, text) {
    const room = rooms.get(mapPath)
    if (!room) return null
    const textId = String(text.textId || `t${++room.textCounter}`)
    const normalized = {
        textId,
        userId: text.userId,
        color: text.color,
        x: Number(text.x) || 0,
        y: Number(text.y) || 0,
        w: Math.max(10, Number(text.w) || 540),
        h: Math.max(10, Number(text.h) || 210),
        text: String(text.text || "").slice(0, 2000),
    }
    const idx = room.texts.findIndex(t => t.textId === textId)
    if (idx >= 0) room.texts[idx] = { ...room.texts[idx], ...normalized }
    else {
        room.texts.push(normalized)
        if (room.texts.length > 100) room.texts.shift()
    }
    return normalized
}

function removeText(mapPath, textId) {
    const room = rooms.get(mapPath)
    if (!room) return false
    const idx = room.texts.findIndex(t => t.textId === textId)
    if (idx === -1) return false
    room.texts.splice(idx, 1)
    return true
}

function getClient(ws) {
    return ws._client || null
}

module.exports = { joinRoom, leaveRoom, broadcastToRoom, addStroke, removeStroke, upsertText, removeText, getClient, getClientRef, updatePresence, getPresenceCount }
