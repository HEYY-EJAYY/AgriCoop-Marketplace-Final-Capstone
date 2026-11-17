import { expect, test } from "@playwright/test";

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
    };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe("public marketplace journeys", () => {
  test("home and marketplace load without horizontal overflow", async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /AgriCoop/i }).first()).toBeVisible();
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

  test("search, product detail, and auth entrypoints work", async ({ page }) => {
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { name: /Find harvests/i })).toBeVisible({ timeout: 30_000 });

    const search = page.getByRole("search").getByPlaceholder(/Search produce/i).first();
    if (await search.isVisible()) {
      await search.fill("a");
      await search.press("Enter");
    }

    const productLink = page.locator('a[href^="/products/"]').first();
    if (await productLink.count()) {
      await productLink.click();
      await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Price|Available stock|Minimum order/i).first()).toBeVisible();
      await assertNoHorizontalOverflow(page);
    }

    await page.goto("/auth");
    await expect(page.getByRole("button", { name: /sign in|join|create/i }).first()).toBeVisible({ timeout: 20_000 });
    await assertNoHorizontalOverflow(page);
  });

  test("health API is reachable", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBeTruthy();
  });
});
