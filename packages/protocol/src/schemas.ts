import { z } from "zod"

import { LIMITS, type ClientMessage, type ParseClientMessageResult } from "./index"

/** All C0/C1 controls, including newlines and tabs. */
const ALL_CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/
/** Control characters that are not allowed inside a chat message (newlines and tabs are fine). */
const FORBIDDEN_MESSAGE_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/

const usernameSchema = z
  .string()
  .trim()
  .min(1, "username is required")
  .max(LIMITS.usernameMaxLength, `username must be at most ${LIMITS.usernameMaxLength} characters`)
  .refine((value) => !ALL_CONTROL_CHARS.test(value), "username must not contain control characters")
  .refine((value) => value.toLowerCase() !== "system", '"system" is a reserved username')

export const roomIdSchema = z
  .string()
  .min(LIMITS.roomIdMinLength, "invalid room id")
  .max(LIMITS.roomIdMaxLength, "invalid room id")
  .regex(/^[A-Za-z0-9_-]+$/, "invalid room id")

const chatTextSchema = z
  .string()
  .max(LIMITS.messageMaxLength, `message must be at most ${LIMITS.messageMaxLength} characters`)
  .refine((value) => value.trim().length > 0, "message must not be empty")
  .refine(
    (value) => !FORBIDDEN_MESSAGE_CHARS.test(value),
    "message must not contain control characters",
  )

export const clientMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("create"),
      username: usernameSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("join"),
      roomId: roomIdSchema,
      username: usernameSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("chat"),
      message: chatTextSchema,
    })
    .strict(),
])

/** Parses and validates a raw client frame. Never throws. */
export function parseClientMessage(raw: string): ParseClientMessageResult {
  let data: unknown

  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, message: "invalid JSON" }
  }

  const parsed = clientMessageSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "invalid message" }
  }

  return { ok: true, value: parsed.data satisfies ClientMessage }
}
