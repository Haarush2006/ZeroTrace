/**
 * Client-side protocol helpers.
 *
 * Wire types and limits come from the shared `@chat/protocol` workspace
 * package. Everything else here is UI-only: parsing what a user pasted and
 * building links from the current page URL.
 */
import { isValidRoomId, type ServerMessage } from "@chat/protocol"

export {
  CLOSE_CODES,
  LIMITS,
  MAX_MESSAGE_LENGTH,
  MAX_USERNAME_LENGTH,
  ROOM_ID_MAX_LENGTH,
  ROOM_ID_MIN_LENGTH,
  ROOM_ID_PATTERN,
  isValidRoomId,
} from "@chat/protocol"

export type {
  ChatMessage,
  ClientMessage,
  ErrorCode,
  ParseClientMessageResult,
  ReadyMessage,
  RoomMessage,
  RoomSnapshot,
  ServerMessage,
  SystemMessage,
} from "@chat/protocol"

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== "object" || value === null) return null
    if (typeof (value as { type?: unknown }).type !== "string") return null
    return value as ServerMessage
  } catch {
    return null
  }
}

/** Extracts a room id from a location hash such as `#r=AbC...`. */
export function roomIdFromHash(hash: string): string | null {
  if (!hash) return null

  const params = new URLSearchParams(hash.replace(/^#/, ""))
  const roomId = params.get("r")
  return roomId && isValidRoomId(roomId) ? roomId : null
}

/**
 * Accepts a raw room id, a full link with `#r=<id>`, `?room=<id>`, or a
 * `/r/<id>` style path.
 */
export function parseRoomInput(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (isValidRoomId(trimmed)) return trimmed

  const hashIndex = trimmed.indexOf("#")
  if (hashIndex !== -1) {
    const fromHash = roomIdFromHash(trimmed.slice(hashIndex))
    if (fromHash) return fromHash
  }

  try {
    const url = new URL(trimmed)

    for (const key of ["r", "room"]) {
      const value = url.searchParams.get(key)
      if (value && isValidRoomId(value)) return value
    }

    const segments = url.pathname.split("/").filter(Boolean)
    const last = segments[segments.length - 1]
    if (last && isValidRoomId(last)) return last
  } catch {
    return null
  }

  return null
}

/** Builds the shareable link for a room from the current page URL. */
export function roomLink(roomId: string): string {
  const url = new URL(window.location.href)
  url.hash = `r=${roomId}`
  return url.toString()
}

export function withRoomHash(roomId: string): string {
  return `${window.location.pathname}${window.location.search}#r=${roomId}`
}

export function withoutRoomHash(): string {
  return `${window.location.pathname}${window.location.search}`
}
