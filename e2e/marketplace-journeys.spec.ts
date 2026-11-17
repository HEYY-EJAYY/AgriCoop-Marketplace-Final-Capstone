import { expect, test } from "@playwright/test";

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe("public marketplace journeys", () => {
  test("logged-out header has no search or cart", async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /AgriCoop/i }).first()).toBeVisible();
    await expect(page.locator("#agri-market-search")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Open order basket/i })).toHaveCount(0);
    if (testInfo.project.name.startsWith("desktop")) {
      await expect(page.getByRole("navigation", { name: /Primary/i }).getByRole("link", { name: "Marketplace" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Join AgriCoop/i })).toBeVisible();
    }
    await assertNoHorizontalOverflow(page);
  });

  test("home and marketplace load without horizontal overflow", async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Local harvest/i })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { name: /Find harvests/i })).toBeVisible({ timeout: 30_000 });
    await assertNoHorizontalOverflow(page);
    if (testInfo.project.name.startsWith("desktop")) {
      const header = page.locator("header").first();
      const box = await header.boundingBox();
      expect(box?.height ?? 999).toBeLessThanOrEqual(96);
    }
  });

  test("marketplace search filter and sort in URL", async ({ page }) => {
    await page.goto("/marketplace?q=rice&sort=price_desc&page=1");
    await expect(page.getByRole("heading", { name: /Find harvests/i })).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/q=rice/i);
    await expect(page).toHaveURL(/sort=price_desc/i);
    await assertNoHorizontalOverflow(page);
  });

  test("search, product detail, and auth entrypoints work", async ({ page }) => {
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { name: /Find harvests/i })).toBeVisible({ timeout: 30_000 });
    const productLink = page.locator('a[href^="/products/"]').first();
    if (await productLink.count()) {
      await productLink.click();
      await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
      await assertNoHorizontalOverflow(page);
    }
    await page.goto("/auth");
    await expect(page.getByRole("button", { name: /sign in|join|create/i }).first()).toBeVisible({ timeout: 20_000 });
  });

  test("profile and messages routes require auth shell", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByText(/Sign in|My Profile|profile/i).first()).toBeVisible({ timeout: 20_000 });
    await page.goto("/messages");
    await expect(page.getByText(/Sign in|Messages|Order/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test("health API is reachable", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBeTruthy();
  });
});
