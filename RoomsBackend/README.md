# RoomsBackend

Ephemeral chat rooms over WebSocket. Rooms exist only in memory: no database, no
message log, no analytics. A room is destroyed after a configured period of
inactivity, and empty rooms disappear within a short grace window.

## Features

- Multiple rooms on one process, each addressed by a 128-bit unguessable room id
- Room ids, message ids, senders and timestamps are all assigned by the server
- Zod-validated protocol, size limits and per-connection rate limiting
- Origin allowlist on the WebSocket upgrade
- Presence tracking, join/leave notices and reconnect-friendly history
- Automatic expiry with a graceful `expired` event before the socket closes
- Heartbeat ping/pong to drop dead connections
- Graceful shutdown on `SIGINT` / `SIGTERM`
- No message content or usernames are logged

## Requirements

- Node.js 22 or newer (uses `--env-file-if-exists`)

## Running

Run from the repository root (the backend is an npm workspace):

```sh
npm install          # once, from the repo root
npm run dev:backend
```

Or from this folder after a root install:

```sh
npm install
cp .env.example .env   # optional, defaults are safe
npm run dev
```

The server listens on `http://localhost:8080` with the WebSocket endpoint at
`ws://localhost:8080/ws` and a health check at `GET /health`.

```sh
npm run build     # compile to dist/
npm start         # run the compiled server
npm test          # 63 unit + integration tests
npm run typecheck # typecheck src and tests
```

## Room lifecycle

```
create ──► active ──(last member leaves)──► empty ──► deleted after grace
             │
             └──(no messages/joins for TTL)──► expired ──► sockets closed (4001), state wiped
```

- **Activity** is a chat message or a join. Presence alone does not extend a room.
- `ROOM_TTL_MS` controls the idle lifetime (default 30 minutes).
- When the last member leaves, the expiry is pulled in to `ROOM_EMPTY_GRACE_MS`
  (default 2 minutes), so a refresh survives but an abandoned room does not.
- Only chat messages are kept in history (capped by `MAX_MESSAGES_PER_ROOM`).
  System notices are live-only.
- `expiresAt` is server-authoritative. Clients should only render it, never
  compute it locally.

## Protocol

Connect to `/ws`. An `Origin` header matching `ALLOWED_ORIGINS` is required.

### Client → server

```json
{ "type": "create", "username": "Alice" }
{ "type": "join", "roomId": "AbCdEfGhIjKlMnOpQrStUv", "username": "Bob" }
{ "type": "chat", "message": "Hello" }
```

A connection can be in one room at a time. Unknown fields are rejected.

### Server → client

```json
{ "type": "ready", "roomId": "...", "expiresAt": 1730000000000, "ttlMs": 1800000, "history": [], "users": ["Alice"] }
{ "type": "chat", "id": "...", "sender": "Alice", "message": "Hello", "timestamp": 1730000000000 }
{ "type": "system", "id": "...", "sender": "system", "message": "Bob joined the room", "timestamp": 1730000000000 }
{ "type": "presence", "users": ["Alice", "Bob"] }
{ "type": "expired" }
{ "type": "error", "code": "room_not_found", "message": "This room has expired or never existed" }
```

Error codes: `invalid_payload`, `room_not_found`, `room_full`, `username_taken`,
`already_joined`, `not_a_member`, `too_many_rooms`, `rate_limited`, `server_error`.

Close codes: `4001` room expired, `4008` rate limit exceeded, `1001` server
shutting down.

## Configuration

All values are read from the environment (see `.env.example`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP + WebSocket port |
| `ROOM_TTL_MS` | `1800000` | Idle lifetime of a room (30 min) |
| `ROOM_EMPTY_GRACE_MS` | `120000` | Lifetime after the last member leaves |
| `MAX_ROOMS` | `5000` | Hard cap on concurrent rooms |
| `MAX_MESSAGES_PER_ROOM` | `500` | History cap per room |
| `MAX_USERS_PER_ROOM` | `50` | Members per room |
| `MAX_PAYLOAD_BYTES` | `16384` | Largest accepted WebSocket frame |
| `HEARTBEAT_MS` | `30000` | Ping interval |
| `SWEEP_MS` | `15000` | Expiry sweep interval |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated origin allowlist |

Rate limits are built in: 20 messages instantly then 5/s per connection, and 20
room creations instantly then roughly one every 5 seconds per IP.

## Project structure

- `src/index.ts` — process entry point, signals
- `src/server.ts` — HTTP server, WebSocket upgrade, handlers, heartbeat, expiry
- `src/rooms.ts` — in-memory room store and lifecycle rules
- `src/protocol.ts` — re-export shim for the shared `@chat/protocol` package
- `src/config.ts` — environment configuration
- `src/rate-limit.ts` — token bucket
- `tests/` — unit and end-to-end WebSocket tests

The wire contract (limits, close codes, message types and Zod schemas) lives in
`../packages/protocol`. Change it there, then rebuild the workspace.

## Docker

Build from the **repository root** so the shared workspace package is available:

```sh
docker build -f RoomsBackend/Dockerfile -t ephemeral-rooms-backend .
docker run --rm -p 8080:8080 \
  -e ALLOWED_ORIGINS=http://localhost:3000 \
  ephemeral-rooms-backend
```

The image is a multi-stage Node 22 Alpine build that prunes dev dependencies,
runs as the unprivileged `node` user, and has a `HEALTHCHECK` against `/health`.
The root `docker-compose.yml` wires this service together with the frontend and
Caddy for TLS.

## Deployment note

The store is in-memory, so the backend must run as a **single instance**. Running
multiple replicas would split rooms across processes. Terminate TLS at a reverse
proxy (Caddy, nginx, Cloudflare) and point clients at `wss://host/ws`. Caddy must
forward `/ws` upgrades and `/health` to this service.

This service does not provide end-to-end encryption: the server sees message
plaintext. The privacy guarantee is ephemerality — nothing is written to disk and
rooms self-destruct.

## CI

`.github/workflows/ci.yml` runs typecheck, the full test suite, the build, and
`npm audit --omit=dev` on Node 22.

## Author

Haarush
