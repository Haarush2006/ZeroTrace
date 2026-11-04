import { expect, test, type Page } from "@playwright/test"

const ROOM_ID = /#r=[A-Za-z0-9_-]{22}$/

async function createRoom(page: Page, username: string): Promise<string> {
  await page.goto("/")
  await page.getByLabel("Username").fill(username)
  await page.getByRole("button", { name: "Create a room" }).click()

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await expect(page).toHaveURL(ROOM_ID)

  const match = page.url().match(/#r=([A-Za-z0-9_-]{22})$/)
  if (!match) throw new Error(`unexpected url: ${page.url()}`)
  return match[1]!
}

test.describe("room lifecycle", () => {
  test.skip(
    !process.env.E2E_HAS_BACKEND,
    "requires the sibling RoomsBackend checkout for a real WebSocket server",
  )

  test("creates a room, shows presence and sends a message", async ({ page }) => {
    await createRoom(page, "Alice")

    // Presence renders as "Alice, Bob" in the title; the visible text maps the
    // current user to "You".
    await expect(page.locator('span[title="Alice"]')).toBeVisible()
    await expect(page.getByText("Connected")).toBeVisible()

    await page.getByLabel("Message", { exact: true }).fill("hello room")
    await page.getByLabel("Send message").click()

    await expect(page.getByText("hello room")).toBeVisible()
    await expect(page.getByText("you", { exact: true })).toBeVisible()
  })

  test("a second browser joins from the link and chats both ways", async ({ browser }) => {
    const aliceContext = await browser.newContext()
    const alice = await aliceContext.newPage()
    const roomId = await createRoom(alice, "Alice")
    await expect(alice.locator('span[title="Alice"]')).toBeVisible()

    // A fresh context has its own sessionStorage, so Bob must enter a username.
    const bobContext = await browser.newContext()
    const bob = await bobContext.newPage()
    await bob.goto(`/#r=${roomId}`)

    await expect(bob.getByLabel("Room link or code")).toHaveValue(roomId)
    await bob.getByLabel("Username").fill("Bob")
    await bob.getByRole("button", { name: "Join room" }).click()

    await expect(bob.getByRole("heading", { level: 1 })).toBeVisible()
    await expect(alice.getByText("Bob joined the room")).toBeVisible()
    await expect(alice.locator('span[title="Alice, Bob"]')).toBeVisible()

    await bob.getByLabel("Message", { exact: true }).fill("hi Alice")
    await bob.getByLabel("Send message").click()

    await expect(alice.getByText("hi Alice")).toBeVisible()
    await expect(bob.getByText("hi Alice")).toBeVisible()

    await aliceContext.close()
    await bobContext.close()
  })

  test("rejoining with a stored username happens without the form", async ({ page }) => {
    const roomId = await createRoom(page, "Alice")

    // Same session: a reload should rejoin automatically from the hash.
    await page.reload()

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`#r=${roomId}$`))
    await expect(page.getByText("Connected")).toBeVisible()
  })

  test("the copy button puts the room link on the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    const roomId = await createRoom(page, "Alice")

    await page.getByRole("button", { name: "Copy room link" }).click()
    await expect(page.getByRole("button", { name: "Copy room link" })).toHaveAttribute(
      "title",
      "Link copied",
    )

    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toContain(`#r=${roomId}`)
  })

  test("joining an unknown room shows the expired screen", async ({ page }) => {
    const unknownRoomId = "z".repeat(22)
    await page.goto(`/#r=${unknownRoomId}`)

    await page.getByLabel("Username").fill("Bob")
    await page.getByRole("button", { name: "Join room" }).click()

    await expect(page.getByRole("heading", { name: "This room is gone" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Create a new room" })).toBeVisible()
    await expect(page).not.toHaveURL(/#r=/)
  })
})
