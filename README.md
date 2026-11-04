# Ephemeral Rooms

A private-by-ephemerality chat app. Rooms exist only in the backend's memory and
are destroyed after a period of inactivity. There is no database, no message
log, no analytics, and no accounts.

```
Browser ──HTTPS/WSS──► Caddy ──► Next.js frontend (room UI)
                          └────► RoomsBackend (rooms + WebSocket /ws)
```

- **RoomsBackend** — Node + `ws` + Zod. Owns room lifecycle, rate limits,
  presence, and expiry. Single instance, in-memory.
- **roomfrontend** — Next.js 16 client. Room links are `#r=<roomId>` fragments,
  so the room capability is never sent in an HTTP request or access log.
- **`packages/protocol`** (`@chat/protocol`) — the shared wire contract: size
  limits, close codes, message types, and the Zod schemas the backend validates
  with. The frontend imports only the Zod-free main entry, so Zod never enters
  the browser bundle.

## Quick start

Requires Node.js 22+.

```sh
npm install          # installs all workspaces and builds @chat/protocol
npm run dev:backend  # http://localhost:8080/ws, /health
# in a second terminal:
npm run dev:frontend # http://localhost:3000
```

Create a room, copy the link, open it in another browser profile, and chat.

## Workspace commands

Run these from the repository root:

```sh
npm run build           # protocol + backend + frontend
npm run build:backend   # protocol + backend
npm run build:frontend  # protocol + frontend (standalone output)
npm test                # backend Vitest suite (63 tests)
npm run typecheck       # protocol + backend + frontend
npm run lint            # frontend ESLint
npm run test:e2e        # Playwright; starts both servers
```

The protocol must be built before anything imports `@chat/protocol`; the root
`postinstall` does this automatically after `npm install`.

## Tests

```sh
npm test        # backend protocol/lifecycle tests
npm run test:e2e
```

Playwright starts both servers itself. Expiry and reconnect run against a
scripted socket so they are deterministic; create/join/chat/expired-link run
against the real backend.

## Deploy with Docker Compose

```sh
cp .env.example .env
# edit PUBLIC_ADDRESS / PUBLIC_ORIGIN / PUBLIC_WS_URL for your domain
docker compose up -d --build
```

The compose file runs three containers:

| Service | Role |
| --- | --- |
| `backend` | WebSocket + health endpoint, port 8080 (internal only) |
| `frontend` | Next.js standalone server, port 3000 (internal only) |
| `caddy` | TLS termination and reverse proxy, ports 80/443 |

Both images build from the repository root so they can install the shared
workspace package.

For a real domain set:

```env
PUBLIC_ADDRESS=chat.example.com
PUBLIC_ORIGIN=https://chat.example.com
PUBLIC_WS_URL=wss://chat.example.com/ws
```

Caddy obtains and renews the certificate automatically. WebSocket upgrades are
proxied to the backend on `/ws`; `GET /health` is proxied too so uptime checks
work through the edge.

> `NEXT_PUBLIC_WS_URL` is inlined into the browser bundle at build time. After
> changing it, run `docker compose up -d --build frontend` again.

## Production notes

- **Single instance only.** Rooms live in process memory. Running multiple
  replicas would split rooms across processes and break links.
- **TLS is mandatory in production.** Use `wss://`; the backend itself speaks
  plain HTTP and expects a reverse proxy in front.
- **Origin allowlist.** The backend rejects WebSocket upgrades unless `Origin`
  exactly matches an entry in `ALLOWED_ORIGINS`. Keep it in sync with
  `PUBLIC_ORIGIN`.
- **No end-to-end encryption.** The server can read message plaintext. The
  privacy guarantee is ephemerality: nothing is written to disk and rooms
  self-destruct after inactivity.
- **No content logging.** Logs cover lifecycle events and errors only.
- **Capacity.** Defaults: 5,000 rooms, 50 users/room, 500 messages/room,
  16 KB frames, 30-minute idle TTL, 2-minute empty grace.

See `RoomsBackend/README.md` for the full protocol and configuration table.

## CI

`.github/workflows/ci.yml` runs the whole workspace on Node 22:

1. `npm ci`
2. typecheck, backend tests, lint, build
3. `npm audit --omit=dev`
4. Playwright end-to-end tests, uploading the report on failure

## Repository layout

```
package.json            npm workspaces + root scripts
packages/protocol/      @chat/protocol (types, limits, close codes, Zod schemas)
RoomsBackend/           WebSocket server
roomfrontend/           Next.js app, Playwright suites
docker-compose.yml      backend + frontend + Caddy
Caddyfile               TLS termination and reverse proxy
```

> `RoomsBackend/` and `roomfrontend/` were merged into this repository with
> their commit histories rewritten under those folders. The two old `.git`
> directories are no longer present; the root repository is now the single
> source of truth.
