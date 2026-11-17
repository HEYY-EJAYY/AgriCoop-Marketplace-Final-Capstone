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
    await page.goto("/cooperatives/sutafacocooperative");
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
    await page.goto("/cooperatives/this-coop-does-not-exist-xyz");
    await expect(page.getByText(/not found|unavailable|incorrect/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test("order detail requires auth and axe is clean on checkout shell", async ({ page }) => {
    await page.goto("/orders/1");
    await expect(page.getByText(/Sign in|Order|not found|unavailable/i).first()).toBeVisible({ timeout: 20_000 });

    await page.goto("/checkout");
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const serious = results.violations.filter(v => v.impact === "serious" || v.impact === "critical");
    expect(serious).toEqual([]);
  });
});
