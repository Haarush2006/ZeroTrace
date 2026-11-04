import { describe, expect, it } from "vitest"
import { LIMITS, parseClientMessage } from "../src/protocol"

const ROOM_ID = "abcdefghijklmnopqrstuv"

function parse(value: unknown) {
  return parseClientMessage(JSON.stringify(value))
}

describe("parseClientMessage", () => {
  it("accepts a create message and trims the username", () => {
    const result = parse({ type: "create", username: "  Alice  " })

    expect(result).toEqual({ ok: true, value: { type: "create", username: "Alice" } })
  })

  it("accepts a join message", () => {
    const result = parse({ type: "join", roomId: ROOM_ID, username: "Bob" })

    expect(result).toEqual({
      ok: true,
      value: { type: "join", roomId: ROOM_ID, username: "Bob" },
    })
  })

  it("accepts a chat message with newlines and tabs", () => {
    const result = parse({ type: "chat", message: "line one\n\tline two" })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ type: "chat", message: "line one\n\tline two" })
    }
  })

  it("rejects malformed JSON instead of throwing", () => {
    expect(parseClientMessage("{not json")).toEqual({ ok: false, message: "invalid JSON" })
  })

  it("rejects unknown message types", () => {
    expect(parse({ type: "leave" }).ok).toBe(false)
  })

  it("rejects extra fields", () => {
    expect(parse({ type: "chat", message: "hi", sender: "Admin" }).ok).toBe(false)
  })

  it("rejects missing fields", () => {
    expect(parse({ type: "join", username: "Bob" }).ok).toBe(false)
    expect(parse({ type: "chat" }).ok).toBe(false)
  })

  it("rejects empty and whitespace-only usernames", () => {
    expect(parse({ type: "create", username: "" }).ok).toBe(false)
    expect(parse({ type: "create", username: "   " }).ok).toBe(false)
  })

  it("rejects usernames that are too long", () => {
    expect(parse({ type: "create", username: "a".repeat(LIMITS.usernameMaxLength + 1) }).ok).toBe(
      false,
    )
  })

  it("rejects control characters in usernames", () => {
    expect(parse({ type: "create", username: "Ali\nce" }).ok).toBe(false)
  })

  it("rejects the reserved system username", () => {
    expect(parse({ type: "create", username: "system" }).ok).toBe(false)
    expect(parse({ type: "create", username: "SYSTEM" }).ok).toBe(false)
  })

  it("rejects invalid room ids", () => {
    expect(parse({ type: "join", roomId: "short", username: "Bob" }).ok).toBe(false)
    expect(parse({ type: "join", roomId: "not a room id!!", username: "Bob" }).ok).toBe(false)
    expect(
      parse({ type: "join", roomId: "a".repeat(LIMITS.roomIdMaxLength + 1), username: "Bob" }).ok,
    ).toBe(false)
    expect(parse({ type: "join", roomId: 1001, username: "Bob" }).ok).toBe(false)
  })

  it("rejects empty, oversized and control-character messages", () => {
    expect(parse({ type: "chat", message: "" }).ok).toBe(false)
    expect(parse({ type: "chat", message: "   " }).ok).toBe(false)
    expect(parse({ type: "chat", message: "a".repeat(LIMITS.messageMaxLength + 1) }).ok).toBe(false)
    expect(parse({ type: "chat", message: "null\u0000byte" }).ok).toBe(false)
    expect(parse({ type: "chat", message: 42 }).ok).toBe(false)
  })

  it("rejects non-object payloads", () => {
    expect(parseClientMessage("null").ok).toBe(false)
    expect(parseClientMessage('"chat"').ok).toBe(false)
    expect(parseClientMessage("[]").ok).toBe(false)
  })
})
