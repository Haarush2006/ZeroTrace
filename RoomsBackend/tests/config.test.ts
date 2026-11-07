import { describe, expect, it } from "vitest"
import { loadConfig } from "../src/config"

describe("loadConfig", () => {
  it("uses safe defaults", () => {
    const config = loadConfig({})

    expect(config.port).toBe(8080)
    expect(config.trustProxy).toBe(false)
    expect(config.ttlMs).toBe(30 * 60 * 1000)
    expect(config.emptyGraceMs).toBe(2 * 60 * 1000)
    expect(config.maxRooms).toBe(5000)
    expect(config.maxMessagesPerRoom).toBe(500)
    expect(config.maxUsersPerRoom).toBe(50)
    expect(config.maxPayloadBytes).toBe(16 * 1024)
    expect(config.heartbeatMs).toBe(30_000)
    expect(config.sweepMs).toBe(15_000)
    expect(config.allowedOrigins).toEqual(["http://localhost:3000"])
  })

  it("reads overrides from the environment", () => {
    const config = loadConfig({
      PORT: "9000",
      TRUST_PROXY: "1",
      ROOM_TTL_MS: "60000",
      MAX_ROOMS: "10",
      ALLOWED_ORIGINS: "https://chat.example.com, https://staging.example.com ",
    })

    expect(config.port).toBe(9000)
    expect(config.trustProxy).toBe(true)
    expect(config.ttlMs).toBe(60_000)
    expect(config.maxRooms).toBe(10)
    expect(config.allowedOrigins).toEqual([
      "https://chat.example.com",
      "https://staging.example.com",
    ])
  })

  it("falls back to defaults for invalid values", () => {
    const config = loadConfig({
      PORT: "not-a-port",
      ROOM_TTL_MS: "-5",
      MAX_ROOMS: "0",
    })

    expect(config.port).toBe(8080)
    expect(config.ttlMs).toBe(30 * 60 * 1000)
    expect(config.maxRooms).toBe(5000)
  })

  it("treats an empty origin list as no allowed origins", () => {
    const config = loadConfig({ ALLOWED_ORIGINS: " , " })

    expect(config.allowedOrigins).toEqual([])
  })
})
