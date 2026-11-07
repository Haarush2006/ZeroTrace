import { expect, test, type Page, type WebSocketRoute } from "@playwright/test"

const ROOM_ID = "c".repeat(22)
const TTL_MS = 60 * 60 * 1000

type Wire = Record<string, unknown> & { type: string }

function ready(): Wire {
  return {
    type: "ready",
    roomId: ROOM_ID,
    expiresAt: Date.now() + TTL_MS,
    ttlMs: TTL_MS,
    history: [],
    users: ["Alice"],
  }
}

function presence(): Wire {
  return { type: "presence", users: ["Alice"] }
}

function send(ws: WebSocketRoute, message: Wire): void {
  ws.send(JSON.stringify(message))
}

/**
 * Replaces the real backend with a scripted one. Every create/join is answered
 * with a ready + presence pair, and `onConnection` gets a chance to script
 * extra behaviour for that connection.
 */
function fakeBackend(
  page: Page,
  onConnection?: (ws: WebSocketRoute, connection: number) => void,
): void {
  let connections = 0
  let messages = 0

  void page.routeWebSocket(/\/ws$/, (ws) => {
    connections += 1
    const connection = connections

    ws.onMessage((raw) => {
      let message: Wire
      try {
        message = JSON.parse(raw.toString()) as Wire
      } catch {
        return
      }

      if (message.type === "create" || message.type === "join") {
        send(ws, ready())
        send(ws, presence())
        onConnection?.(ws, connection)
        return
      }

      if (message.type === "chat") {
        messages += 1
        send(ws, {
          type: "chat",
          id: `message-${messages}`,
          sender: "Alice",
          message: message.message,
          timestamp: Date.now(),
        })
      }
    })
  })
}

async function openRoom(page: Page): Promise<void> {
  await page.goto("/")
  await page.getByLabel("Username").fill("Alice")
  await page.getByRole("button", { name: "Create a room" }).click()
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
}

test.describe("expiry and reconnect (scripted socket)", () => {
  test("presence refreshes the countdown using the server deadline", async ({ page }) => {
    fakeBackend(page)
    await openRoom(page)
    // Use a second routed test connection script with a short initial deadline.
    await page.routeWebSocket(/\/ws$/, (ws) => {
      ws.onMessage(() => {
        send(ws, { ...ready(), expiresAt: Date.now() + 5000 })
        send(ws, { ...presence(), expiresAt: Date.now() + 120_000 })
      })
    })
    await page.reload()
    await expect(page.getByText(/expires in [12]:/)).toBeVisible()
  })

  test("exhausted reconnect attempts show an actionable error", async ({ page }) => {
    await page.clock.install()
    await page.routeWebSocket(/\/ws$/, (ws) => {
      ws.onMessage(() => void ws.close({ code: 1011, reason: "unavailable" }))
    })
    await page.goto("/")
    await page.getByLabel("Username").fill("Alice")
    await page.getByRole("button", { name: "Create a room" }).click()
    for (const delay of [500, 1000, 2000, 4000, 8000, 10000]) {
      await expect(page.getByText("Reconnecting to the chat server…")).toBeVisible()
      await page.clock.runFor(delay + 100)
    }
    await expect(page.getByText("Can't reach the chat server. Is the backend running?")).toBeVisible()
    await expect(page.getByRole("button", { name: "Create a room" })).toBeEnabled()
  })

  test("a rejected create displays its error and allows a retry", async ({ page }) => {
    await page.routeWebSocket(/\/ws$/, (ws) => {
      ws.onMessage(() => send(ws, { type: "error", code: "rate_limited", message: "Slow down" }))
    })
    await page.goto("/")
    await page.getByLabel("Username").fill("Alice")
    await page.getByRole("button", { name: "Create a room" }).click()
    await expect(page.getByRole("alert").filter({ hasText: "Slow down" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Create a room" })).toBeEnabled()
  })

  test("an expired event replaces the chat with the expired screen", async ({ page }) => {
    fakeBackend(page, (ws) => {
      setTimeout(() => {
        send(ws, { type: "expired" })
        void ws.close({ code: 4001, reason: "room expired" })
      }, 500)
    })

    await openRoom(page)

    await expect(page.getByRole("heading", { name: "This room is gone" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Create a new room" })).toBeVisible()
    await expect(page).not.toHaveURL(/#r=/)
  })

  test("a dropped socket reconnects and rejoins the same room", async ({ page }) => {
    fakeBackend(page, (ws, connection) => {
      if (connection === 1) {
        // Drop the first connection shortly after the room opens.
        setTimeout(() => void ws.close({ code: 1011, reason: "server restarted" }), 500)
      }
    })

    await openRoom(page)

    // The hook retries after 500 ms and shows the paused banner in between.
    await expect(page.getByText("Reconnecting… messages are paused.")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText("Reconnecting… messages are paused.")).toBeHidden({
      timeout: 10_000,
    })

    await expect(page.getByText("Connected")).toBeVisible()
    await expect(page.getByRole("heading", { level: 1 })).toContainText("#cccccccc")
  })

  test("the room keeps working after a reconnect", async ({ page }) => {
    fakeBackend(page, (ws, connection) => {
      if (connection === 1) {
        setTimeout(() => void ws.close({ code: 1011, reason: "server restarted" }), 300)
      }
    })

    await openRoom(page)
    await expect(page.getByText("Connected")).toBeVisible({ timeout: 15_000 })

    await page.getByLabel("Message", { exact: true }).fill("still here")
    await page.getByLabel("Send message").click()

    await expect(page.getByText("still here")).toBeVisible()
  })
})
