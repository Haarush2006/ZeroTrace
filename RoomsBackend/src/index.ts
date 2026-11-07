import { loadConfig } from "./config"
import { createChatServer } from "./server"

const config = loadConfig()
const server = createChatServer(config)

server
  .listen(config.port)
  .then(({ port }) => {
    console.log(`[chat] listening on :${port} (ws path /ws)`)
    console.log(
      `[chat] rooms self-destruct after ${config.ttlMs / 1000}s of inactivity ` +
        `(empty grace ${Math.round(config.emptyGraceMs / 1000)}s)`,
    )
  })
  .catch((error) => {
    console.error("[chat] failed to start", error)
    process.exit(1)
  })

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true

  console.log(`[chat] ${signal} received, shutting down`)
  await server.close()
  process.exit(0)
}

process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))
