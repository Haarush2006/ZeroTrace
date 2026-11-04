# Ephemeral Rooms — Frontend

Next.js client for [RoomsBackend](../RoomsBackend). Create a room, share the
link, and chat. Rooms self-destruct after a period of inactivity, and nothing is
written to disk.

## How it works

- There is no room list and no "pick a room id" form. A room is only created by
  pressing **Create a room**; the server generates the id.
- The room id lives in the URL fragment: `https://host/#r=<roomId>`. Fragments
  are never sent to the server, so the room id does not end up in access logs.
- Opening a link with a fragment either joins automatically (if a username is
  already stored in `sessionStorage`) or pre-fills the join form.
- Joining a room that has expired returns `room_not_found` and shows the
  "This room is gone" screen. There is no auto-create on join.
- A dropped connection retries with exponential backoff (6 attempts, 500 ms up
  to 10 s) and rejoins the same room. Reconnecting does not create a new room.

## Setup

Run from the repository root:

```sh
npm install          # installs all workspaces and builds @chat/protocol
npm run dev:backend  # terminal 1
npm run dev:frontend # terminal 2, http://localhost:3000
```

Or work inside this folder after a root install:

```sh
cp .env.example .env.local
npm run dev
```

Start the backend first — see `../RoomsBackend` (default `ws://localhost:8080/ws`).

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:8080/ws` | WebSocket endpoint of the backend |

For production, use a TLS endpoint: `NEXT_PUBLIC_WS_URL=wss://rooms.example.com/ws`.
The backend only accepts connections whose `Origin` header is in its
`ALLOWED_ORIGINS` list, so the deployed frontend origin must be added there.

## Privacy model (honest version)

- **Ephemeral, not encrypted.** Messages are held in the backend's memory and
  the server can read them. There is no end-to-end encryption.
- No database, no message log, no analytics, no tracking. The backend logs
  lifecycle events (startup, expiry counts, errors), never message content.
- When a room expires, its messages and members are deleted and every connected
  socket is closed with code `4001`.
- Nothing survives a backend restart.

## Scripts

Run these from this folder, or from the repository root with `npm run <script> -w roomfrontend`:

```sh
npm run dev             # development server
npm run build           # production build (standalone output)
npm start               # serve the production build
npm run lint            # eslint
npm run typecheck       # tsc --noEmit
npm run test:e2e        # Playwright (starts frontend + backend)
```

## Tests

Playwright covers two layers:

- **Real backend** (`e2e/room.spec.ts`): create a room, join from a second
  browser context via the link, exchange messages, copy the link, reload and
  auto-rejoin, and open an expired link. These skip automatically if the
  sibling `../RoomsBackend` checkout is not present.
- **Scripted socket** (`e2e/resilience.spec.ts`): `page.routeWebSocket` drives
  the `expired` event, a dropped connection with reconnect, and sending after
  reconnect. No backend required.

## Deployment

`../docker-compose.yml` builds this app as a Next.js standalone server behind
Caddy. The image builds from the repository root because the protocol package is
a workspace dependency. `NEXT_PUBLIC_WS_URL` is baked in at build time — rebuild
the image when the public URL changes. See the root README for the full compose
setup.

## Project structure

- `app/page.tsx` — screen routing: landing, chat, expired, splash
- `hooks/use-room.ts` — connection state machine, reconnect, room actions
- `lib/protocol.ts` — re-exports `@chat/protocol` plus room-link parsing
- `lib/config.ts` — `NEXT_PUBLIC_WS_URL`
- `components/landing.tsx` — create/join form
- `components/chat-panel.tsx` — header, expiry countdown, presence, share
- `components/message-list.tsx`, `components/message-input.tsx`
- `e2e/` — Playwright suites
- `Dockerfile` — standalone production image (context: repository root)

The wire contract lives in `../packages/protocol` and is shared with the
backend, so limits, close codes and message types cannot drift.

## Author

Haarush
