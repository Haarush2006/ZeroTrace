/**
 * Re-export shim so backend modules can keep importing from `./protocol`.
 * The actual contract lives in the shared `@chat/protocol` workspace package.
 */
export * from "@chat/protocol"
export * from "@chat/protocol/schemas"
