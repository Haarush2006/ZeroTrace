import { WebSocket } from "ws"
import { describe, expect, it } from "vitest"
import { loadConfig, type AppConfig } from "../src/config"
import { RoomStore } from "../src/rooms"
import { createChatServer, silentLogger, type ChatServer, type ChatLogger } from "../src/server"

type WireMessage = { type: string } & Record<string, unknown>

interface TestContext {
  server: ChatServer
  store: RoomStore
  port: number
  advance: (ms: number) => void
  clients: TestClient[]
  connect: (origin?: string, headers?: Record<string, string>) => Promise<TestClient>
  close: () => Promise<void>
}

class TestClient {
  readonly ws: WebSocket
  private readonly queue: WireMessage[] = []
  private readonly waiters: Array<{
    predicate: (message: WireMessage) => boolean
    resolve: (message: WireMessage) => void
    timer: ReturnType<typeof setTimeout>
  }> = []
  private closeCode: number | null = null
  private closeWaiters: Array<{ resolve: (code: number) => void; timer: ReturnType<typeof setTimeout> }> =
    []

  constructor(port: number, origin = "http://localhost:3000", headers?: Record<string, string>) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin, headers })

    this.ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as WireMessage
      const index = this.waiters.findIndex((waiter) => waiter.predicate(message))
      if (index === -1) {
        this.queue.push(message)
        return
      }

      const [waiter] = this.waiters.splice(index, 1)
      clearTimeout(waiter.timer)
      waiter.resolve(message)
    })

    this.ws.on("close", (code) => {
      this.closeCode = code
      for (const waiter of this.closeWaiters) {
        clearTimeout(waiter.timer)
        waiter.resolve(code)
      }
      this.closeWaiters = []
    })
  }

  static connect(port: number, origin?: string, headers?: Record<string, string>): Promise<TestClient> {
    const client = new TestClient(port, origin, headers)

    return new Promise<TestClient>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out connecting")), 2_000)

      client.ws.once("open", () => {
        clearTimeout(timer)
        resolve(client)
      })

      client.ws.once("error", (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message))
  }

  waitFor(
    predicate: (message: WireMessage) => boolean,
    description: string,
    timeoutMs = 2_000,
  ): Promise<WireMessage> {
    const queued = this.queue.findIndex(predicate)
    if (queued !== -1) {
      const [message] = this.queue.splice(queued, 1)
      return Promise.resolve(message!)
    }

    return new Promise<WireMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.timer === timer)
        if (index !== -1) this.waiters.splice(index, 1)
        reject(new Error(`timed out waiting for ${description}`))
      }, timeoutMs)

      this.waiters.push({ predicate, resolve, timer })
    })
  }

  waitForType(type: string, timeoutMs = 2_000): Promise<WireMessage> {
    return this.waitFor((message) => message.type === type, type, timeoutMs)
  }

  waitForClose(timeoutMs = 2_000): Promise<number> {
    if (this.closeCode !== null) return Promise.resolve(this.closeCode)

    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for close")), timeoutMs)
      this.closeWaiters.push({ resolve, timer })
    })
  }

  terminate(): void {
    this.ws.terminate()
  }
}

async function start(options: { ttlMs?: number; emptyGraceMs?: number; maxUsersPerRoom?: number; heartbeatMs?: number; trustProxy?: boolean; logger?: ChatLogger } = {}): Promise<TestContext> {
  let now = 1_000_000

  const store = new RoomStore({
    ttlMs: options.ttlMs ?? 60_000,
    emptyGraceMs: options.emptyGraceMs ?? 5_000,
    maxRooms: 100,
    maxMessagesPerRoom: 100,
    maxUsersPerRoom: options.maxUsersPerRoom ?? 10,
    now: () => now,
  })

  const config: AppConfig = {
    ...loadConfig({}),
    trustProxy: options.trustProxy ?? false,
    sweepMs: 100_000,
    heartbeatMs: options.heartbeatMs ?? 100_000,
  }

  const server = createChatServer(config, { store, logger: options.logger ?? silentLogger })
  const { port } = await server.listen(0, "127.0.0.1")
  const clients: TestClient[] = []

  return {
    server,
    store,
    port,
    advance: (ms) => {
      now += ms
    },
    clients,
    connect: async (origin?: string, headers?: Record<string, string>) => {
      const client = await TestClient.connect(port, origin, headers)
      clients.push(client)
      return client
    },
    close: async () => {
      for (const client of clients) client.terminate()
      await server.close()
    },
  }
}

async function createRoom(client: TestClient, username = "Alice"): Promise<WireMessage> {
  client.send({ type: "create", username })
  const ready = await client.waitForType("ready")
  await client.waitForType("presence")
  return ready
}

async function joinRoom(
  client: TestClient,
  roomId: unknown,
  username: string,
): Promise<WireMessage> {
  client.send({ type: "join", roomId, username })
  const ready = await client.waitForType("ready")
  await client.waitForType("presence")
  return ready
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe("HTTP surface", () => {
  it.each([
    { trustProxy: true, valid: true, separate: true },
    { trustProxy: false, valid: true, separate: false },
    { trustProxy: true, valid: false, separate: false },
  ])("isolates create buckets only for trusted valid proxy IPs: %j", async ({ trustProxy, valid, separate }) => {
    const ctx = await start({ trustProxy })
    const ip = (n: number) => valid ? `192.0.2.${n}` : `invalid-${n}, 192.0.2.1`
    try {
      for (let index = 0; index < 20; index++) {
        const client = await ctx.connect(undefined, { "x-real-ip": ip(1) })
        await createRoom(client)
      }
      const limited = await ctx.connect(undefined, { "x-real-ip": ip(1) })
      limited.send({ type: "create", username: "Limited" })
      expect((await limited.waitForType("error")).code).toBe("rate_limited")
      const other = await ctx.connect(undefined, { "x-real-ip": ip(2) })
      other.send({ type: "create", username: "Other" })
      if (separate) await other.waitForType("ready")
      else expect((await other.waitForType("error")).code).toBe("rate_limited")
    } finally {
      await ctx.close()
    }
  })

  it("serves a health check", async () => {
    const ctx = await start()

    try {
      const response = await fetch(`http://127.0.0.1:${ctx.port}/health`)
      const body = (await response.json()) as { ok: boolean; rooms: number }

      expect(response.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.rooms).toBe(0)
    } finally {
      await ctx.close()
    }
  })

  it("rejects an upgrade from a disallowed origin", async () => {
    const ctx = await start()

    try {
      await expect(TestClient.connect(ctx.port, "https://evil.example")).rejects.toThrow()
    } finally {
      await ctx.close()
    }
  })

  it("rejects an upgrade on the wrong path", async () => {
    const ctx = await start()

    try {
      await expect(
        new Promise<void>((resolve, reject) => {
          const socket = new WebSocket(`ws://127.0.0.1:${ctx.port}/socket`, {
            origin: "http://localhost:3000",
          })
          socket.once("open", () => {
            socket.terminate()
            resolve()
          })
          socket.once("error", reject)
        }),
      ).rejects.toThrow()
    } finally {
      await ctx.close()
    }
  })
})

describe("room lifecycle over the wire", () => {
  it("drops a client above the buffered-byte limit and cleans up membership", async () => {
    const ctx = await start()
    try {
      const alice = await ctx.connect()
      const { roomId } = await createRoom(alice)
      const socket = [...ctx.server.wss.clients][0]!
      // Simulate a saturated transport; do not depend on OS buffer sizes.
      Object.defineProperty(socket, "bufferedAmount", { get: () => 1_000_001 })
      alice.send({ type: "chat", message: "trigger backpressure check" })
      expect(await alice.waitForClose()).toBe(1006)
      await waitUntil(() => {
        const room = ctx.store.snapshot(String(roomId))
        return room.ok && room.value.users.length === 0
      })
    } finally {
      await ctx.close()
    }
  })

  it("logs expiry without logging message content or room capabilities", async () => {
    const logs: string[] = []
    const ctx = await start({ logger: {
      info: (message) => logs.push(message),
      error: (message, error) => logs.push(`${message} ${String(error)}`),
    } })
    try {
      const alice = await ctx.connect()
      const { roomId } = await createRoom(alice)
      alice.send({ type: "chat", message: "private-content-marker" })
      await alice.waitForType("chat")
      ctx.advance(60_001)
      ctx.server.sweepNow()
      await alice.waitForType("expired")
      expect(logs.join("\n")).toContain("expired 1 room(s)")
      expect(logs.join("\n")).not.toContain("private-content-marker")
      expect(logs.join("\n")).not.toContain(String(roomId))
    } finally {
      await ctx.close()
    }
  })

  it("updates existing clients with the authoritative expiry after a join", async () => {
    const ctx = await start()
    try {
      const alice = await ctx.connect()
      const ready = await createRoom(alice)
      ctx.advance(10_000)
      const bob = await ctx.connect()
      const joined = await joinRoom(bob, ready.roomId, "Bob")
      const presence = await alice.waitForType("presence")
      expect(presence.expiresAt).toBe(joined.expiresAt)
      expect(presence.expiresAt).toBe(Number(ready.expiresAt) + 10_000)
    } finally {
      await ctx.close()
    }
  })

  it("admits only one concurrent join into the last slot", async () => {
    const ctx = await start({ maxUsersPerRoom: 2 })
    try {
      const alice = await ctx.connect()
      const { roomId } = await createRoom(alice)
      const bob = await ctx.connect()
      const charlie = await ctx.connect()
      bob.send({ type: "join", roomId, username: "Bob" })
      charlie.send({ type: "join", roomId, username: "Charlie" })
      const replies = await Promise.all([bob, charlie].map((client) =>
        client.waitFor((message) => message.type === "ready" || message.type === "error", "join result")))
      expect(replies.filter((message) => message.type === "ready")).toHaveLength(1)
      expect(replies.find((message) => message.type === "error")?.code).toBe("room_full")
    } finally {
      await ctx.close()
    }
  })

  it("disconnects an unresponsive client through heartbeat cleanup", async () => {
    const ctx = await start({ heartbeatMs: 50 })
    const socket = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`, {
      origin: "http://localhost:3000", autoPong: false,
    })
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve)
        socket.once("error", reject)
      })
      const closed = new Promise<number>((resolve) => socket.once("close", resolve))
      socket.send(JSON.stringify({ type: "create", username: "Silent" }))
      expect(await closed).toBe(1006)
      await waitUntil(() => ctx.server.wss.clients.size === 0)
      ctx.advance(5001)
      ctx.server.sweepNow()
      expect(ctx.store.size).toBe(0)
    } finally {
      socket.terminate()
      await ctx.close()
    }
  })

  it("expires existing members when a late join discovers an unswept expiry", async () => {
    const ctx = await start({ ttlMs: 1000 })
    try {
      const alice = await ctx.connect()
      const { roomId } = await createRoom(alice)
      ctx.advance(1001)
      const bob = await ctx.connect()
      bob.send({ type: "join", roomId, username: "Bob" })
      expect((await bob.waitForType("error")).code).toBe("room_not_found")
      ctx.server.sweepNow()
      await alice.waitForType("expired")
      expect(await alice.waitForClose()).toBe(4001)
    } finally {
      await ctx.close()
    }
  })

  it("expires remaining members when a departure discovers an unswept expiry", async () => {
    const ctx = await start({ ttlMs: 1000 })
    try {
      const alice = await ctx.connect()
      const { roomId } = await createRoom(alice)
      const bob = await ctx.connect()
      await joinRoom(bob, roomId, "Bob")
      ctx.advance(1001)
      bob.ws.close()
      await bob.waitForClose()
      await waitUntil(() => ctx.store.size === 0)
      ctx.server.sweepNow()
      await alice.waitForType("expired")
    } finally {
      await ctx.close()
    }
  })

  it("creates a room and sends history, expiry and presence", async () => {
    const ctx = await start()

    try {
      const alice = await ctx.connect()
      const ready = await createRoom(alice)

      expect(ready.roomId).toMatch(/^[A-Za-z0-9_-]{22}$/)
      expect(ready.users).toEqual(["Alice"])
      expect(ready.history).toEqual([])
      expect(ready.ttlMs).toBe(60_000)
      expect(typeof ready.expiresAt).toBe("number")
    } finally {
      await ctx.close()
    }
  })

  it("lets a second client join and tells everyone", async () => {
    const ctx = await start()

    try {
      const alice = await ctx.connect()
      const room = await createRoom(alice)

      const bob = await ctx.connect()
      const bobReady = await joinRoom(bob, room.roomId, "Bob")

      expect(bobReady.users).toEqual(["Alice", "Bob"])

      const alicePresence = await alice.waitForType("presence")
      expect(alicePresence.users).toEqual(["Alice", "Bob"])

      const system = await alice.waitForType("system")
      expect(system.message).toBe("Bob joined the room")
    } finally {
      await ctx.close()
    }
  })

  it("broadcasts chat with the server-assigned sender", async () => {
    const ctx = await start()

    try {
      const alice = await ctx.connect()
      const room = await createRoom(alice)
      const bob = await ctx.connect()
      await joinRoom(bob, room.roomId, "Bob")

      alice.send({ type: "chat", message: "hello" })

      const forAlice = await alice.waitForType("chat")
      const forBob = await bob.waitForType("chat")

      expect(forAlice.sender).toBe("Alice")
      expect(forAlice.message).toBe("hello")
      expect(forBob.sender).toBe("Alice")
      expect(forAlice.id).toBe(forBob.id)
      expect(typeof forAlice.timestamp).toBe("number")
    } finally {
      await ctx.close()
    }
  })

  it("keeps system notices out of history", async () => {
    const ctx = await start()

    try {
      const alice = await ctx.connect()
      const room = await createRoom(alice)
      const bob = await ctx.connect()
      await joinRoom(bob, room.roomId, "Bob")

      alice.send({ type: "chat", message: "hello" })
      await alice.waitForType("chat")

      const carol = await ctx.connect()
      const carolReady = await joinRoom(carol, room.roomId, "Carol")

      expect(carolReady.history).toHaveLength(1)
      expect(carolReady.history).toMatchObject([{ type: "chat", sender: "Alice", message: "hello" }])
    } finally {
      await ctx.close()
    }
  })

  it("announces departures and updates presence", async () => {
    const ctx = await start()

    try {
      const alice = await ctx.connect()
      const room = await createRoom(alice)
      const bob = await ctx.connect()
      await joinRoom(bob, room.roomId, "Bob")

      await alice.waitForType("presence")
      await alice.waitForType("system")

      bob.terminate()

      const system = await alice.waitForType("system")
      expect(system.message).toBe("Bob left the room")

      const presence = await alice.waitForType("presence")
      expect(presence.users).toEqual(["Alice"])
    } finally {
      await ctx.close()
    }
  })

  it("expires a room and closes its sockets with 4001", async () => {
    const ctx = await start({ ttlMs: 1_000 })

    try {
      const alice = await ctx.connect()
      await createRoom(alice)

      ctx.advance(1_001)
      ctx.server.sweepNow()

      const expired = await alice.waitForType("expired")
      expect(expired.type).toBe("expired")
      expect(await alice.waitForClose()).toBe(4001)
      expect(ctx.store.size).toBe(0)
    } finally {
      await ctx.close()
    }
  })

  it("deletes an empty room after the grace window", async () => {
    const ctx = await start({ emptyGraceMs: 500 })

    try {
      const alice = await ctx.connect()
      const room = await createRoom(alice)

      alice.terminate()
      await waitUntil(() => {
        const snapshot = ctx.store.snapshot(room.roomId as string)
        return snapshot.ok && snapshot.value.users.length === 0
      })

      ctx.advance(501)
      ctx.server.sweepNow()

      expect(ctx.store.size).toBe(0)
    } finally {
      await ctx.close()
    }
  })
})

describe("protocol abuse", () => {
  it("rejects unknown rooms", async () => {
    const ctx = await start()

    try {
      const bob = await ctx.connect()
      bob.send({ type: "join", roomId: "aaaaaaaaaaaaaaaaaaaaaa", username: "Bob" })

      const error = await bob.waitForType("error")
      expect(error.code).toBe("room_not_found")
    } finally {
      await ctx.close()
    }
  })

  it("rejects chat before joining", async () => {
    const ctx = await start()

    try {
      const alice = await ctx.connect()
      alice.send({ type: "chat", message: "hello" })

      const error = await alice.waitForType("error")
      expect(error.code).toBe("not_a_member")
    } finally {
      await ctx.close()
    }
  })

  it("rejects a second create on the same connection", async () => {
    const ctx = await start()

    try {
      const alice = await ctx.connect()
      await createRoom(alice)

      alice.send({ type: "create", username: "Alice2" })

      const error = await alice.waitForType("error")
      expect(error.code).toBe("already_joined")
    } finally {
      await ctx.close()
    }
  })

  it("rejects spoofed senders and malformed frames", async () => {
    const ctx = await start()

    try {
      const alice = await ctx.connect()
      await createRoom(alice)

      alice.send({ type: "chat", message: "hi", sender: "Admin" })
      expect((await alice.waitForType("error")).code).toBe("invalid_payload")

      alice.ws.send("{not json")
      expect((await alice.waitForType("error")).code).toBe("invalid_payload")
    } finally {
      await ctx.close()
    }
  })

  it("rate limits a flooding client", async () => {
    const ctx = await start()

    try {
      const alice = await ctx.connect()
      await createRoom(alice)

      for (let index = 0; index < 23; index++) {
        alice.send({ type: "chat", message: `flood ${index}` })
      }

      const error = await alice.waitForType("error")
      expect(error.code).toBe("rate_limited")
    } finally {
      await ctx.close()
    }
  })

  it("drops frames larger than maxPayload", async () => {
    const ctx = await start()

    try {
      const alice = await ctx.connect()
      await createRoom(alice)

      alice.send({ type: "chat", message: "a".repeat(20_000) })

      expect(await alice.waitForClose()).toBe(1009)
    } finally {
      await ctx.close()
    }
  })
})
