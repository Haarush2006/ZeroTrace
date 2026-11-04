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
