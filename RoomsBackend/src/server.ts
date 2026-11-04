import { randomUUID } from "node:crypto"
import { createServer, type Server as HttpServer } from "node:http"
import type { AddressInfo } from "node:net"
import type { Duplex } from "node:stream"
import { WebSocket, WebSocketServer } from "ws"
import type { AppConfig } from "./config"
import {
  CLOSE_CODES,
  parseClientMessage,
  type ErrorCode,
  type ServerMessage,
} from "./protocol"
import { TokenBucket } from "./rate-limit"
import { RoomStore } from "./rooms"

const WS_PATH = "/ws"

/** Drop clients that stop reading instead of letting their buffers grow without bound. */
const MAX_BUFFERED_BYTES = 1_000_000

// 20 messages instantly, then 5 per second.
const MESSAGE_RATE = { burst: 20, refillPerSec: 5 }
// 20 rooms instantly per IP, then roughly one every 5 seconds.
const CREATE_RATE = { burst: 20, refillPerSec: 0.2 }
const CREATE_BUCKET_TTL_MS = 10 * 60 * 1000

const ERROR_TEXT: Record<ErrorCode, string> = {
  invalid_payload: "Invalid message",
  room_not_found: "This room has expired or never existed",
  room_full: "This room is full",
  username_taken: "That username is already taken in this room",
  already_joined: "You are already in a room",
  not_a_member: "Join a room first",
  too_many_rooms: "The server is at capacity, try again later",
  rate_limited: "Slow down",
  server_error: "Something went wrong",
}

export interface ChatLogger {
  info(message: string): void
  error(message: string, error?: unknown): void
}

export const silentLogger: ChatLogger = {
  info() {},
  error() {},
}

const consoleLogger: ChatLogger = {
  info: (message) => console.log(message),
  error: (message, error) => console.error(message, error),
}

export interface ChatServerOptions {
  /** Override the store (tests inject a controllable clock). */
  store?: RoomStore
  logger?: ChatLogger
}

export interface ChatServer {
  readonly httpServer: HttpServer
  readonly wss: WebSocketServer
  readonly store: RoomStore
  listen(port?: number, host?: string): Promise<{ port: number }>
  /** Runs expiry immediately. The interval calls this every `sweepMs`. */
  sweepNow(): void
  close(): Promise<void>
}

interface ConnectionState {
  id: string
  socket: WebSocket
  ip: string
  roomId: string | null
  username: string | null
  alive: boolean
  bucket: TokenBucket
  violations: number
}

interface CreateBucket {
  bucket: TokenBucket
  lastSeen: number
}

export function createChatServer(config: AppConfig, options: ChatServerOptions = {}): ChatServer {
  const logger = options.logger ?? consoleLogger
  const store =
    options.store ??
    new RoomStore({
      ttlMs: config.ttlMs,
      emptyGraceMs: config.emptyGraceMs,
      maxRooms: config.maxRooms,
      maxMessagesPerRoom: config.maxMessagesPerRoom,
      maxUsersPerRoom: config.maxUsersPerRoom,
    })

  const httpServer = createServer((request, response) => {
    const pathname = safePathname(request.url)
    if (request.method === "GET" && pathname === "/health") {
      const body = JSON.stringify({ ok: true, rooms: store.size, uptime: process.uptime() })
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      response.end(body)
      return
    }

    response.writeHead(404, { "content-type": "text/plain" })
    response.end("Not found")
  })

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxPayloadBytes,
    // Compression leaks patterns and buys nothing for short chat messages.
    perMessageDeflate: false,
  })

  const connections = new Map<WebSocket, ConnectionState>()
  const rooms = new Map<string, Set<ConnectionState>>()
  const createBuckets = new Map<string, CreateBucket>()

  function send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState !== WebSocket.OPEN) return

    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      socket.terminate()
      return
    }

    socket.send(JSON.stringify(message))
  }

  function sendError(socket: WebSocket, code: ErrorCode, message = ERROR_TEXT[code]): void {
    send(socket, { type: "error", code, message })
  }

  function broadcast(roomId: string, message: ServerMessage, except?: ConnectionState): void {
    const members = rooms.get(roomId)
    if (!members) return

    for (const member of members) {
      if (member !== except) send(member.socket, message)
    }
  }

  function broadcastPresence(roomId: string): void {
    const snapshot = store.snapshot(roomId)
    if (!snapshot.ok) return

    broadcast(roomId, { type: "presence", users: snapshot.value.users })
  }

  function addToRoom(state: ConnectionState, roomId: string): void {
    let members = rooms.get(roomId)
    if (!members) {
      members = new Set()
      rooms.set(roomId, members)
    }
    members.add(state)
  }

  function removeFromRoom(state: ConnectionState, roomId: string): void {
    const members = rooms.get(roomId)
    if (!members) return

    members.delete(state)
    if (members.size === 0) rooms.delete(roomId)
  }

  /** Destroys every connection attached to a room that no longer exists. */
  function expireRoom(roomId: string): void {
    const members = rooms.get(roomId)
    rooms.delete(roomId)
    if (!members) return

    for (const state of members) {
      state.roomId = null
      state.username = null
      send(state.socket, { type: "expired" })
      state.socket.close(CLOSE_CODES.roomExpired, "room expired")
    }
  }

  function allowCreate(ip: string): boolean {
    const now = Date.now()
    let entry = createBuckets.get(ip)
    if (!entry) {
      entry = {
        bucket: new TokenBucket(CREATE_RATE.burst, CREATE_RATE.refillPerSec / 1000),
        lastSeen: now,
      }
      createBuckets.set(ip, entry)
    }

    entry.lastSeen = now
    return entry.bucket.tryConsume()
  }

  function handleCreate(state: ConnectionState, username: string): void {
    if (state.roomId) {
      sendError(state.socket, "already_joined")
      return
    }

    if (!allowCreate(state.ip)) {
      sendError(state.socket, "rate_limited")
      return
    }

    const created = store.create(state.id, username)
    if (!created.ok) {
      sendError(state.socket, created.error)
      return
    }

    state.roomId = created.value.roomId
    state.username = username
    addToRoom(state, created.value.roomId)

    send(state.socket, { type: "ready", ...created.value })
    broadcastPresence(created.value.roomId)
  }

  function handleJoin(state: ConnectionState, roomId: string, username: string): void {
    if (state.roomId) {
      sendError(state.socket, "already_joined")
      return
    }

    const joined = store.join(state.id, roomId, username)
    if (!joined.ok) {
      sendError(state.socket, joined.error)
      return
    }

    state.roomId = joined.value.roomId
    state.username = username
    addToRoom(state, joined.value.roomId)

    send(state.socket, { type: "ready", ...joined.value })
    broadcastPresence(joined.value.roomId)
    broadcast(joined.value.roomId, store.systemMessage(`${username} joined the room`), state)
  }

  function handleChat(state: ConnectionState, message: string): void {
    if (!state.roomId) {
      sendError(state.socket, "not_a_member")
      return
    }

    const posted = store.post(state.id, state.roomId, message)
    if (!posted.ok) {
      if (posted.error === "room_not_found") {
        expireRoom(state.roomId)
        return
      }

      sendError(state.socket, posted.error)
      return
    }

    broadcast(state.roomId, posted.value)
  }

  function handleMessage(state: ConnectionState, raw: string): void {
    if (!state.bucket.tryConsume()) {
      state.violations += 1
      if (state.violations >= 5) {
        state.socket.close(CLOSE_CODES.rateLimited, "rate limit exceeded")
        return
      }

      sendError(state.socket, "rate_limited")
      return
    }
    state.violations = 0

    const parsed = parseClientMessage(raw)
    if (!parsed.ok) {
      sendError(state.socket, "invalid_payload", parsed.message)
      return
    }

    switch (parsed.value.type) {
      case "create":
        handleCreate(state, parsed.value.username)
        return
      case "join":
        handleJoin(state, parsed.value.roomId, parsed.value.username)
        return
      case "chat":
        handleChat(state, parsed.value.message)
        return
    }
  }

  function cleanup(state: ConnectionState): void {
    const roomId = state.roomId
    if (!roomId) return

    state.roomId = null
    state.username = null

    const left = store.leave(roomId, state.id)
    removeFromRoom(state, roomId)

    if (!left || !rooms.has(roomId)) return

    broadcast(roomId, store.systemMessage(`${left.username} left the room`))
    broadcastPresence(roomId)
  }

  function sweepNow(): void {
    const expired = store.sweep()

    const cutoff = Date.now() - CREATE_BUCKET_TTL_MS
    for (const [ip, entry] of createBuckets) {
      if (entry.lastSeen < cutoff) createBuckets.delete(ip)
    }

    for (const room of expired) {
      expireRoom(room.roomId)
    }

    if (expired.length > 0) {
      logger.info(`[chat] expired ${expired.length} room(s)`)
    }
  }

  wss.on("connection", (socket, request) => {
    const state: ConnectionState = {
      id: randomUUID(),
      socket,
      ip: request.socket.remoteAddress ?? "unknown",
      roomId: null,
      username: null,
      alive: true,
      bucket: new TokenBucket(MESSAGE_RATE.burst, MESSAGE_RATE.refillPerSec / 1000),
      violations: 0,
    }

    connections.set(socket, state)

    socket.on("pong", () => {
      state.alive = true
    })

    socket.on("message", (raw) => {
      try {
        handleMessage(state, raw.toString())
      } catch (error) {
        logger.error("[chat] message handler failed", error)
      }
    })

    socket.on("error", (error) => {
      logger.error("[chat] socket error", error)
    })

    socket.on("close", () => {
      try {
        cleanup(state)
      } catch (error) {
        logger.error("[chat] cleanup failed", error)
      }
      connections.delete(socket)
    })
  })

  httpServer.on("upgrade", (request, socket, head) => {
    if (safePathname(request.url) !== WS_PATH) {
      rejectUpgrade(socket, 404, "Not Found")
      return
    }

    const origin = request.headers.origin
    if (!origin || !config.allowedOrigins.includes(origin)) {
      rejectUpgrade(socket, 403, "Forbidden")
      return
    }

    wss.handleUpgrade(request, socket, head, (websocket) => {
      wss.emit("connection", websocket, request)
    })
  })

  const sweepTimer = setInterval(sweepNow, config.sweepMs)
  sweepTimer.unref()

  const heartbeatTimer = setInterval(() => {
    for (const [socket, state] of connections) {
      if (!state.alive) {
        socket.terminate()
        continue
      }

      state.alive = false
      try {
        socket.ping()
      } catch {
        socket.terminate()
      }
    }
  }, config.heartbeatMs)
  heartbeatTimer.unref()

  async function close(): Promise<void> {
    clearInterval(sweepTimer)
    clearInterval(heartbeatTimer)

    const openSockets = [...connections.keys()]
    for (const socket of openSockets) {
      try {
        socket.close(1001, "server shutting down")
      } catch {
        socket.terminate()
      }
    }

    await new Promise<void>((resolve) => {
      const force = setTimeout(() => {
        for (const socket of openSockets) socket.terminate()
      }, 500)
      force.unref()

      wss.close(() => {
        clearTimeout(force)
        resolve()
      })
    })

    if (httpServer.listening) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
        // Upgraded sockets are not affected by this; idle keep-alives are.
        httpServer.closeAllConnections()
      })
    }
  }

  function listen(port = config.port, host = "0.0.0.0"): Promise<{ port: number }> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        httpServer.off("listening", onListening)
        reject(error)
      }

      const onListening = () => {
        httpServer.off("error", onError)
        const address = httpServer.address() as AddressInfo | null
        resolve({ port: address?.port ?? port })
      }

      httpServer.once("error", onError)
      httpServer.once("listening", onListening)
      httpServer.listen(port, host)
    })
  }

  return {
    httpServer,
    wss,
    store,
    listen,
    sweepNow,
    close,
  }
}

function safePathname(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://localhost").pathname
  } catch {
    return ""
  }
}

function rejectUpgrade(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}
