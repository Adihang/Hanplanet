require("dotenv").config()
const { PORT } = require("./config/config")
const createServer = require("./network/websocket")
const createAdminServer = require("./network/admin")

const wss = createServer()
const admin = createAdminServer()
console.log(`Map collab server started on port ${PORT}`)

function shutdown(signal) {
    console.log(`Shutting down (${signal})`)
    admin.close()
    wss.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 3000).unref()
}
process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
