import { expect, test as base, type Page } from "@playwright/test"
import { loadConfig, type AppConfig } from "../../RoomsBackend/src/config"
import { createChatServer, silentLogger, type ChatServer } from "../../RoomsBackend/src/server"

// Every test owns a real backend on an ephemeral port. Redirect only the URL:
// frames still travel over a native browser WebSocket to the production handler.
const test = base.extend<{
  backend: (page: Page, overrides?: Partial<AppConfig>) => Promise<ChatServer>
}>({
  backend: async ({}, provide) => {
    const servers: ChatServer[] = []
    await provide(async (page, overrides = {}) => {
      const server = createChatServer({
        ...loadConfig({ NODE_ENV: "test" }),
        allowedOrigins: ["http://localhost:3100"],
        ttlMs: 60_000,
        sweepMs: 50,
        ...overrides,
      }, { logger: silentLogger })
      servers.push(server)
      const { port } = await server.listen(0, "127.0.0.1")
      await page.context().addInitScript((url) => {
        const NativeWebSocket = window.WebSocket
        window.WebSocket = class extends NativeWebSocket {
          constructor(originalUrl: string | URL, protocols?: string | string[]) {
            super(new URL(originalUrl, window.location.href).pathname === "/ws" ? url : originalUrl, protocols)
          }
        }
      }, `ws://127.0.0.1:${port}/ws`)
      return server
    })
    for (const server of servers) await server.close()
  },
})

async function create(page: Page, username = "Alice"): Promise<string> {
  await page.goto("/")
  await page.getByLabel("Username").fill(username)
  await page.getByRole("button", { name: "Create a room" }).click()
  await expect(page.getByText("Connected", { exact: true })).toBeVisible()
  return page.url()
}

async function join(page: Page, url: string, username: string): Promise<void> {
  await page.goto(url)
  await page.getByLabel("Username").fill(username)
  await page.getByRole("button", { name: "Join room", exact: true }).click()
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByLabel("Message", { exact: true }).fill(text)
  await page.getByLabel("Message", { exact: true }).press("Enter")
  await expect(page.getByText(text, { exact: true })).toBeVisible()
}

test("real idle timer expires an occupied room and its saved link", async ({ page, backend }) => {
  await backend(page, { ttlMs: 2000 })
  const url = await create(page)
  await expect(page.getByRole("heading", { name: "This room is gone" })).toBeVisible()
  await page.goto(url)
  await expect(page.getByRole("heading", { name: "This room is gone" })).toBeVisible()
})

test("empty grace permits a quick rejoin then destroys an abandoned room", async ({ page, backend }) => {
  const server = await backend(page, { emptyGraceMs: 3000 })
  const url = await create(page)
  await page.getByRole("button", { name: "Leave", exact: true }).click()
  await page.goto(url)
  await expect(page.getByText("Connected", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Leave", exact: true }).click()
  await expect.poll(() => server.store.size).toBe(0)
  await page.goto(url)
  await expect(page.getByRole("heading", { name: "This room is gone" })).toBeVisible()
})

test("duplicate names are case insensitive and a freed slot can be reused", async ({ page, context, backend }) => {
  await backend(page, { maxUsersPerRoom: 2 })
  const url = await create(page)
  const bob = await context.newPage()
  await join(bob, url, "alice")
  await expect(bob.getByText("That username is already taken in this room")).toBeVisible()
  await bob.getByLabel("Username").fill("Bob")
  await bob.getByRole("button", { name: "Join room", exact: true }).click()
  await expect(page.locator('span[title="Alice, Bob"]')).toBeVisible()
  const charlie = await context.newPage()
  await join(charlie, url, "Charlie")
  await expect(charlie.getByText("This room is full")).toBeVisible()
  await bob.getByRole("button", { name: "Leave", exact: true }).click()
  await expect(page.locator('span[title="Alice"]')).toBeVisible()
  await charlie.getByRole("button", { name: "Join room", exact: true }).click()
  await expect(page.locator('span[title="Alice, Charlie"]')).toBeVisible()
})

test("history is bounded and HTML and Unicode are rendered as text", async ({ page, backend }) => {
  await backend(page, { maxMessagesPerRoom: 3 })
  await create(page)
  for (const text of ["old-one", "old-two", "こんにちは 👋", '<script>alert("test")</script>', "newest"]) {
    await send(page, text)
  }
  await page.reload()
  await expect(page.getByText("newest", { exact: true })).toBeVisible()
  await expect(page.getByText("old-one", { exact: true })).toHaveCount(0)
  await expect(page.getByText("old-two", { exact: true })).toHaveCount(0)
  await expect(page.getByText("こんにちは 👋", { exact: true })).toBeVisible()
  await expect(page.getByText('<script>alert("test")</script>', { exact: true })).toBeVisible()
})

test("room capacity is reclaimed after empty expiry", async ({ page, context, backend }) => {
  const server = await backend(page, { maxRooms: 1, emptyGraceMs: 500 })
  await create(page)
  const other = await context.newPage()
  await other.goto("/")
  await other.getByLabel("Username").fill("Bob")
  await other.getByRole("button", { name: "Create a room" }).click()
  await expect(other.getByText("The server is at capacity, try again later")).toBeVisible()
  await page.getByRole("button", { name: "Leave", exact: true }).click()
  await expect.poll(() => server.store.size).toBe(0)
  await other.getByRole("button", { name: "Create a room" }).click()
  await expect(other.getByText("Connected", { exact: true })).toBeVisible()
})

test("rooms are isolated and simultaneous messages arrive once", async ({ page, context, backend }) => {
  await backend(page)
  const url = await create(page)
  const bob = await context.newPage()
  await join(bob, url, "Bob")
  await expect(bob.getByText("Connected", { exact: true })).toBeVisible()
  const other = await context.newPage()
  await create(other, "Charlie")
  await Promise.all([send(page, "from-alice"), send(bob, "from-bob"), send(other, "private-room")])
  for (const member of [page, bob]) {
    await expect(member.getByText("from-alice", { exact: true })).toHaveCount(1)
    await expect(member.getByText("from-bob", { exact: true })).toHaveCount(1)
    await expect(member.getByText("private-room", { exact: true })).toHaveCount(0)
  }
  await expect(other.getByText("from-alice", { exact: true })).toHaveCount(0)
})

test("real socket termination reconnects without losing the room", async ({ page, backend }) => {
  const server = await backend(page)
  const url = await create(page)
  await send(page, "before-reconnect")
  for (const socket of server.wss.clients) socket.terminate()
  await expect(page.getByText("Reconnecting… messages are paused.")).toBeVisible()
  await expect(page.getByLabel("Message", { exact: true })).toBeDisabled()
  await expect(page.getByText("Connected", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(url)
  await expect(page.getByText("before-reconnect", { exact: true })).toHaveCount(1)
  await send(page, "after-reconnect")
})

test("backend restart reconnects to an empty store and shows room gone", async ({ page, backend }) => {
  const server = await backend(page)
  await create(page)
  const address = server.httpServer.address()
  if (!address || typeof address === "string") throw new Error("missing server address")
  await server.close()
  const replacement = createChatServer({ ...loadConfig({ NODE_ENV: "test" }), allowedOrigins: ["http://localhost:3100"] }, { logger: silentLogger })
  try {
    await replacement.listen(address.port, "127.0.0.1")
    await expect(page.getByRole("heading", { name: "This room is gone" })).toBeVisible()
  } finally {
    await replacement.close()
  }
})

test("input limits, reserved names, and invalid codes fail visibly", async ({ page, backend }) => {
  await backend(page)
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Create a room" })).toBeDisabled()
  await page.getByLabel("Username").fill("SYSTEM")
  await page.getByRole("button", { name: "Create a room" }).click()
  await expect(page.getByText('"system" is a reserved username')).toBeVisible()
  await page.getByRole("button", { name: "Join with link" }).click()
  await page.getByLabel("Room link or code").fill("nonexistent")
  await page.getByRole("button", { name: "Join room", exact: true }).click()
  await expect(page.getByText("That doesn't look like a valid room link or code.")).toBeVisible()
  await page.getByRole("button", { name: "Create room", exact: true }).click()
  await page.getByLabel("Username").fill("A".repeat(32))
  await page.getByLabel("Username").press("End")
  await page.getByLabel("Username").press("B")
  await expect(page.getByLabel("Username")).toHaveValue("A".repeat(32))
  await page.getByRole("button", { name: "Create a room" }).click()
  await page.getByLabel("Message", { exact: true }).fill("   ")
  await expect(page.getByLabel("Send message")).toBeDisabled()
  await send(page, "x".repeat(4096))
})

test("mobile layout accommodates long messages without page overflow", async ({ page, backend }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await backend(page)
  await create(page, "A".repeat(32))
  await send(page, "x".repeat(4096))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByRole("button", { name: "Leave", exact: true })).toBeInViewport()
  await expect(page.getByLabel("Send message")).toBeInViewport()
})

test("hash navigation and browser Back switch rooms", async ({ page, context, backend }) => {
  await backend(page)
  const first = await create(page)
  await send(page, "first-room-history")
  const other = await context.newPage()
  const second = await create(other, "Bob")
  await send(other, "second-room-history")
  await page.goto(second)
  await expect(page.getByText("second-room-history", { exact: true })).toBeVisible()
  await expect(page.getByText("first-room-history", { exact: true })).toHaveCount(0)
  await page.goBack()
  await expect(page).toHaveURL(first)
  await expect(page.getByText("first-room-history", { exact: true })).toBeVisible()
  await expect(page.getByText("second-room-history", { exact: true })).toHaveCount(0)
})

test("clipboard denial provides a prompt containing the room link", async ({ page, backend }) => {
  await backend(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("permission denied")) },
    })
  })
  const url = await create(page)
  const prompt = page.waitForEvent("dialog")
  const click = page.getByRole("button", { name: "Copy room link" }).click()
  const dialog = await prompt
  expect(dialog.type()).toBe("prompt")
  expect(dialog.defaultValue()).toBe(url)
  await dialog.dismiss()
  await click
})

test("keyboard submission and focus remain usable", async ({ page, backend }) => {
  await backend(page)
  await page.goto("/")
  await page.getByLabel("Username").focus()
  await page.keyboard.type("KeyboardUser")
  await page.keyboard.press("Enter")
  await expect(page.getByLabel("Message", { exact: true })).toBeFocused()
  await page.keyboard.type("keyboard-message")
  await page.keyboard.press("Enter")
  await expect(page.getByText("keyboard-message", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Message", { exact: true })).toBeFocused()
})
