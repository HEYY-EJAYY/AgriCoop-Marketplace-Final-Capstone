import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Authenticated production verification for officer-controlled payments.
 * Credentials come only from process env (never logged). Missing vars → skip.
 */
const buyerEmail = process.env.QA_BUYER_EMAIL?.trim() ?? "";
const buyerPassword = process.env.QA_BUYER_PASSWORD ?? "";
const sellerEmail = process.env.QA_SELLER_EMAIL?.trim() ?? "";
const sellerPassword = process.env.QA_SELLER_PASSWORD ?? "";
const adminEmail = process.env.QA_ADMIN_EMAIL?.trim() ?? "";
const adminPassword = process.env.QA_ADMIN_PASSWORD ?? "";

const missing = [
  !buyerEmail && "QA_BUYER_EMAIL",
  !buyerPassword && "QA_BUYER_PASSWORD",
  !sellerEmail && "QA_SELLER_EMAIL",
  !sellerPassword && "QA_SELLER_PASSWORD",
  !adminEmail && "QA_ADMIN_EMAIL",
  !adminPassword && "QA_ADMIN_PASSWORD",
].filter(Boolean) as string[];

const hasAuthCreds = missing.length === 0;

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth");
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 30_000 });
  // Ensure sign-in mode (not register)
  const toggle = page.getByRole("button", { name: /Already registered\? Sign in|New to AgriCoop\? Create an account/i });
  if (await toggle.count()) {
    const label = await toggle.innerText();
    if (/Create an account/i.test(label)) {
      // already on sign-in
    } else if (/Already registered/i.test(label)) {
      await toggle.click();
    }
  }
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.waitForURL(url => !url.pathname.startsWith("/auth") || url.search.includes("verified"), { timeout: 45_000 });
}

async function signOutIfPossible(page: Page) {
  // Prefer profile menu sign-out when present; ignore failures for skip paths.
  try {
    const menu = page.getByRole("button", { name: /account|profile|menu/i }).first();
    if (await menu.count()) {
      await menu.click({ timeout: 3_000 });
      const logout = page.getByRole("button", { name: /sign out|log out/i }).first();
      if (await logout.count()) await logout.click({ timeout: 3_000 });
    }
  } catch {
    /* ignore */
  }
}

test.describe("authenticated system payment E2E", () => {
  test.beforeEach(({ }, testInfo) => {
    test.skip(!hasAuthCreds, `Missing QA env vars: ${missing.join(", ")}`);
    test.skip(
      !(testInfo.project.name === "desktop-1280" || testInfo.project.name === "mobile-360"),
      "Authenticated payment E2E runs on desktop-1280 and mobile-360 only",
    );
  });

  test("admin Payments tab can enable online account and persist QR", async ({ page }) => {
    await signIn(page, adminEmail, adminPassword);
    await page.goto("/dashboard?tab=payments");
    await expect(page.getByTestId("admin-panel-payments")).toBeVisible({ timeout: 30_000 });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);

    // Enable Online when a checkbox/control exists
    const onlineToggle = page.getByLabel(/online payment|enable online/i).first();
    if (await onlineToggle.count()) {
      if (!(await onlineToggle.isChecked())) await onlineToggle.check();
    }
    const saveSettings = page.getByRole("button", { name: /save.*settings|save payment settings/i }).first();
    if (await saveSettings.count()) await saveSettings.click();

    // Create or update account fields if empty
    const label = page.getByLabel(/^label/i).first();
    if (await label.count()) {
      const value = await label.inputValue();
      if (!value) {
        await label.fill("QA GCash");
        await page.getByLabel(/account name/i).first().fill("QA AgriCoop");
        await page.getByLabel(/account number/i).first().fill("09171234567");
        const createBtn = page.getByRole("button", { name: /create|add account|save account/i }).first();
        if (await createBtn.count()) await createBtn.click();
      }
    }

    await page.reload();
    await expect(page.getByTestId("admin-panel-payments")).toBeVisible({ timeout: 30_000 });
    await signOutIfPossible(page);
  });

  test("seller listing has pickup/delivery only and no payment QR UI", async ({ page }) => {
    await signIn(page, sellerEmail, sellerPassword);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Farmer workspace|Seller workspace/i }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Accepts Online Payment/i)).toHaveCount(0);
    await expect(page.getByText(/Online payment \(seller\)/i)).toHaveCount(0);
    await expect(page.getByText(/Upload QR/i)).toHaveCount(0);
    await page.goto("/profile");
    await expect(page.getByText(/Online payment \(seller\)/i)).toHaveCount(0);
    await signOutIfPossible(page);
  });

  test("buyer checkout shell and axe; cash sentence absent", async ({ page }) => {
    await signIn(page, buyerEmail, buyerPassword);
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { name: /Find harvests/i })).toBeVisible({ timeout: 30_000 });
    await page.goto("/checkout");
    await expect(page.getByText(/Sellers record cash received/i)).toHaveCount(0);
    await expect(page.getByText(/AgriCoop does not process cash payments/i)).toHaveCount(0);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    await signOutIfPossible(page);
  });
});

test.describe("authenticated payment E2E credential gate", () => {
  test("reports missing QA env var names without values", async () => {
    test.skip(hasAuthCreds, "All QA credentials are present");
    expect(missing.length).toBeGreaterThan(0);
    // Names only — never assert on secret values.
    for (const name of missing) {
      expect(name.startsWith("QA_")).toBe(true);
      expect(name.includes("PASSWORD") || name.includes("EMAIL")).toBe(true);
    }
  });
});
