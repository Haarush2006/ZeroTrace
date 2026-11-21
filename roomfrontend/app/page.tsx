"use client"

import { Loader2 } from "lucide-react"
import ChatPanel from "@/components/chat-panel"
import ExpiredRoom from "@/components/expired-room"
import Landing from "@/components/landing"
import ThemeToggle from "@/components/theme-toggle"
import { useRoom } from "@/hooks/use-room"

function Splash({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      {label}
    </div>
  )
}

export default function Home() {
  const { state, createRoom, joinRoom, sendMessage, leaveRoom, dismissError } = useRoom()

  const inRoom =
    state.status === "connecting" ||
    state.status === "connected" ||
    state.status === "reconnecting"

  let content: React.ReactNode

  if (!state.booted) {
    content = <Splash label="Loading…" />
  } else if (state.status === "expired") {
    content = <ExpiredRoom onReset={leaveRoom} />
  } else if (inRoom && state.roomId) {
    content = (
      <ChatPanel
        username={state.username}
        roomId={state.roomId}
        users={state.users}
        messages={state.messages}
        status={state.status}
        error={state.error}
        expiresAt={state.expiresAt}
        onSendMessage={sendMessage}
        onLeave={leaveRoom}
        onDismissError={dismissError}
      />
    )
  } else if (inRoom) {
    content = (
      <Splash
        label={
          state.status === "reconnecting" ? "Reconnecting to the chat server…" : "Creating room…"
        }
      />
    )
  } else {
    content = (
      <Landing
        key={state.roomId ?? "landing"}
        initialRoomId={state.roomId}
        initialUsername={state.username}
        error={state.error}
        onCreate={createRoom}
        onJoin={joinRoom}
      />
    )
  }

  return (
    <main className="flex min-h-dvh min-w-0 items-center justify-center p-0 md:p-4">
      {!(inRoom && state.roomId) && (
        <div className="fixed right-4 top-4 z-50">
          <ThemeToggle />
        </div>
      )}
      {content}
    </main>
  )
}
