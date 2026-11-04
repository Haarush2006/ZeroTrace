/**
 * In production this must point at the deployed backend, e.g.
 * NEXT_PUBLIC_WS_URL=wss://rooms.example.com/ws
 */
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws"
