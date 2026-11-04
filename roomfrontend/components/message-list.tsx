"use client"

import { useEffect, useRef } from "react"
import type { RoomMessage } from "@/lib/protocol"

interface MessageListProps {
  messages: RoomMessage[]
  username: string
  connecting: boolean
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

export default function MessageList({ messages, username, connecting }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  if (connecting) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background p-6">
        <p className="font-mono text-xs text-muted-foreground">Connecting to the room…</p>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-4 overflow-y-auto bg-background p-4 md:p-6">
      {messages.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-center text-sm text-muted-foreground">
            No messages yet. Say hi — this room disappears when the conversation stops.
          </p>
        </div>
      ) : (
        <>
          {messages.map((message) =>
            message.type === "system" ? (
              <div
                key={message.id}
                className="rounded border border-border bg-muted/30 px-4 py-3 text-center"
              >
                <p className="font-mono text-xs text-muted-foreground">➜ {message.message}</p>
              </div>
            ) : (
              <div key={message.id} className="group space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-sm font-semibold text-primary">
                    {message.sender === username ? "you" : message.sender}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatTime(message.timestamp)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words pl-0 text-sm leading-relaxed text-foreground">
                  {message.message}
                </p>
              </div>
            ),
          )}
          <div ref={bottomRef} />
        </>
      )}
    </div>
  )
}
