import { randomBytes, randomUUID } from "node:crypto"
import type { ChatMessage, RoomSnapshot, SystemMessage } from "./protocol"
import { err, ok, type Result } from "./result"

/**
 * In-memory room store. This is the whole persistence layer: rooms live in a Map
 * and are destroyed by `sweep()` when their server-authoritative `expiresAt` passes.
 *
 * Activity rules:
 * - Sending a chat message resets the room TTL.
 * - Joining resets the room TTL.
 * - Leaving does not reset it; the last member leaving shrinks it to the empty grace.
 * - Presence alone never keeps a room alive.
 *
 * The store never touches sockets. The server maps a stable `clientId` (one per
 * connection) to a room and is responsible for calling `leave` before another join.
 */

export interface RoomStoreOptions {
  ttlMs: number
  emptyGraceMs: number
  maxRooms: number
  maxMessagesPerRoom: number
  maxUsersPerRoom: number
  now?: () => number
  generateRoomId?: () => string
  generateMessageId?: () => string
}

export type CreateError = "too_many_rooms" | "server_error"
export type JoinError = "room_not_found" | "room_full" | "username_taken" | "already_joined"
export type PostError = "room_not_found" | "not_a_member"
export type SnapshotError = "room_not_found"

export interface LeaveResult {
  username: string
  roomEmpty: boolean
}

export interface ExpiredRoom {
  roomId: string
  clientIds: string[]
  usernames: string[]
}

interface RoomState {
  id: string
  messages: ChatMessage[]
  users: Map<string, string>
  expiresAt: number
}

const ID_ATTEMPTS = 5

export class RoomStore {
  private readonly rooms = new Map<string, RoomState>()
  private readonly ttlMs: number
  private readonly emptyGraceMs: number
  private readonly maxRooms: number
  private readonly maxMessagesPerRoom: number
  private readonly maxUsersPerRoom: number
  private readonly now: () => number
  private readonly generateRoomId: () => string
  private readonly generateMessageId: () => string

  constructor(options: RoomStoreOptions) {
    this.ttlMs = options.ttlMs
    this.emptyGraceMs = options.emptyGraceMs
    this.maxRooms = options.maxRooms
    this.maxMessagesPerRoom = options.maxMessagesPerRoom
    this.maxUsersPerRoom = options.maxUsersPerRoom
    this.now = options.now ?? Date.now
    this.generateRoomId = options.generateRoomId ?? (() => randomBytes(16).toString("base64url"))
    this.generateMessageId = options.generateMessageId ?? randomUUID
  }

  get size(): number {
    return this.rooms.size
  }

  create(clientId: string, username: string): Result<RoomSnapshot, CreateError> {
    if (this.rooms.size >= this.maxRooms) {
      return err("too_many_rooms")
    }

    const roomId = this.allocateRoomId()
    if (roomId === null) {
      return err("server_error")
    }

    const room: RoomState = {
      id: roomId,
      messages: [],
      users: new Map([[clientId, username]]),
      expiresAt: this.now() + this.ttlMs,
    }

    this.rooms.set(roomId, room)
    return ok(this.snapshotOf(room))
  }

  join(clientId: string, roomId: string, username: string): Result<RoomSnapshot, JoinError> {
    const room = this.rooms.get(roomId)
    if (!room) {
      return err("room_not_found")
    }

    if (this.isExpired(room)) {
      this.rooms.delete(roomId)
      return err("room_not_found")
    }

    if (room.users.has(clientId)) {
      return err("already_joined")
    }

    if (room.users.size >= this.maxUsersPerRoom) {
      return err("room_full")
    }

    if (this.hasUsername(room, username)) {
      return err("username_taken")
    }

    room.users.set(clientId, username)
    room.expiresAt = this.now() + this.ttlMs
    return ok(this.snapshotOf(room))
  }

  leave(roomId: string, clientId: string): LeaveResult | null {
    const room = this.rooms.get(roomId)
    if (!room) {
      return null
    }

    if (this.isExpired(room)) {
      this.rooms.delete(roomId)
      return null
    }

    const username = room.users.get(clientId)
    if (username === undefined) {
      return null
    }

    room.users.delete(clientId)

    const roomEmpty = room.users.size === 0
    if (roomEmpty) {
      room.expiresAt = Math.min(room.expiresAt, this.now() + this.emptyGraceMs)
    }

    return { username, roomEmpty }
  }

  post(clientId: string, roomId: string, message: string): Result<ChatMessage, PostError> {
    const room = this.rooms.get(roomId)
    if (!room) {
      return err("room_not_found")
    }

    if (this.isExpired(room)) {
      this.rooms.delete(roomId)
      return err("room_not_found")
    }

    const username = room.users.get(clientId)
    if (username === undefined) {
      return err("not_a_member")
    }

    const chatMessage: ChatMessage = {
      id: this.generateMessageId(),
      type: "chat",
      sender: username,
      message,
      timestamp: this.now(),
    }

    room.messages.push(chatMessage)
    if (room.messages.length > this.maxMessagesPerRoom) {
      room.messages.splice(0, room.messages.length - this.maxMessagesPerRoom)
    }

    room.expiresAt = this.now() + this.ttlMs
    return ok(chatMessage)
  }

  /** Builds a live-only system notice. System messages are never added to history. */
  systemMessage(message: string): SystemMessage {
    return {
      id: this.generateMessageId(),
      type: "system",
      sender: "system",
      message,
      timestamp: this.now(),
    }
  }

  snapshot(roomId: string): Result<RoomSnapshot, SnapshotError> {
    const room = this.rooms.get(roomId)
    if (!room) {
      return err("room_not_found")
    }

    if (this.isExpired(room)) {
      this.rooms.delete(roomId)
      return err("room_not_found")
    }

    return ok(this.snapshotOf(room))
  }

  /** Deletes every expired room and reports who was inside so the server can notify them. */
  sweep(): ExpiredRoom[] {
    const now = this.now()
    const expired: ExpiredRoom[] = []

    for (const [roomId, room] of this.rooms) {
      if (room.expiresAt <= now) {
        expired.push({
          roomId,
          clientIds: [...room.users.keys()],
          usernames: [...room.users.values()],
        })
        this.rooms.delete(roomId)
      }
    }

    return expired
  }

  private allocateRoomId(): string | null {
    for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
      const roomId = this.generateRoomId()
      if (!this.rooms.has(roomId)) {
        return roomId
      }
    }

    return null
  }

  private snapshotOf(room: RoomState): RoomSnapshot {
    return {
      roomId: room.id,
      expiresAt: room.expiresAt,
      ttlMs: this.ttlMs,
      history: room.messages.map((message) => ({ ...message })),
      users: [...room.users.values()],
    }
  }

  private isExpired(room: RoomState): boolean {
    return room.expiresAt <= this.now()
  }

  private hasUsername(room: RoomState, username: string): boolean {
    const needle = username.toLowerCase()
    for (const existing of room.users.values()) {
      if (existing.toLowerCase() === needle) {
        return true
      }
    }
    return false
  }
}
