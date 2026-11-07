import { cpSync, existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const frontend = path.resolve(import.meta.dirname, "../roomfrontend")
const standalone = path.join(frontend, ".next/standalone/roomfrontend")
const server = path.join(standalone, "server.js")

if (!existsSync(server)) {
  console.error("Build the frontend first: npm run build:frontend")
  process.exit(1)
}

// Match the Docker runtime layout: Next does not copy these assets itself.
cpSync(path.join(frontend, "public"), path.join(standalone, "public"), { recursive: true })
cpSync(path.join(frontend, ".next/static"), path.join(standalone, ".next/static"), { recursive: true })
process.env.HOSTNAME ??= "0.0.0.0"
await import(pathToFileURL(server).href)
