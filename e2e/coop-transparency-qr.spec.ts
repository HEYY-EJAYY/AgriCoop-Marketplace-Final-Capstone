import { expect, test, type Page } from "@playwright/test";

/**
 * Cooperative transparency + QR/pickup acceptance checks.
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
  await page.waitForURL(url => !url.pathname.startsWith("/auth"), { timeout: 120_000 });
}

test.describe("cooperative transparency and QR scope", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!hasCreds, `Missing env credentials: ${missing.join(", ")}`);
    testInfo.setTimeout(120_000);
  });

  test("buyer sees cooperative identity on cards, cart, and checkout", async ({ page }) => {
    await signIn(page, roles.buyer.email, roles.buyer.password);
    await page.goto("/marketplace");

    // Product cards identify the cooperative.
    const coopLabel = page.locator("text=/· .+/").first();
    await expect(page.locator("a[href^='/products/']").first()).toBeVisible({ timeout: 30_000 });
    await expect(coopLabel).toBeVisible();

    // Add the first available listing to the cart.
    const addButton = page.getByRole("button", { name: /^Add$/ }).first();
    await expect(addButton).toBeVisible({ timeout: 30_000 });
    await addButton.click();

    // Cart rows name the seller and cooperative.
    const orderPanel = page.locator("#order");
    await expect(orderPanel.getByText(/By .+ · .+/).first()).toBeVisible({ timeout: 20_000 });

    // Checkout groups show which cooperative receives the order.
    await page.goto("/checkout");
    await expect(page.getByText(/Sold by /i).first()).toBeVisible({ timeout: 30_000 });

    // Choosing pickup shows the cooperative pickup card.
    const pickupRadio = page.getByRole("radio", { name: /pickup/i }).first();
    if (await pickupRadio.isVisible().catch(() => false)) {
      await pickupRadio.check();
      await expect(page.getByText("Pickup location").first()).toBeVisible({ timeout: 15_000 });
    }

    // Online payment shows either cooperative QR options or an explicit notice.
    const onlineRadio = page.getByRole("radio", { name: /online|qr/i }).first();
    if (await onlineRadio.isVisible().catch(() => false)) {
      await onlineRadio.check();
      await expect(
        page.getByText(/Choose a payment QR|has not published a QR|Pay via AgriCoop QR/i).first(),
      ).toBeVisible({ timeout: 20_000 });
    }
  });

  test("officer manages only cooperative-scoped payment options and pickup details", async ({ page }) => {
    await signIn(page, roles.officer.email, roles.officer.password);
    await page.goto("/admin/payment-options");
    await expect(page.getByText("Payment management is restricted")).not.toBeVisible({ timeout: 30_000 });

    // Existing options list (scoped server-side to the officer's cooperative).
    await expect(page.locator("article").first()).toBeVisible({ timeout: 30_000 });

    // Create form: officers never see a cooperative picker.
    await page.getByRole("button", { name: /Add payment option/i }).click();
    await expect(page.locator("form select").first()).toBeVisible();
    await expect(page.getByText("Platform-wide")).toHaveCount(0);

    // Officer "My Cooperative" section exposes the pickup-details editor,
    // scoped server-side to the officer's assigned cooperative.
    await page.goto("/dashboard?section=cooperative");
    await expect(page.getByText(/Pickup contact number/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Pickup instructions/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Save pickup details/i })).toBeVisible();
  });

  test("superadmin must choose a cooperative and cannot create platform-wide options", async ({ page }) => {
    await signIn(page, roles.superadmin.email, roles.superadmin.password);
    await page.goto("/admin/payment-options");
    await page.getByRole("button", { name: /Add payment option/i }).click();

    const coopSelect = page.locator("form select").nth(1);
    await expect(coopSelect).toBeVisible({ timeout: 15_000 });
    await expect(coopSelect.locator("option", { hasText: /platform-wide/i })).toHaveCount(0);
    await expect(coopSelect.locator("option", { hasText: /select a cooperative/i })).toHaveCount(1);
  });
});
