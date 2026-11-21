"use client"

import { useState } from "react"
import { ArrowRight, Clock3, Link2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MAX_USERNAME_LENGTH, parseRoomInput } from "@/lib/protocol"
import { cn } from "@/lib/utils"

interface LandingProps {
  initialRoomId: string | null
  initialUsername: string
  error: string | null
  onCreate: (username: string) => void
  onJoin: (roomId: string, username: string) => void
}

type Mode = "create" | "join"

export default function Landing({
  initialRoomId,
  initialUsername,
  error,
  onCreate,
  onJoin,
}: LandingProps) {
  const [mode, setMode] = useState<Mode>(initialRoomId ? "join" : "create")
  const [username, setUsername] = useState(initialUsername)
  const [roomInput, setRoomInput] = useState(initialRoomId ?? "")
  const [localError, setLocalError] = useState<string | null>(null)

  const visibleError = localError ?? error

  const switchMode = (next: Mode) => {
    setMode(next)
    setLocalError(null)
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()

    if (!username.trim()) {
      setLocalError("Pick a username first.")
      return
    }

    if (mode === "create") {
      onCreate(username)
      return
    }

    const roomId = parseRoomInput(roomInput)
    if (!roomId) {
      setLocalError("That doesn't look like a valid room link or code.")
      return
    }

    onJoin(roomId, username)
  }

  return (
    <Card className="w-full max-w-md border-border bg-card">
      <CardHeader className="gap-3">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
          Ephemeral rooms
        </div>
        <div className="space-y-2">
          <CardTitle role="heading" aria-level={1} className="text-2xl tracking-tight">
            Chat that disappears
          </CardTitle>
          <CardDescription>
            Create a room, share the link, and talk. Nobody can read it once it&apos;s gone.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/30 p-1">
          <button
            type="button"
            onClick={() => switchMode("create")}
            className={cn(
              "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors",
              mode === "create"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={mode === "create"}
          >
            <Plus className="size-3.5" />
            Create room
          </button>
          <button
            type="button"
            onClick={() => switchMode("join")}
            className={cn(
              "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors",
              mode === "join"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={mode === "join"}
          >
            <Link2 className="size-3.5" />
            Join with link
          </button>
        </div>

        {visibleError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {visibleError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {mode === "join" && (
            <div className="space-y-2">
              <label htmlFor="room" className="text-sm font-medium">
                Room link or code
              </label>
              <Input
                id="room"
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://…/#r=AbCdEf… or the room code"
                value={roomInput}
                onChange={(event) => {
                  setRoomInput(event.target.value)
                  setLocalError(null)
                }}
                className="border-border bg-input font-mono text-base md:text-xs"
              />
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="username" className="text-sm font-medium">
              Username
            </label>
            <Input
              id="username"
              type="text"
              autoComplete="nickname"
              maxLength={MAX_USERNAME_LENGTH}
              placeholder="dev_user_123"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value)
                setLocalError(null)
              }}
              className="border-border bg-input font-mono text-base md:text-sm"
            />
          </div>

          <Button
            type="submit"
            disabled={!username.trim() || (mode === "join" && !roomInput.trim())}
            className="w-full"
          >
            {mode === "create" ? "Create a room" : "Join room"}
            <ArrowRight className="size-4" />
          </Button>
        </form>

        <p className="flex items-start gap-2 border-t border-border pt-4 text-[11px] leading-relaxed text-muted-foreground">
          <Clock3 className="mt-0.5 size-3.5 shrink-0" />
          Rooms self-destruct after a period without messages. Messages live in memory only and are
          never written to disk.
        </p>
      </CardContent>
    </Card>
  )
}
