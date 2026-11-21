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
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

export default function MessageList({ messages, username, connecting }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  if (connecting) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-background p-6">
        <p className="font-mono text-xs text-muted-foreground">Connecting to the room…</p>
      </div>
    )
  }

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-background p-4 [overflow-wrap:anywhere] md:p-6">
      {messages.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-center text-sm text-muted-foreground">
            No messages yet. Say hi — this room disappears when the conversation stops.
          </p>
        </div>
      ) : (
        <>
          {messages.map((message, index) => {
            const previous = messages[index - 1]
            const continuesSender =
              message.type === "chat" &&
              previous?.type === "chat" &&
              previous.sender === message.sender

            return message.type === "system" ? (
              <div
                key={message.id}
                className="mt-4 rounded border border-border bg-muted/30 px-4 py-3 text-center first:mt-0"
              >
                <p className="font-mono text-xs text-muted-foreground">➜ {message.message}</p>
              </div>
            ) : (
              <div key={message.id} className={continuesSender ? "mt-1" : "mt-4 first:mt-0"}>
                {!continuesSender && (
                  <p className="mb-1 font-mono text-sm font-semibold text-primary">
                    {message.sender === username ? "you" : message.sender}
                  </p>
                )}
                <div className="flex items-end gap-2">
                  <p className="min-w-0 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {message.message}
                  </p>
                  <time
                    dateTime={new Date(message.timestamp).toISOString()}
                    className="shrink-0 pb-0.5 text-[11px] text-muted-foreground"
                  >
                    {formatTime(message.timestamp)}
                  </time>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </>
      )}
    </div>
  )
}
