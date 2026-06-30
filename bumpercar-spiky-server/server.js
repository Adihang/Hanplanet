require("dotenv").config()

const http = require("http")
const World = require("./world/world")
const RaiseSpeakiWorld = require("./world/raiseSpeakiWorld")
const createServer = require("./network/websocket")
const startGameLoop = require("./game/gameLoop")
const startRaiseSpeakiLoop = require("./game/raiseSpeakiLoop")
const { PORT, ADMIN_HOST, ADMIN_PORT, TICK_RATE, WORLD_SIZE, CELL_SIZE } = require("./config/config")

// 각 게임은 독립 월드를 유지하고, 단일 WebSocket 서버에서 game slug 기준으로 분기한다.
const worlds = {
    "bumpercar-spiky": new World(),
    "raise-speaki": new RaiseSpeakiWorld(),
}
const bumpercarWorld = worlds["bumpercar-spiky"]
const wss = createServer(worlds)
const adminServer = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`)

    if (request.method === "GET" && requestUrl.pathname === "/admin/status") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({
            ok: true,
            connectedPlayers: bumpercarWorld.getHumanPlayerCount()
        }))
        return
    }

    if (request.method === "POST" && requestUrl.pathname === "/admin/npc-health") {
        let body = ""
        request.on("data", (chunk) => {
            body += chunk.toString()
        })
        request.on("end", () => {
            try {
                const payload = body ? JSON.parse(body) : {}
                const npc = bumpercarWorld.setNpcHealth(payload.npcHealth)
                if (!npc) {
                    response.writeHead(404, { "content-type": "application/json" })
                    response.end(JSON.stringify({ ok: false, error: "npc_not_found" }))
                    return
                }
                response.writeHead(200, { "content-type": "application/json" })
                response.end(JSON.stringify({
                    ok: true,
                    count: npc.count,
                    ners: npc.ners,
                }))
            } catch (error) {
                response.writeHead(400, { "content-type": "application/json" })
                response.end(JSON.stringify({ ok: false, error: "invalid_payload" }))
            }
        })
        return
    }

    if (request.method === "POST" && requestUrl.pathname === "/admin/restart") {
        response.writeHead(202, { "content-type": "application/json" })
        response.end(JSON.stringify({ ok: true, restarting: true }))
        setTimeout(() => {
            shutdown("admin-restart")
        }, 50).unref()
        return
    }

    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ ok: false, error: "not_found" }))
})
adminServer.listen(ADMIN_PORT, ADMIN_HOST)

// 게임별 루프는 같은 WebSocket 서버를 공유하되, 클라이언트는 slug 기준으로 분기한다.
startGameLoop(
    bumpercarWorld,
    wss,
    (client) => client.gameSlug === "bumpercar-spiky"
)
startRaiseSpeakiLoop(
    worlds["raise-speaki"],
    wss,
    (client) => client.gameSlug === "raise-speaki"
)

console.log(`Bumper Car Spiky server started on port ${PORT}`)
console.log(`admin_host=${ADMIN_HOST} admin_port=${ADMIN_PORT}`)
console.log(`tick_rate=${TICK_RATE} world_size=${WORLD_SIZE} cell_size=${CELL_SIZE}`)

function shutdown(signal) {
    console.log(`Shutting down game server (${signal})`)

    // 새 연결을 닫고, 기존 소켓 정리 후 프로세스를 종료한다.
    wss.close(() => {
        adminServer.close(() => {
            process.exit(0)
        })
    })

    // close 콜백이 오지 않아도 영원히 hang 되지 않게 강제 종료 타이머를 둔다.
    setTimeout(() => {
        process.exit(1)
    }, 3000).unref()
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
