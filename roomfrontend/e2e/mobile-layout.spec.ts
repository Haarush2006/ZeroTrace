import { expect, test, type Page } from "@playwright/test"

// iPhone 16 CSS viewport. Actual iOS keyboard/zoom behavior still needs a device check.
test.use({ viewport: { width: 393, height: 852 } })

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true)
}

test("mobile inputs stay at 16px and landing does not overflow", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByLabel("Username")).toBeVisible()
  await expect(page.getByLabel("Username")).toHaveCSS("font-size", "16px")
  await page.getByRole("button", { name: "Join with link" }).click()
  await expect(page.getByLabel("Room link or code")).toHaveCSS("font-size", "16px")
  await page.getByLabel("Room link or code").fill("https://example.com/#r=" + "a".repeat(200))
  await expectNoHorizontalOverflow(page)
})

test("mobile chat wraps long content and fits a shorter viewport", async ({ page }) => {
  const longMessage = "a".repeat(2000)
  await page.routeWebSocket(/\/ws$/, (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(raw.toString())
      if (message.type !== "create") return
      ws.send(JSON.stringify({
        type: "ready",
        roomId: "a".repeat(22),
        expiresAt: Date.now() + 1_800_000,
        ttlMs: 1_800_000,
        users: ["Alice", "b".repeat(24)],
        history: [{
          type: "chat",
          id: "mobile-message",
          sender: "b".repeat(24),
          message: longMessage,
          timestamp: Date.now(),
        }],
      }))
    })
  })
  await page.goto("/")
  await page.getByLabel("Username").fill("Alice")
  await page.getByRole("button", { name: "Create a room" }).click()
  const input = page.getByRole("textbox", { name: "Message", exact: true })
  await expect(input).toBeEnabled()
  await expect(input).toHaveCSS("font-size", "16px")
  await input.fill("Mobile send")
  await page.getByRole("button", { name: "Send message", exact: true }).click()
  await expect(input).toHaveValue("")
  await expect(input).not.toBeFocused()
  await page.setViewportSize({ width: 1024, height: 852 })
  await input.fill("Desktop send")
  await page.getByRole("button", { name: "Send message", exact: true }).click()
  await expect(input).toHaveValue("")
  await expect(input).toBeFocused()
  await page.setViewportSize({ width: 393, height: 852 })
  await expectNoHorizontalOverflow(page)
  const messages = page.getByText(longMessage, { exact: true }).locator("..").locator("..")
  expect(await messages.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)

  // Simulates a smaller viewport, not the actual iOS on-screen keyboard.
  await page.setViewportSize({ width: 393, height: 430 })
  await expectNoHorizontalOverflow(page)
  await expect.poll(async () => {
    const bounds = await input.boundingBox()
    return bounds !== null && bounds.y >= 0 && bounds.y + bounds.height <= 430
  }).toBe(true)
})

test("chat controls do not overlap and consecutive messages share a sender label", async ({ page }) => {
  await page.routeWebSocket(/\/ws$/, (ws) => {
    ws.onMessage((raw) => {
      if (JSON.parse(raw.toString()).type !== "create") return
      const timestamp = Date.now()
      const chat = (id: string, sender: string) => ({
        type: "chat", id, sender, message: `Message ${id}`, timestamp,
      })
      ws.send(JSON.stringify({
        type: "ready",
        roomId: "a".repeat(22),
        expiresAt: timestamp + 1_800_000,
        ttlMs: 1_800_000,
        users: ["Alice", "Max"],
        history: [
          chat("1", "Max"),
          chat("2", "Max"),
          chat("3", "Alice"),
          chat("4", "Max"),
          { type: "system", id: "notice", sender: "system", message: "A user joined", timestamp },
          chat("5", "Max"),
        ],
      }))
    })
  })
  await page.goto("/")
  await page.getByLabel("Username").fill("Alice")
  await page.getByRole("button", { name: "Create a room" }).click()
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled()
  await expect(page.getByText("Max", { exact: true })).toHaveCount(3)
  await expect(page.getByText("you", { exact: true })).toHaveCount(1)
  await expect(page.locator("time")).toHaveCount(6)
  for (const time of await page.locator("time").all()) {
    await expect(time).toHaveText(/^\d{1,2}:\d{2} [AP]M$/)
  }
  for (const width of [320, 393, 768]) {
    await page.setViewportSize({ width, height: 852 })
    await expect(page.getByRole("button", { name: "Toggle theme" })).toHaveCount(1)
    const toggle = await page.getByRole("button", { name: "Toggle theme" }).boundingBox()
    const leave = await page.getByRole("button", { name: "Leave", exact: true }).boundingBox()
    expect(toggle).not.toBeNull()
    expect(leave).not.toBeNull()
    expect(toggle!.x + toggle!.width).toBeLessThanOrEqual(leave!.x)
    await expectNoHorizontalOverflow(page)
  }
})
