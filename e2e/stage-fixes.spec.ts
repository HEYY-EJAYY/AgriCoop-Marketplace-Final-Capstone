import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ trace: "off" });

const buyerEmail = process.env.QA_BUYER_EMAIL?.trim() ?? "";
const buyerPassword = process.env.QA_BUYER_PASSWORD ?? "";
const adminEmail = process.env.QA_ADMIN_EMAIL?.trim() ?? "";
const adminPassword = process.env.QA_ADMIN_PASSWORD ?? "";

const missingBuyerVars = [
  !buyerEmail && "QA_BUYER_EMAIL",
  !buyerPassword && "QA_BUYER_PASSWORD",
].filter(Boolean) as string[];
const missingAdminVars = [
  !adminEmail && "QA_ADMIN_EMAIL",
  !adminPassword && "QA_ADMIN_PASSWORD",
].filter(Boolean) as string[];

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("nav-profile-menu")).toBeVisible({ timeout: 45_000 });
}

async function firstAddableListing(page: Page): Promise<Locator | null> {
  const cards = page.locator("article");
  for (let index = 0; index < await cards.count(); index += 1) {
    const card = cards.nth(index);
    const addButton = card.getByRole("button", { name: "Add", exact: true });
    if (await addButton.count() && await addButton.isEnabled()) return card;
  }
  return null;
}

async function removeCartItem(page: Page, productName: string) {
  await page.goto("/marketplace");
  const remove = page.getByRole("button", { name: `Remove ${productName}` }).first();
  if (await remove.count()) await remove.click();
}

test.describe("public Stage 4 controls", () => {
  test("guest Login and Join controls switch auth modes", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280", "Runs once on desktop-1280.");
    await page.goto("/auth?register=1");
    await expect(page.getByRole("heading", { name: "Join the cooperative market" })).toBeVisible();
    await page.getByTestId("nav-login").click();
    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.getByTestId("nav-join").click();
    await expect(page).toHaveURL(/\/auth\?register=1$/);
    await expect(page.getByRole("heading", { name: "Join the cooperative market" })).toBeVisible();
  });

  test("login and registration password visibility is keyboard-operable without shifting", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280", "Runs once on desktop-1280.");
    await page.goto("/auth");
    const password = page.getByLabel("Password", { exact: true });
    const before = await password.boundingBox();
    expect(before).not.toBeNull();
    await page.getByRole("button", { name: "Show password" }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
    await expect(password).toHaveAttribute("type", "text");
    const after = await password.boundingBox();
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
    expect(after?.width).toBe(before?.width);
    expect(after?.height).toBe(before?.height);

    await page.getByTestId("nav-join").click();
    const registerPassword = page.getByLabel("Password", { exact: true });
    const visibilityButton = page.getByRole("button", { name: /Show password|Hide password/ });
    if (await visibilityButton.getAttribute("aria-pressed") === "true") await visibilityButton.click();
    await expect(registerPassword).toHaveAttribute("type", "password");
    await visibilityButton.click();
    await expect(registerPassword).toHaveAttribute("type", "text");
    await expect(visibilityButton).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("buyer Stage 6 flows", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280", "Buyer mutations run once on desktop-1280.");
    test.skip(missingBuyerVars.length > 0, `Missing QA env vars: ${missingBuyerVars.join(", ")}`);
    await signIn(page, buyerEmail, buyerPassword);
  });

  test("disabled payment methods expose a reason and enabled methods are clickable", async ({ page }) => {
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { name: /Find harvests/i })).toBeVisible({ timeout: 30_000 });
    const card = await firstAddableListing(page);
    test.skip(!card, "No purchasable QA listing is available for checkout.");
    const productName = (await card!.getByRole("heading", { level: 3 }).innerText()).trim();
    await card!.getByRole("button", { name: "Add", exact: true }).click();

    try {
      await page.goto("/checkout");
      const groups = page.locator("fieldset");
      await expect(groups.first()).toBeVisible({ timeout: 30_000 });
      let disabledCount = 0;
      for (let groupIndex = 0; groupIndex < await groups.count(); groupIndex += 1) {
        const methods = groups.nth(groupIndex).locator("input[type=radio]");
        await expect(methods).toHaveCount(3);
        for (let index = 0; index < await methods.count(); index += 1) {
          const method = methods.nth(index);
          if (await method.isDisabled()) {
            disabledCount += 1;
            const reasonId = await method.getAttribute("aria-describedby");
            expect(reasonId).toBeTruthy();
            await expect(page.locator(`[id="${reasonId}"]`)).not.toBeEmpty();
          } else {
            await method.check();
            await expect(method).toBeChecked();
          }
        }
      }
      expect(disabledCount).toBeGreaterThan(0);
    } finally {
      await removeCartItem(page, productName);
    }
  });

  test("quotation can be requested, deleted from the buyer view, and restored", async ({ page }) => {
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { name: /Find harvests/i })).toBeVisible({ timeout: 30_000 });
    const card = await firstAddableListing(page);
    test.skip(!card, "No purchasable QA listing is available for a quotation.");
    await card!.getByRole("button", { name: "Quote", exact: true }).click();
    await expect(page.getByText("Formal quotation request", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Quotation request sent.", { exact: true })).toBeVisible({ timeout: 30_000 });

    await page.goto("/activity");
    await expect(page.getByRole("heading", { name: "Quotation requests" })).toBeVisible({ timeout: 30_000 });
    const quoteCheckbox = page.getByRole("checkbox", { name: /Select quotation request/ }).first();
    await expect(quoteCheckbox).toBeVisible();
    const quoteId = await quoteCheckbox.getAttribute("aria-label");
    await quoteCheckbox.check();
    const quotationSection = page.getByRole("heading", { name: "Quotation requests" }).locator("xpath=../../..");
    await quotationSection.getByRole("button", { name: "Delete", exact: true }).first().click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toHaveClass(/bg-white/);
    await confirm.getByRole("button", { name: "Delete from my list" }).click();

    const orderInbox = page.getByRole("tablist", { name: "Order inbox" });
    await orderInbox.getByRole("tab", { name: /Deleted/ }).click();
    const deletedQuote = page.getByRole("checkbox", { name: quoteId ?? "" });
    await expect(deletedQuote).toBeVisible();
    await deletedQuote.check();
    await page.getByRole("button", { name: "Restore", exact: true }).first().click();
    await orderInbox.getByRole("tab", { name: /Active/ }).click();
    await expect(page.getByRole("checkbox", { name: quoteId ?? "" })).toBeVisible();
  });

  test("buyer can archive and unarchive an order", async ({ page }) => {
    await page.goto("/activity");
    await expect(page.getByRole("heading", { name: "My Orders" })).toBeVisible({ timeout: 30_000 });
    const orderInbox = page.getByRole("tablist", { name: "Order inbox" });
    await orderInbox.getByRole("tab", { name: /Active/ }).click();
    const orderCheckbox = page.getByRole("checkbox", { name: /Select order \d+/ }).first();
    test.skip(!(await orderCheckbox.count()), "No active QA order is available to archive.");
    const orderId = await orderCheckbox.getAttribute("aria-label");
    const orderCard = orderCheckbox.locator("xpath=../..");
    await orderCard.getByRole("button", { name: "Archive", exact: true }).click();
    await orderInbox.getByRole("tab", { name: /Archived/ }).click();
    const archivedOrder = page.getByRole("checkbox", { name: orderId ?? "" });
    await expect(archivedOrder).toBeVisible();
    await archivedOrder.locator("xpath=../..").getByRole("button", { name: "Unarchive", exact: true }).click();
    await orderInbox.getByRole("tab", { name: /Active/ }).click();
    await expect(page.getByRole("checkbox", { name: orderId ?? "" })).toBeVisible();
  });

  test("deleting an in-progress order shows the warning and restores it", async ({ page }) => {
    await page.goto("/activity");
    await expect(page.getByRole("heading", { name: "My Orders" })).toBeVisible({ timeout: 30_000 });
    const orderCheckboxes = page.getByRole("checkbox", { name: /Select order \d+/ });
    const count = await orderCheckboxes.count();
    let orderCheckbox: Locator | null = null;
    for (let index = 0; index < count; index += 1) {
      const candidate = orderCheckboxes.nth(index);
      const orderCard = candidate.locator("xpath=../..");
      const status = (await orderCard.locator(".status-pill").innerText()).trim();
      if (!["Completed", "Cancelled"].includes(status)) {
        orderCheckbox = candidate;
        break;
      }
    }
    test.skip(!orderCheckbox, "No in-progress QA order is available for the warning and restore flow.");
    const orderId = await orderCheckbox!.getAttribute("aria-label");
    await orderCheckbox!.check();
    await page.getByRole("button", { name: "Delete", exact: true }).first().click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toHaveClass(/bg-white/);
    await expect(confirm).toContainText("This only removes it from your list. The seller can still see it.");
    await confirm.getByRole("button", { name: "Delete from my list" }).click();

    const orderInbox = page.getByRole("tablist", { name: "Order inbox" });
    await orderInbox.getByRole("tab", { name: /Deleted/ }).click();
    const deletedOrder = page.getByRole("checkbox", { name: orderId ?? "" });
    await expect(deletedOrder).toBeVisible();
    await deletedOrder.check();
    await page.getByRole("button", { name: "Restore", exact: true }).first().click();
    await orderInbox.getByRole("tab", { name: /Active/ }).click();
    await expect(page.getByRole("checkbox", { name: orderId ?? "" })).toBeVisible();
  });

  test("password eye covers both profile password fields", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280", "Runs once on desktop-1280.");
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible({ timeout: 30_000 });
    for (const label of ["New password", "Confirm new password"]) {
      const input = page.getByLabel(label, { exact: true });
      const wrapper = input.locator("xpath=..");
      const show = wrapper.getByRole("button", { name: "Show password" });
      await show.click();
      await expect(input).toHaveAttribute("type", "text");
      await expect(wrapper.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
    }
  });

  test("rendered order status pills use Title Case labels", async ({ page }) => {
    await page.goto("/activity");
    await expect(page.getByRole("heading", { name: "My Orders" })).toBeVisible({ timeout: 30_000 });
    const pills = page.locator(".status-pill");
    test.skip(!(await pills.count()), "No QA order status pills are available to inspect.");
    for (const label of await pills.allInnerTexts()) {
      const words = label.trim().split(/\s+-\s+|\s+/).filter(word => word !== "-");
      expect(words.length).toBeGreaterThan(0);
      for (const word of words) expect(word[0]).toMatch(/[A-Z0-9]/);
      expect(label).not.toMatch(/\b(?:published|approved|pending|rejected|archived|regular_order|cash_pickup)\b/);
    }
  });
});

test.describe("Admin Stage 6 flows", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280", "Admin checks run once on desktop-1280.");
    test.skip(missingAdminVars.length > 0, `Missing QA env vars: ${missingAdminVars.join(", ")}`);
    await signIn(page, adminEmail, adminPassword);
  });

  test("cooperative manager separates columns and toggles deleted rows", async ({ page }) => {
    await page.goto("/dashboard?tab=users");
    const panel = page.getByTestId("admin-panel-users");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const sellersHeader = panel.getByRole("columnheader", { name: "Sellers" });
    const listingsHeader = panel.getByRole("columnheader", { name: "Listings" });
    await expect(sellersHeader).toBeVisible();
    await expect(listingsHeader).toBeVisible();
    const sellersBox = await sellersHeader.boundingBox();
    const listingsBox = await listingsHeader.boundingBox();
    expect(listingsBox?.x).toBeGreaterThan((sellersBox?.x ?? 0) + (sellersBox?.width ?? 0));

    const showDeleted = page.getByRole("button", { name: /Show deleted \(\d+\)/ });
    await expect(showDeleted).toHaveAttribute("aria-pressed", "false");
    const deletedRows = panel.getByRole("row").filter({ hasText: "(deleted)" });
    await expect(deletedRows).toHaveCount(0);
    const deletedCount = Number((await showDeleted.innerText()).match(/\((\d+)\)/)?.[1] ?? 0);
    await showDeleted.click();
    await expect(page.getByRole("button", { name: /^Hide deleted/ })).toHaveAttribute("aria-pressed", "true");
    if (deletedCount === 0) test.skip(true, "QA Admin has no soft-deleted cooperative rows to reveal.");
    await expect(panel.getByRole("row").filter({ hasText: "(deleted)" })).toHaveCount(deletedCount);
  });

  test("cooperative list refreshes after soft-delete and restore", async ({ page }) => {
    await page.goto("/dashboard?tab=users");
    const panel = page.getByTestId("admin-panel-users");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const table = panel.getByRole("table").filter({
      has: panel.getByRole("columnheader", { name: "Sellers" }),
    });
    const showDeleted = page.getByRole("button", { name: /Show deleted \(\d+\)/ });
    await showDeleted.click();
    await expect(page.getByRole("button", { name: /^Hide deleted/ })).toHaveAttribute("aria-pressed", "true");

    const qaCooperativeName = "Playwright Stage 6 Refresh Cooperative";
    let row = table.getByRole("row").filter({ hasText: qaCooperativeName });
    if (!(await row.count())) {
      await page.getByLabel("Cooperative name").fill(qaCooperativeName);
      await page.getByLabel("Street / barangay address").fill("Playwright QA address");
      await page.getByLabel("Location").fill("Playwright QA location");
      await page.getByRole("button", { name: "Create cooperative" }).click();
      row = table.getByRole("row").filter({ hasText: qaCooperativeName });
      await expect(row).toBeVisible({ timeout: 30_000 });
    } else if (await row.getByRole("button", { name: "Restore", exact: true }).count()) {
      await row.getByRole("button", { name: "Restore", exact: true }).click();
      await expect(row).not.toContainText("(deleted)");
    }

    const softDelete = async () => {
      await row.getByRole("button", { name: "Delete", exact: true }).click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toContainText("This soft-deletes the cooperative.");
      await confirm.getByRole("button", { name: "Delete cooperative", exact: true }).click();
      await expect(row).toContainText("(deleted)");
    };
    await softDelete();
    await row.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(row).not.toContainText("(deleted)");
    await softDelete();

    await page.getByRole("button", { name: /^Hide deleted/ }).click();
    await expect(row).toHaveCount(0);
  });

  test("moderation listing combined states are Title Case", async ({ page }) => {
    await page.goto("/dashboard?tab=moderation");
    const moderation = page.getByTestId("admin-moderation-content");
    await expect(moderation).toBeVisible({ timeout: 30_000 });
    const combined = moderation.getByText(/^Published - Approved(?: · .*)?$/);
    test.skip(!(await combined.count()), "No published and approved QA listing is available to inspect.");
    await expect(combined.first()).toContainText("Published - Approved");
    await expect(combined.first()).not.toContainText(/published|approved/);
  });
});

test.describe("mobile cart access and persistence", () => {
  test("Your order opens on mobile and the cart survives refresh", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-360", "Runs once on mobile-360.");
    test.skip(missingBuyerVars.length > 0, `Missing QA env vars: ${missingBuyerVars.join(", ")}`);
    await signIn(page, buyerEmail, buyerPassword);
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { name: /Find harvests/i })).toBeVisible({ timeout: 30_000 });
    const card = await firstAddableListing(page);
    test.skip(!card, "No purchasable QA listing is available to test cart persistence.");
    const productName = (await card!.getByRole("heading", { level: 3 }).innerText()).trim();
    await expect(page.getByTestId("nav-cart")).toBeHidden();
    await card!.getByRole("button", { name: "Add", exact: true }).click();
    await page.reload();
    const openOrder = page.getByRole("button", { name: /^Your order/ });
    await expect(openOrder).toBeVisible();
    await openOrder.click();
    await expect(page.getByRole("button", { name: `Remove ${productName}` })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /^Your order/ }).click();
    await expect(page.getByRole("button", { name: `Remove ${productName}` })).toBeVisible();
    await page.getByRole("button", { name: `Remove ${productName}` }).click();
  });
});
