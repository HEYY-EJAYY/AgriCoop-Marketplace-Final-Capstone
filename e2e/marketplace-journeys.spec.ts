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

  test("marketplace search filter and sort in URL", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { name: /Find harvests/i })).toBeVisible({ timeout: 30_000 });

    const isMobile = testInfo.project.name.startsWith("mobile");
    if (isMobile) {
      await page.getByRole("button", { name: /Filters & sort/i }).click();
      await expect(page.getByRole("heading", { name: /^Filters$/i })).toBeVisible();
    }

    const search = page.getByPlaceholder(/Produce, category, farmer/i).filter({ visible: true }).first();
    await search.fill("rice");
    await expect(page).toHaveURL(/q=rice/i, { timeout: 15_000 });

    const sort = page
      .locator("#marketplace-sort-desktop, #marketplace-mobile-sort")
      .filter({ visible: true })
      .first();
    await sort.selectOption("price_desc");
    await expect(page).toHaveURL(/sort=price_desc/i, { timeout: 15_000 });
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

  test("two marketplace listings use distinct non-hero image sources", async ({ page }) => {
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { name: /Find harvests/i })).toBeVisible({ timeout: 30_000 });
    const images = page.locator('[data-testid="product-image"]');
    const count = await images.count();
    test.skip(count < 2, "Need at least two marketplace listings with product images");
    const srcA = await images.nth(0).getAttribute("data-image-src");
    const srcB = await images.nth(1).getAttribute("data-image-src");
    expect(srcA).toBeTruthy();
    expect(srcB).toBeTruthy();
    expect(srcA).not.toEqual(srcB);
    expect(srcA).not.toMatch(/hero-banner/i);
    expect(srcB).not.toMatch(/hero-banner/i);
  });
});
