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
