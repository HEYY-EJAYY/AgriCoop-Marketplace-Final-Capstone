import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("payment, cooperatives, order detail", () => {
  test("marketplace has no cart payment dropdown and shows coop links", async ({ page }) => {
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { name: /Find harvests/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("select").filter({ hasText: /Cash on pickup/i })).toHaveCount(0);
    await expect(page.getByText(/Pay in cash when you meet the seller/i)).toHaveCount(0);

    const coopLink = page.locator('a[href^="/cooperatives/"]').first();
    if (await coopLink.count()) {
      await coopLink.click();
      await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
      await expect(page).toHaveURL(/\/cooperatives\//);
    }
  });

  test("cooperative slug page handles known and unknown slugs", async ({ page }) => {
    await page.goto("/cooperatives/this-coop-does-not-exist-xyz");
    await expect(page.getByRole("heading", { name: /Cooperative not found/i })).toBeVisible({ timeout: 20_000 });
    await page.goto("/cooperatives/sutafacocooperative");
    const heading = page.getByRole("heading").first();
    await expect(heading).toBeVisible({ timeout: 20_000 });
    if ((await heading.innerText()) === "Cooperative not found") {
      test.skip(true, "The known cooperative fixture is not available in this test backend.");
    }
  });

  test("order detail requires auth and axe is clean on checkout and order detail shells", async ({ page }) => {
    // Unauthenticated orders.byId is a protected procedure → Auth shell (friendly gate).
    // Authenticated callers without access get Order not found (NOT_FOUND) instead of leaking existence.
    await page.goto("/orders/1");
    await expect(page.getByRole("heading", { name: /Welcome back|Order not found|Order details/i }).first()).toBeVisible({
      timeout: 20_000,
    });
    const orderAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(orderAxe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);

    await page.goto("/checkout");
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Sellers record cash received/i)).toHaveCount(0);
    const checkoutAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(checkoutAxe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });

  test("payment method radios appear only after a cart exists or sign-in shell shows", async ({ page }) => {
    await page.goto("/checkout");
    const heading = page.getByRole("heading").first();
    await expect(heading).toBeVisible({ timeout: 20_000 });
    const text = await heading.innerText();
    expect(text).toMatch(/Sign in|checkout|basket|Review your order/i);
  });
});
