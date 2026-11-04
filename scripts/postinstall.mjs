import { existsSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

/**
 * Builds the shared protocol after install so backend and frontend can import
 * it immediately. Skips cleanly when this is a manifest-only install (for
 * example the dependency stage of a Docker build, where only package.json files
 * have been copied so far).
 */
const root = path.resolve(import.meta.dirname, "..")
const protocolDir = path.join(root, "packages", "protocol")
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc")

if (!existsSync(path.join(protocolDir, "tsconfig.json")) || !existsSync(tsc)) {
  console.log("[postinstall] skipping @chat/protocol build (source or TypeScript not present)")
  process.exit(0)
}

const result = spawnSync(process.execPath, [tsc, "-p", "tsconfig.json"], {
  cwd: protocolDir,
  stdio: "inherit",
})

process.exit(result.status ?? 1)
