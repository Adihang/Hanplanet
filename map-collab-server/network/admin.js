const http = require("http")
const { ADMIN_PORT } = require("../config/config")
const { updatePresence, getPresenceCount } = require("../rooms/roomManager")

function createAdminServer() {
    const server = http.createServer((req, res) => {
        res.setHeader("Content-Type", "application/json")

        if (req.method === "POST" && req.url === "/presence") {
            let body = ""
            req.on("data", chunk => { body += chunk })
            req.on("end", () => {
                try {
                    const { map_path, user_id } = JSON.parse(body)
                    if (map_path && user_id) updatePresence(map_path, user_id)
                    res.end(JSON.stringify({ count: map_path ? getPresenceCount(map_path) : 0 }))
                } catch (_) {
                    res.statusCode = 400
                    res.end(JSON.stringify({ error: "bad_request" }))
                }
            })
            return
        }

        res.statusCode = 404
        res.end(JSON.stringify({ error: "not_found" }))
    })

    server.listen(ADMIN_PORT, "127.0.0.1", () => {
        console.log(`Map collab admin on port ${ADMIN_PORT}`)
    })

    return server
}

module.exports = createAdminServer
