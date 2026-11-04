import { describe, expect, it } from "vitest"
import { RoomStore, type RoomStoreOptions } from "../src/rooms"

const TTL = 60_000
const GRACE = 5_000

function makeStore(overrides: Partial<RoomStoreOptions> = {}) {
  let now = 1_000
  let counter = 0

  const store = new RoomStore({
    ttlMs: TTL,
    emptyGraceMs: GRACE,
    maxRooms: 2,
    maxMessagesPerRoom: 3,
    maxUsersPerRoom: 2,
    now: () => now,
    generateRoomId: () => `room${String(++counter).padStart(16, "0")}`,
    generateMessageId: () => `msg-${++counter}`,
    ...overrides,
  })

  return {
    store,
    advance: (ms: number) => {
      now += ms
    },
    now: () => now,
  }
}

function mustOk<T, E>(result: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!result.ok) {
    throw new Error(`expected ok, got error: ${String(result.error)}`)
  }
  return result.value
}

describe("RoomStore.create", () => {
  it("creates a room and adds the creator as a member", () => {
    const { store, now } = makeStore()

    const room = mustOk(store.create("client-1", "Alice"))

    expect(room.roomId).toHaveLength(20)
    expect(room.history).toEqual([])
    expect(room.users).toEqual(["Alice"])
    expect(room.ttlMs).toBe(TTL)
    expect(room.expiresAt).toBe(now() + TTL)
    expect(store.size).toBe(1)
  })

  it("returns unique room ids", () => {
    const { store } = makeStore()

    const first = mustOk(store.create("client-1", "Alice")).roomId
    const second = mustOk(store.create("client-2", "Bob")).roomId

    expect(first).not.toBe(second)
  })

  it("rejects creation once the room cap is reached", () => {
    const { store } = makeStore({ maxRooms: 1 })

    mustOk(store.create("client-1", "Alice"))

    expect(store.create("client-2", "Bob")).toEqual({ ok: false, error: "too_many_rooms" })
    expect(store.size).toBe(1)
  })

  it("fails cleanly when a room id cannot be generated", () => {
    const { store } = makeStore({ generateRoomId: () => "collisionroomid0" })

    mustOk(store.create("client-1", "Alice"))

    expect(store.create("client-2", "Bob")).toEqual({ ok: false, error: "server_error" })
  })
})

describe("RoomStore.join", () => {
  it("rejects unknown rooms", () => {
    const { store } = makeStore()

    expect(store.join("client-1", "doesnotexist0000", "Alice")).toEqual({
      ok: false,
      error: "room_not_found",
    })
  })

  it("adds a second member and resets the room TTL", () => {
    const { store, advance, now } = makeStore()
    const room = mustOk(store.create("client-1", "Alice"))

    advance(10_000)

    const joined = mustOk(store.join("client-2", room.roomId, "Bob"))

    expect(joined.users).toEqual(["Alice", "Bob"])
    expect(joined.expiresAt).toBe(now() + TTL)
  })

  it("rejects a duplicate username case-insensitively", () => {
    const { store } = makeStore()
    const room = mustOk(store.create("client-1", "Alice"))

    expect(store.join("client-2", room.roomId, "alice")).toEqual({
      ok: false,
      error: "username_taken",
    })
  })

  it("rejects the same client joining twice", () => {
    const { store } = makeStore()
    const room = mustOk(store.create("client-1", "Alice"))

    expect(store.join("client-1", room.roomId, "Alice2")).toEqual({
      ok: false,
      error: "already_joined",
    })
  })

  it("rejects a join when the room is full", () => {
    const { store } = makeStore({ maxUsersPerRoom: 2 })
    const room = mustOk(store.create("client-1", "Alice"))
    mustOk(store.join("client-2", room.roomId, "Bob"))

    expect(store.join("client-3", room.roomId, "Carol")).toEqual({
      ok: false,
      error: "room_full",
    })
  })

  it("treats an expired but unswept room as gone", () => {
    const { store, advance } = makeStore()
    const room = mustOk(store.create("client-1", "Alice"))

    advance(TTL + 1)

    expect(store.join("client-2", room.roomId, "Bob")).toEqual({
      ok: false,
      error: "room_not_found",
    })
    expect(store.size).toBe(0)
  })
})

describe("RoomStore.post", () => {
  it("stores a message with a server-assigned sender, id and timestamp", () => {
    const { store, now } = makeStore()
    const room = mustOk(store.create("client-1", "Alice"))

    const message = mustOk(store.post("client-1", room.roomId, "hello"))

    expect(message.type).toBe("chat")
    expect(message.sender).toBe("Alice")
    expect(message.message).toBe("hello")
    expect(message.timestamp).toBe(now())
    expect(message.id).toBeTruthy()

    expect(mustOk(store.snapshot(room.roomId)).history).toEqual([message])
  })

  it("resets the TTL on every message", () => {
    const { store, advance, now } = makeStore()
    const room = mustOk(store.create("client-1", "Alice"))

    advance(30_000)
    mustOk(store.post("client-1", room.roomId, "still here"))

    expect(mustOk(store.snapshot(room.roomId)).expiresAt).toBe(now() + TTL)
  })

  it("keeps only the newest messages up to the per-room cap", () => {
    const { store } = makeStore({ maxMessagesPerRoom: 3 })
    const room = mustOk(store.create("client-1", "Alice"))

    for (const text of ["one", "two", "three", "four", "five"]) {
      mustOk(store.post("client-1", room.roomId, text))
    }

    expect(mustOk(store.snapshot(room.roomId)).history.map((m) => m.message)).toEqual([
      "three",
      "four",
      "five",
    ])
  })

  it("rejects messages from clients that are not in the room", () => {
    const { store } = makeStore()
    const room = mustOk(store.create("client-1", "Alice"))

    expect(store.post("client-2", room.roomId, "sneaky")).toEqual({
      ok: false,
      error: "not_a_member",
    })
  })

  it("rejects messages to an unknown room", () => {
    const { store } = makeStore()

    expect(store.post("client-1", "doesnotexist0000", "hello")).toEqual({
      ok: false,
      error: "room_not_found",
    })
  })
})

describe("RoomStore.leave", () => {
  it("removes the member and reports who left", () => {
    const { store } = makeStore()
    const room = mustOk(store.create("client-1", "Alice"))
    mustOk(store.join("client-2", room.roomId, "Bob"))

    expect(store.leave(room.roomId, "client-2")).toEqual({
      username: "Bob",
      roomEmpty: false,
    })
    expect(mustOk(store.snapshot(room.roomId)).users).toEqual(["Alice"])
  })

  it("ignores clients that are not in the room", () => {
    const { store } = makeStore()
    const room = mustOk(store.create("client-1", "Alice"))

    expect(store.leave(room.roomId, "client-9")).toBeNull()
  })

  it("shrinks the TTL to the empty grace when the last member leaves", () => {
    const { store, now } = makeStore()
    const room = mustOk(store.create("client-1", "Alice"))

    store.leave(room.roomId, "client-1")

    expect(mustOk(store.snapshot(room.roomId)).expiresAt).toBe(now() + GRACE)
  })

  it("does not extend an expiry that is already sooner than the grace", () => {
    const { store, advance, now } = makeStore()
    const room = mustOk(store.create("client-1", "Alice"))

    advance(TTL - 1_000)
    store.leave(room.roomId, "client-1")

    expect(mustOk(store.snapshot(room.roomId)).expiresAt).toBe(now() + 1_000)
  })

  it("lets a room survive a quick refresh within the empty grace", () => {
    const { store, advance } = makeStore()
    const room = mustOk(store.create("client-1", "Alice"))

    store.leave(room.roomId, "client-1")
    advance(GRACE - 1)
    mustOk(store.join("client-2", room.roomId, "Alice"))

    advance(GRACE + 1)
    expect(store.size).toBe(1)
  })
})

describe("RoomStore.sweep", () => {
  it("keeps rooms that have not expired", () => {
    const { store, advance } = makeStore()
    mustOk(store.create("client-1", "Alice"))

    advance(TTL - 1)

    expect(store.sweep()).toEqual([])
    expect(store.size).toBe(1)
  })

  it("deletes expired rooms even while members are connected", () => {
    const { store, advance } = makeStore()
    const room = mustOk(store.create("client-1", "Alice"))

    advance(TTL)

    const expired = store.sweep()

    expect(expired).toEqual([
      { roomId: room.roomId, clientIds: ["client-1"], usernames: ["Alice"] },
    ])
    expect(store.size).toBe(0)
  })

  it("deletes the room at the empty grace deadline", () => {
    const { store, advance } = makeStore()
    const room = mustOk(store.create("client-1", "Alice"))

    store.leave(room.roomId, "client-1")
    advance(GRACE)

    expect(store.sweep().map((r) => r.roomId)).toEqual([room.roomId])
  })
})

describe("RoomStore.systemMessage", () => {
  it("creates a live-only system notice", () => {
    const { store, now } = makeStore()

    expect(store.systemMessage("Alice joined the room")).toMatchObject({
      type: "system",
      sender: "system",
      message: "Alice joined the room",
      timestamp: now(),
    })
  })
})
