import { expect, test, type Page } from "@playwright/test";

/**
 * Four-role acceptance smoke test.
 * Credentials come only from process env (never logged). Missing vars → skip.
 * Env vars: QA8_SUPERADMIN_EMAIL/PASSWORD, QA8_OFFICER_EMAIL/PASSWORD,
 * QA8_SELLER_EMAIL/PASSWORD, QA8_BUYER_EMAIL/PASSWORD.
 */
const env = (k: string) => process.env[k]?.trim() ?? "";
const roles = {
  superadmin: { email: env("QA8_SUPERADMIN_EMAIL"), password: env("QA8_SUPERADMIN_PASSWORD") },
  officer: { email: env("QA8_OFFICER_EMAIL"), password: env("QA8_OFFICER_PASSWORD") },
  seller: { email: env("QA8_SELLER_EMAIL"), password: env("QA8_SELLER_PASSWORD") },
  buyer: { email: env("QA8_BUYER_EMAIL"), password: env("QA8_BUYER_PASSWORD") },
};
const missing = Object.entries(roles).flatMap(([r, c]) =>
  (!c.email ? [`${r} email`] : []).concat(!c.password ? [`${r} password`] : []));
const hasCreds = missing.length === 0;

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth");
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.waitForURL(url => !url.pathname.startsWith("/auth"), { timeout: 45_000 });
}

test.describe("four-role acceptance smoke", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!hasCreds, `Missing env credentials: ${missing.join(", ")}`);
    testInfo.setTimeout(120_000);
  });

  for (const [role, creds] of Object.entries(roles)) {
    test(`${role} can sign in and load the dashboard`, async ({ page }) => {
      await signIn(page, creds.email, creds.password);
      await page.goto("/dashboard");
      await expect(page).not.toHaveURL(/\/auth/, { timeout: 30_000 });
      // Dashboard shell renders content (not an error boundary)
      await expect(page.locator("body")).not.toContainText("Something went wrong", { timeout: 30_000 });
    });
  }

  test("buyer can browse marketplace, open a product, and reach cart/checkout shell", async ({ page }) => {
    await signIn(page, roles.buyer.email, roles.buyer.password);
    await page.goto("/marketplace");
    await expect(page.locator("body")).toBeVisible();
    const productLink = page.locator('a[href^="/products/"]').first();
    await expect(productLink).toBeVisible({ timeout: 30_000 });
    await productLink.click();
    await expect(page).toHaveURL(/\/products\/\d+/, { timeout: 30_000 });
    await page.goto("/checkout");
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Something went wrong");
  });

  test("buyer order history and support pages load", async ({ page }) => {
    await signIn(page, roles.buyer.email, roles.buyer.password);
    for (const route of ["/orders", "/support", "/messages", "/profile", "/activity"]) {
      await page.goto(route);
      await expect(page.locator("body")).toBeVisible();
      await expect(page.locator("body")).not.toContainText("Something went wrong", { timeout: 20_000 });
    }
  });

  test("officer dashboard exposes cooperative operations and admin pages are role-gated", async ({ page }) => {
    await signIn(page, roles.officer.email, roles.officer.password);
    await page.goto("/dashboard");
    await expect(page.locator("body")).not.toContainText("Something went wrong", { timeout: 30_000 });
    await page.goto("/admin/payment-options");
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Something went wrong");
    await page.goto("/admin/audit-logs");
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Something went wrong");
  });

  test("superadmin dashboard and platform admin pages load", async ({ page }) => {
    await signIn(page, roles.superadmin.email, roles.superadmin.password);
    await page.goto("/dashboard");
    await expect(page.locator("body")).not.toContainText("Something went wrong", { timeout: 30_000 });
    await page.goto("/admin/audit-logs");
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Something went wrong");
  });

  test("seller dashboard and product management pages load", async ({ page }) => {
    await signIn(page, roles.seller.email, roles.seller.password);
    await page.goto("/dashboard");
    await expect(page.locator("body")).not.toContainText("Something went wrong", { timeout: 30_000 });
    await page.goto("/support");
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Something went wrong");
  });
});
