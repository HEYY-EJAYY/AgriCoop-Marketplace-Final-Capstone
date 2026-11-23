import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import postgres from "postgres";

/**
 * End-to-end buyer checkout verification against the real app + shared DB.
 * Writes limited to: buyer cart quantities, one disposable cash-pickup order
 * (id recorded to scripts/_qa-order-id.txt for later cleanup), and one QR
 * issue report against disposable paymentOption fixtures (coop 1).
 * Credentials come only from process env (never logged). When DATABASE_URL
 * is provided, beforeAll self-heals the two "QA Fixture" payment options
 * (creates/reactivates them and clears their QA reports) so reruns are
 * deterministic; afterwards run scripts/qa-fixture-cleanup.mts to remove the
 * fixtures and any orders recorded in scripts/_qa-order-id.txt.
 */
const env = (k: string) => process.env[k]?.trim() ?? "";
const buyer = { email: env("QA8_BUYER_EMAIL"), password: env("QA8_BUYER_PASSWORD") };
const superadmin = { email: env("QA8_SUPERADMIN_EMAIL"), password: env("QA8_SUPERADMIN_PASSWORD") };
const hasCreds = Boolean(buyer.email && buyer.password && superadmin.email && superadmin.password);

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth");
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.waitForURL(url => !url.pathname.startsWith("/auth"), { timeout: 120_000 });
}

test.describe.configure({ mode: "serial" });

const FIXTURE_OPTIONS = [
  { paymentMethod: "gcash", displayName: "QA Fixture GCash A", accountName: "QA Fixture Holder A", accountNumber: "0917-000-0001" },
  { paymentMethod: "maya", displayName: "QA Fixture Maya B", accountName: "QA Fixture Holder B", accountNumber: "0917-000-0002" },
] as const;

async function ensureFixtureOptions() {
  const url = env("DATABASE_URL");
  if (!url) return;
  const sql = postgres(url, { prepare: false });
  try {
    const ids: number[] = [];
    for (const f of FIXTURE_OPTIONS) {
      const existing = await sql`select id from agricoop_app."paymentOptions" where "displayName" = ${f.displayName} limit 1`;
      if (existing.length) {
        await sql`update agricoop_app."paymentOptions" set "isActive" = true, "updatedAt" = now() where id = ${existing[0].id}`;
        ids.push(existing[0].id as number);
      } else {
        const ins = await sql`insert into agricoop_app."paymentOptions"
          ("cooperativeId", "paymentMethod", "displayName", "accountName", "accountNumber", "instructions", "isActive", "createdBy")
          values (1, ${f.paymentMethod}, ${f.displayName}, ${f.accountName}, ${f.accountNumber}, 'QA fixture - delete after test', true, 1)
          returning id`;
        ids.push(ins[0].id as number);
      }
    }
    await sql`delete from agricoop_app."qrIssueReports" where "paymentOptionId" = any(${ids})`;
  } finally {
    await sql.end();
  }
}

test.describe("buyer checkout workflow", () => {
  test.beforeAll(async () => {
    if (hasCreds) await ensureFixtureOptions();
  });

  test.beforeEach(({}, testInfo) => {
    test.skip(!hasCreds, "Missing QA8_* credentials");
    testInfo.setTimeout(300_000);
  });

  test("marketplace, cart, pickup/delivery rules, QR report", async ({ page }) => {
    await signIn(page, buyer.email, buyer.password);
    await page.goto("/marketplace");
    await expect(page.locator("a[href^='/products/']").first()).toBeVisible({ timeout: 30_000 });

    // Search + cooperative filter (desktop sidebar vs mobile bottom sheet).
    const desktopSearch = page.locator("#marketplace-search-desktop");
    if (await desktopSearch.isVisible().catch(() => false)) {
      await desktopSearch.fill("banana");
      await page.locator("#marketplace-cooperative-desktop").selectOption("1");
    } else {
      await page.getByRole("button", { name: /Filters & sort/i }).click();
      await page.locator("#marketplace-mobile-search").fill("banana");
      await page.locator("#marketplace-mobile-cooperative").selectOption("1");
      await page.getByRole("button", { name: /View results/i }).click();
    }
    await expect(page.locator("a[href='/products/53']").first()).toBeVisible({ timeout: 20_000 });

    // Product detail shows cooperative identity.
    await page.locator("a[href='/products/53']").first().click();
    await expect(page).toHaveURL(/\/products\/53/);
    await expect(page.getByText("Agricoop Butuan Producers Cooperative").first()).toBeVisible({ timeout: 20_000 });

    // Cart: add Banana + Sugarcane listings, then set each to its 5 kg minimum.
    await page.goto("/marketplace");
    for (const [href, name] of [["/products/53", "Banana"], ["/products/65", "Sugarcane"]] as const) {
      const card = page.locator("article", { has: page.locator(`a[href='${href}']`) }).first();
      await card.getByRole("button", { name: /^Add$/ }).click();
      await expect(page.locator("#order").getByText(name).first()).toBeVisible({ timeout: 20_000 });
    }
    const orderPanel = page.locator("#order");
    await expect(orderPanel.getByText(/By .+ · .+/).first()).toBeVisible({ timeout: 30_000 });
    for (const name of ["Banana", "Sugarcane"]) {
      const qty = orderPanel.locator(`input[aria-label="Quantity of ${name} in kg"]`);
      await qty.fill("5");
      await qty.press("Enter");
    }
    await page.waitForTimeout(1200);
    await expect(orderPanel.getByText(/Minimum order is/)).toHaveCount(0, { timeout: 15_000 });

    // Checkout: cooperative identity + pickup card.
    await page.goto("/checkout");
    await expect(page.getByText(/Sold by Agricoop Butuan/).first()).toBeVisible({ timeout: 30_000 });
    const pickupRadio = page.getByRole("radio", { name: /^Pickup/ }).first();
    await pickupRadio.check();
    await expect(page.getByText("Pickup location").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Pickup from Agricoop Butuan/)).toBeVisible();
    // Coop 1 has no detailed pickup address → clear warning, not silent.
    await expect(page.getByText(/has not configured a detailed pickup address/i)).toBeVisible();

    // Delivery: 10 kg total < 20 kg minimum → blocked with reason.
    const deliveryRadio = page.getByRole("radio", { name: /^Delivery/ }).first();
    await expect(deliveryRadio).toBeDisabled();
    await expect(page.getByText(/Minimum order weight for Delivery is 20 kg/)).toBeVisible();

    // Online payment: coop-scoped QR fixtures appear; switch + report.
    const onlineRadio = page.getByRole("radio", { name: /Online|QR/i }).first();
    await onlineRadio.check();
    const qrRadios = page.locator('input[name^="qr-"]');
    await expect(qrRadios).toHaveCount(2, { timeout: 20_000 });
    await expect(page.getByText("QA Fixture GCash A").first()).toBeVisible();
    await expect(page.getByText("QA Fixture Maya B").first()).toBeVisible();

    // Switch QR via "Show another QR".
    await page.getByRole("button", { name: /Show another QR/i }).click();

    // Report the currently selected fixture QR.
    await page.getByRole("button", { name: /Report This QR/i }).click();
    await page.locator("label", { hasText: "What is wrong with this QR code?" }).locator("select").selectOption({ index: 1 });
    await page.getByRole("button", { name: /Send report/i }).click();
    await expect(page.getByText(/report has been sent/i)).toBeVisible({ timeout: 20_000 });
    // Reported QR hidden; exactly one fixture option remains available.
    await expect(qrRadios).toHaveCount(1, { timeout: 15_000 });
  });

  test("cash pickup order creation and admin review", async ({ page }) => {
    await signIn(page, buyer.email, buyer.password);
    await page.goto("/checkout");
    await expect(page.getByText(/Sold by Agricoop Butuan/).first()).toBeVisible({ timeout: 30_000 });

    // Defaults: pickup + cash on pickup for a cash-settled order (no receipt needed).
    const pickupRadio = page.getByRole("radio", { name: /^Pickup/ }).first();
    if (!(await pickupRadio.isChecked().catch(() => false))) await pickupRadio.check();
    const cashRadio = page.getByRole("radio", { name: /Cash on Pickup/i }).first();
    if (await cashRadio.count()) {
      if (!(await cashRadio.isChecked().catch(() => false))) await cashRadio.check();
    }

    const placeButton = page.getByRole("button", { name: /Place order/i });
    await expect(placeButton).toBeEnabled({ timeout: 60_000 });
    await placeButton.click();
    await page.waitForURL(/\/orders\/\d+/, { timeout: 120_000 });
    const orderId = Number(page.url().match(/\/orders\/(\d+)/)?.[1]);
    expect(orderId).toBeGreaterThan(0);
    writeFileSync("scripts/_qa-order-id.txt", String(orderId));

    // Order detail shows cooperative, fulfillment, payment, pickup snapshot.
    await expect(page.getByText("Agricoop Butuan Producers Cooperative").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Cash on Pickup|Pickup/i).first()).toBeVisible();

    // Admin (superadmin) can open the order and sees it for review.
    await page.context().clearCookies();
    await signIn(page, superadmin.email, superadmin.password);
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByText(new RegExp(`Order #${orderId}|#${orderId}`)).first()).toBeVisible({ timeout: 30_000 });
    const approve = page.getByRole("button", { name: /Approve order/i });
    if (await approve.count()) {
      await approve.first().click();
      await expect(page.getByText(/confirmed/i).first()).toBeVisible({ timeout: 20_000 });
    }
  });
});
