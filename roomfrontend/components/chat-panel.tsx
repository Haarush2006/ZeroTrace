"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { Check, Copy, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import MessageList from "./message-list"
import MessageInput from "./message-input"
import type { RoomStatus } from "@/hooks/use-room"
import { roomLink, type RoomMessage } from "@/lib/protocol"

interface ChatPanelProps {
  username: string
  roomId: string
  users: string[]
  messages: RoomMessage[]
  status: RoomStatus
  error: string | null
  expiresAt: number | null
  onSendMessage: (message: string) => void
  onLeave: () => void
  onDismissError: () => void
}

// Quantised to whole seconds so the snapshot stays stable between ticks.
function subscribeToClock(onChange: () => void): () => void {
  const timer = setInterval(onChange, 1_000)
  return () => clearInterval(timer)
}

function currentSecond(): number | null {
  return Math.floor(Date.now() / 1_000)
}

function serverSecond(): number | null {
  return null
}

/**
 * Seconds since the epoch, ticking once per second. Returns null during SSR and
 * the hydration pass so the countdown never causes a hydration mismatch.
 */
function useClock(): number | null {
  return useSyncExternalStore(subscribeToClock, currentSecond, serverSecond)
}

function useRemaining(expiresAt: number | null): number | null {
  const now = useClock()
  if (expiresAt === null || now === null) return null
  return Math.max(0, expiresAt - now * 1_000)
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.floor(ms / 1_000)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

const STATUS_LABEL: Record<string, string> = {
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
}

const STATUS_DOT: Record<string, string> = {
  connecting: "bg-muted-foreground animate-pulse",
  connected: "bg-emerald-500",
  reconnecting: "bg-amber-500 animate-pulse",
}

export default function ChatPanel({
  username,
  roomId,
  users,
  messages,
  status,
  error,
  expiresAt,
  onSendMessage,
  onLeave,
  onDismissError,
}: ChatPanelProps) {
  const [copied, setCopied] = useState(false)
  const remaining = useRemaining(expiresAt)

  useEffect(() => {
    if (!copied) return

    const timer = setTimeout(() => setCopied(false), 2_000)
    return () => clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    const link = roomLink(roomId)

    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable")
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      window.prompt("Copy this room link", link)
    }
  }

  const remainingLabel =
    remaining === null ? null : remaining === 0 ? "expiring…" : `expires in ${formatRemaining(remaining)}`

  return (
    <div className="flex h-dvh min-h-0 min-w-0 w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-background md:h-[90dvh]">
      <header className="shrink-0 border-b border-border bg-card/50 px-4 py-3 md:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate font-mono text-sm font-semibold tracking-tight">
                #{roomId.slice(0, 8)}
                <span className="text-muted-foreground">…</span>
              </h1>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={handleCopy}
                aria-label="Copy room link"
                title={copied ? "Link copied" : "Copy room link"}
              >
                {copied ? (
                  <Check className="size-3.5 text-emerald-500" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className={`inline-block size-1.5 rounded-full ${STATUS_DOT[status]}`} />
                {STATUS_LABEL[status]}
              </span>
              {remainingLabel && (
                <>
                  <span>·</span>
                  <span
                    className={remaining === 0 ? "text-destructive" : undefined}
                    title="Time until this room self-destructs"
                  >
                    {remainingLabel}
                  </span>
                </>
              )}
            </div>
          </div>

          <Button
            type="button"
            onClick={onLeave}
            variant="outline"
            size="sm"
            className="shrink-0 bg-transparent text-xs"
          >
            Leave
          </Button>
        </div>

        <div className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <Users className="size-3 shrink-0" />
          <span className="truncate" title={users.join(", ")}>
            {users.map((user) => (user === username ? "You" : user)).join(", ")}
          </span>
        </div>
      </header>

      {status === "reconnecting" && (
        <div
          role="status"
          className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 font-mono text-[11px] text-amber-600 dark:text-amber-400"
        >
          Reconnecting… messages are paused.
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={onDismissError}
            className="shrink-0 rounded p-0.5 hover:bg-destructive/10"
            aria-label="Dismiss error"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <MessageList
        messages={messages}
        username={username}
        connecting={status === "connecting"}
      />

      <MessageInput
        onSendMessage={onSendMessage}
        isConnected={status === "connected"}
      />
    </div>
  )
}
