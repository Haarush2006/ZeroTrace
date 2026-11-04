export interface AppConfig {
  port: number
  /** Idle time after the last activity before a room is destroyed. */
  ttlMs: number
  /** Once the last member leaves, the room expires no later than this. */
  emptyGraceMs: number
  maxRooms: number
  maxMessagesPerRoom: number
  maxUsersPerRoom: number
  maxPayloadBytes: number
  heartbeatMs: number
  sweepMs: number
  /** Origins allowed to open a WebSocket. Empty means "reject all". */
  allowedOrigins: string[]
}

const DEFAULT_ALLOWED_ORIGINS = "http://localhost:3000"

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback

  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function originList(value: string | undefined): string[] {
  return (value ?? DEFAULT_ALLOWED_ORIGINS)
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: positiveInt(env.PORT, 8080),
    ttlMs: positiveInt(env.ROOM_TTL_MS, 30 * 60 * 1000),
    emptyGraceMs: positiveInt(env.ROOM_EMPTY_GRACE_MS, 2 * 60 * 1000),
    maxRooms: positiveInt(env.MAX_ROOMS, 5000),
    maxMessagesPerRoom: positiveInt(env.MAX_MESSAGES_PER_ROOM, 500),
    maxUsersPerRoom: positiveInt(env.MAX_USERS_PER_ROOM, 50),
    maxPayloadBytes: positiveInt(env.MAX_PAYLOAD_BYTES, 16 * 1024),
    heartbeatMs: positiveInt(env.HEARTBEAT_MS, 30_000),
    sweepMs: positiveInt(env.SWEEP_MS, 15_000),
    allowedOrigins: originList(env.ALLOWED_ORIGINS),
  }
}
