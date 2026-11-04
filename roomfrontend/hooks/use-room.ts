"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { WS_URL } from "@/lib/config"
import {
  CLOSE_CODES,
  MAX_MESSAGE_LENGTH,
  MAX_USERNAME_LENGTH,
  isValidRoomId,
  parseServerMessage,
  roomIdFromHash,
  withoutRoomHash,
  withRoomHash,
  type RoomMessage,
  type ServerMessage,
} from "@/lib/protocol"

export type RoomStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "expired"
  | "error"

export interface RoomState {
  status: RoomStatus
  username: string
  roomId: string | null
  users: string[]
  messages: RoomMessage[]
  expiresAt: number | null
  ttlMs: number | null
  error: string | null
}

interface Intent {
  action: "create" | "join"
  username: string
  roomId?: string
}

const USERNAME_KEY = "chat:user"
const MAX_RETRIES = 6

const initialState: RoomState = {
  status: "idle",
  username: "",
  roomId: null,
  users: [],
  messages: [],
  expiresAt: null,
  ttlMs: null,
  error: null,
}

function subscribeNoop(): () => void {
  return () => {}
}

/**
 * False during SSR and the hydration pass, true afterwards. Used to defer
 * reading `window.location`/`sessionStorage` until it is safe to do so without
 * a hydration mismatch.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false)
}

export function useRoom() {
  const [state, setState] = useState<RoomState>(initialState)
  const hydrated = useHydrated()

  const socketRef = useRef<WebSocket | null>(null)
  const intentRef = useRef<Intent | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptRef = useRef(0)
  const closedByUsRef = useRef(false)
  const connectRef = useRef<(intent: Intent, retry: boolean) => void>(() => {})

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }, [])

  const handleMessage = useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
        case "ready": {
          attemptRef.current = 0
          const username = intentRef.current?.username ?? ""
          intentRef.current = { action: "join", roomId: message.roomId, username }

          if (typeof window !== "undefined") {
            sessionStorage.setItem(USERNAME_KEY, username)
            window.history.replaceState(null, "", withRoomHash(message.roomId))
          }

          setState((previous) => ({
            ...previous,
            status: "connected",
            username,
            roomId: message.roomId,
            users: message.users,
            messages: message.history,
            expiresAt: message.expiresAt,
            ttlMs: message.ttlMs,
            error: null,
          }))
          return
        }

        case "chat": {
          setState((previous) => {
            if (previous.messages.some((existing) => existing.id === message.id)) {
              return previous
            }

            return {
              ...previous,
              messages: [...previous.messages, message],
              // Display-only mirror of the server TTL reset; the server stays authoritative.
              expiresAt: previous.ttlMs ? Date.now() + previous.ttlMs : previous.expiresAt,
            }
          })
          return
        }

        case "system": {
          setState((previous) => {
            if (previous.messages.some((existing) => existing.id === message.id)) {
              return previous
            }

            return { ...previous, messages: [...previous.messages, message] }
          })
          return
        }

        case "presence": {
          setState((previous) => ({ ...previous, users: message.users }))
          return
        }

        case "expired": {
          intentRef.current = null
          clearRetry()
          socketRef.current?.close(1000, "room expired")

          if (typeof window !== "undefined") {
            window.history.replaceState(null, "", withoutRoomHash())
          }

          setState((previous) => ({
            ...previous,
            status: "expired",
            roomId: null,
            users: [],
            expiresAt: null,
            ttlMs: null,
            error: null,
          }))
          return
        }

        case "error": {
          const fatal = [
            "room_not_found",
            "room_full",
            "username_taken",
            "already_joined",
            "too_many_rooms",
            "invalid_payload",
          ].includes(message.code)

          if (!fatal) {
            setState((previous) => ({ ...previous, error: message.message }))
            return
          }

          intentRef.current = null
          clearRetry()
          socketRef.current?.close(1000, "request failed")

          if (message.code === "room_not_found") {
            if (typeof window !== "undefined") {
              window.history.replaceState(null, "", withoutRoomHash())
            }

            setState((previous) => ({
              ...previous,
              status: "expired",
              roomId: null,
              users: [],
              expiresAt: null,
              ttlMs: null,
              error: null,
            }))
            return
          }

          setState((previous) => ({
            ...previous,
            status: "error",
            users: [],
            expiresAt: null,
            ttlMs: null,
            error: message.message,
          }))
          return
        }
      }
    },
    [clearRetry],
  )

  const connect = useCallback(
    (intent: Intent, retry: boolean) => {
      clearRetry()
      closedByUsRef.current = false
      intentRef.current = intent

      const previous = socketRef.current
      if (previous) {
        previous.onclose = null
        previous.close(1000, "reconnecting")
      }

      const socket = new WebSocket(WS_URL)
      socketRef.current = socket

      setState((previousState) =>
        retry
          ? {
              ...previousState,
              status: "reconnecting",
              username: intent.username,
              error: null,
            }
          : {
              ...initialState,
              status: "connecting",
              username: intent.username,
              roomId: intent.action === "join" ? (intent.roomId ?? null) : null,
            },
      )

      socket.onopen = () => {
        if (socketRef.current !== socket) return

        const payload =
          intent.action === "create"
            ? { type: "create", username: intent.username }
            : { type: "join", roomId: intent.roomId, username: intent.username }

        socket.send(JSON.stringify(payload))
      }

      socket.onmessage = (event) => {
        if (socketRef.current !== socket) return

        const message = parseServerMessage(String(event.data))
        if (message) handleMessage(message)
      }

      socket.onclose = (event) => {
        if (socketRef.current !== socket) return
        socketRef.current = null

        if (closedByUsRef.current || !intentRef.current) return

        if (event.code === CLOSE_CODES.roomExpired) {
          intentRef.current = null
          if (typeof window !== "undefined") {
            window.history.replaceState(null, "", withoutRoomHash())
          }
          setState((previous) => ({
            ...previous,
            status: "expired",
            roomId: null,
            users: [],
            expiresAt: null,
            ttlMs: null,
          }))
          return
        }

        if (event.code === CLOSE_CODES.rateLimited) {
          intentRef.current = null
          setState((previous) => ({
            ...previous,
            status: "error",
            error: "You were disconnected for sending messages too quickly.",
          }))
          return
        }

        const attempt = attemptRef.current + 1
        attemptRef.current = attempt

        if (attempt > MAX_RETRIES) {
          intentRef.current = null
          setState((previous) => ({
            ...previous,
            status: "error",
            error: "Can't reach the chat server. Is the backend running?",
          }))
          return
        }

        setState((previous) => ({ ...previous, status: "reconnecting" }))

        const delay = Math.min(500 * 2 ** (attempt - 1), 10_000)
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null
          const nextIntent = intentRef.current
          if (nextIntent) connectRef.current(nextIntent, true)
        }, delay)
      }

      socket.onerror = () => {
        // The close event carries the actual failure.
      }
    },
    [clearRetry, handleMessage],
  )

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  useEffect(() => {
    if (!hydrated) return

    const roomId = roomIdFromHash(window.location.hash)
    const username = sessionStorage.getItem(USERNAME_KEY) ?? ""

    // Auto-rejoin only when the room link was opened by someone we already know.
    // Otherwise the landing form pre-fills the room and asks for a username.
    // Deferred so the connection's initial state update happens outside the
    // effect body (avoids a cascading render warning).
    const start = setTimeout(() => {
      if (roomId && username) {
        connect({ action: "join", roomId, username }, false)
      }
    }, 0)

    return () => {
      clearTimeout(start)
      closedByUsRef.current = true
      clearRetry()
      intentRef.current = null
      const socket = socketRef.current
      socketRef.current = null
      socket?.close(1000, "unmount")
    }
  }, [clearRetry, connect, hydrated])

  const createRoom = useCallback(
    (name: string) => {
      const username = name.trim().slice(0, MAX_USERNAME_LENGTH)
      if (!username) return

      attemptRef.current = 0
      sessionStorage.setItem(USERNAME_KEY, username)
      connect({ action: "create", username }, false)
    },
    [connect],
  )

  const joinRoom = useCallback(
    (roomId: string, name: string) => {
      const username = name.trim().slice(0, MAX_USERNAME_LENGTH)
      if (!username || !isValidRoomId(roomId)) return

      attemptRef.current = 0
      sessionStorage.setItem(USERNAME_KEY, username)
      connect({ action: "join", roomId, username }, false)
    },
    [connect],
  )

  const sendMessage = useCallback((text: string) => {
    const message = text.trim().slice(0, MAX_MESSAGE_LENGTH)
    if (!message) return

    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return

    socket.send(JSON.stringify({ type: "chat", message }))
  }, [])

  const leaveRoom = useCallback(() => {
    closedByUsRef.current = true
    clearRetry()
    intentRef.current = null

    const socket = socketRef.current
    socketRef.current = null
    socket?.close(1000, "leaving")

    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", withoutRoomHash())
    }

    setState((previous) => ({
      ...initialState,
      username: previous.username,
    }))
  }, [clearRetry])

  const dismissError = useCallback(() => {
    setState((previous) => ({ ...previous, error: null }))
  }, [])

  // Read browser state only after hydration; during SSR these stay empty so the
  // markup matches and the first client paint has no mismatch.
  const storedRoomId = hydrated ? roomIdFromHash(window.location.hash) : null
  const storedUsername = hydrated ? (sessionStorage.getItem(USERNAME_KEY) ?? "") : ""

  return {
    state: {
      ...state,
      booted: hydrated,
      roomId: state.roomId ?? storedRoomId,
      username: state.username || storedUsername,
    },
    createRoom,
    joinRoom,
    sendMessage,
    leaveRoom,
    dismissError,
  }
}
