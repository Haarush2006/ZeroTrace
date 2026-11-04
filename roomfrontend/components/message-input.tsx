"use client"

import { useEffect, useRef, useState } from "react"
import { SendHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MAX_MESSAGE_LENGTH } from "@/lib/protocol"

interface MessageInputProps {
  onSendMessage: (message: string) => void
  isConnected: boolean
}

export default function MessageInput({ onSendMessage, isConnected }: MessageInputProps) {
  const [message, setMessage] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()

    const trimmed = message.trim()
    if (!trimmed || !isConnected) return

    onSendMessage(trimmed)
    setMessage("")
    inputRef.current?.focus()
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-border bg-card/50 p-3 md:p-4">
      <div className="flex gap-2 md:gap-3">
        <Input
          ref={inputRef}
          type="text"
          placeholder={isConnected ? "Type a message…" : "Waiting for connection…"}
          value={message}
          maxLength={MAX_MESSAGE_LENGTH}
          onChange={(event) => setMessage(event.target.value)}
          disabled={!isConnected}
          aria-label="Message"
          className="flex-1 border-border bg-input font-mono text-sm"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!message.trim() || !isConnected}
          aria-label="Send message"
        >
          <SendHorizontal className="size-4" />
          <span className="hidden sm:inline">Send</span>
        </Button>
      </div>
    </form>
  )
}
