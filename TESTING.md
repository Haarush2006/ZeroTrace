# Local test results and rerun guide

## Verified in this testing pass

Environment: Windows, Node 22, npm workspaces, Playwright browsers.

| Check | Result |
| --- | --- |
| Backend unit/integration suite | 73 passed |
| TypeScript across all workspaces | Passed |
| Frontend ESLint | Passed |
| Production build | Passed |
| Chromium production standalone browser suite | 24 passed |
| Firefox production browser suite | 23 passed; 1 clipboard-permission test skipped |
| Development Chromium suite | 21 passed before the final 3 browser cases were added; all 24 cases passed against production |
| Startup helper syntax / Git whitespace checks | Passed |

Firefox was tested against the production bundle using `next start`; Chromium
was subsequently tested through the corrected standalone startup helper against
the same bundle. Firefox's clipboard-denied fallback test passes. Its direct
clipboard readback test is skipped because the permission grant is Chromium-only.

These results describe executed checks, not a guarantee that every possible
device, network condition, or deployment has been tested.

## Bugs fixed

1. Expired rooms could leave existing sockets connected forever when a late
   join or departure deleted the room before the periodic sweep noticed it.
2. Rate-limited room creation remained on the creating screen, hiding the
   error and retry form.
3. Opening another room fragment in the same document did not trigger joining.
   Hash navigation and browser Back now update the room and connection.
4. Existing members did not receive the updated expiry when another user joined.
   Presence now carries the authoritative deadline.
5. All users behind Caddy shared its IP's room-creation bucket. Compose now
   enables explicit proxy trust; Caddy overwrites `X-Real-IP`. Direct runs ignore
   the header. Backend tests cover separate valid IPs, disabled trust, and invalid
   header fallback. Actual Caddy execution is still pending.
6. Local production startup used `next start` with standalone output, producing
   an unsupported-configuration warning. The startup helper now copies static
   assets/public files and runs the generated standalone server, like Docker.

Short backend TTLs are now logged in seconds, so 15 seconds prints `15s`, not
the confusing rounded `0 min`.

## Coverage

### Real browser and real backend

- Create/join, two-way chat, Enter submission, sender display, and presence.
- Unknown-room rejection; duplicate names ignoring case; reserved names.
- Idle expiry while occupied, saved expired links, empty grace, quick rejoin.
- Room/user capacity and reclaiming capacity after expiry/departure.
- Bounded history after refresh; Unicode and HTML displayed as text.
- Separate-room isolation and simultaneous messages delivered once.
- Real socket termination and automatic rejoin; backend restart losing rooms.
- Invalid room codes, username length boundary, blank messages, 4,096-character messages.
- Hash navigation and browser Back; clipboard success/fallback.
- Keyboard focus/submission and a 375px mobile viewport with long content.

The edge-case suite redirects only the chat WebSocket URL to its own ephemeral
server port. It does not fabricate protocol responses. Each test uses an isolated
real backend; Next's hot-reload WebSocket remains untouched.

### Backend/protocol tests

- Invalid JSON, missing/extra fields, control characters, oversized messages/frames.
- Server-owned sender, timestamp and ID; chat before joining; second create.
- Origin/path rejection and health endpoint.
- Message flood limits, token refill and room-creation limits.
- Concurrent contention for the last membership slot.
- Heartbeat cleanup of a client that does not answer pings.
- Backpressure cleanup with a simulated saturated socket buffer.
- Expired-but-unswept rooms, message/join TTL resets, empty grace that never
  extends an earlier idle deadline, history trimming and capacity limits.
- Normal chat/expiry logs exclude content and room IDs.

### Scripted browser failure tests

- Server expiry notifications and close codes.
- Reconnect banner and recovery.
- Exhausting reconnect attempts (browser clock advanced deterministically).
- Rate-limited creation returning to an actionable error form.
- Presence updating the expiry countdown.

## Rerun from Git Bash

Run commands from the repository root. Stop existing dev servers first. Restore
any custom `.env` test overrides; these tests should not inherit short expiry or
small-capacity settings accidentally. No `.env` file is required.

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

Development browser tests use ports 3100 and 8081. Do not run builds and these
tests concurrently: the shared protocol build replaces its generated files.

Production standalone (ports 3100 and 8080):

```bash
NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws npm run build
E2E_PRODUCTION=1 npm run test:e2e
```

Firefox:

```bash
npx playwright install firefox
E2E_PRODUCTION=1 E2E_BROWSER=firefox npm run test:e2e
```

Default browser is Chromium; install it with `npx playwright install chromium`
if Playwright reports a missing executable. Tests manage their own servers.

To run the built app yourself, use two terminals:

```bash
npm run start:backend
```

```bash
npm run start:frontend
```

Open `http://localhost:3000`. Set `PORT` in the frontend terminal to change its
port; update the backend origin allowlist to match. The WebSocket URL is baked
into the frontend at build time.

## Remaining checks

- Docker image builds and actual Caddy routing/TLS/WSS: blocked locally because
  Docker and Caddy are not installed.
- Real phones, Safari/WebKit, screen-reader testing and 200% browser zoom.
- Long-duration/high-concurrency load testing and OS-level network partition
  recovery. Heartbeat, simulated backpressure, and socket termination tests
  cover individual mechanisms, not all real-world network conditions.
- Production proxy-header overwrite behavior through the actual deployed stack.

No application data is persisted by these tests. Playwright may retain failure
videos/traces containing synthetic test messages in gitignored test directories.
