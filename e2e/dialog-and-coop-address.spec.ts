import { expect, test, type Page } from "@playwright/test";

/**
 * UI regression: destructive dialog button padding/alignment, cooperative
 * pickup-address editor, and auth action alignment.
 * Credentials come only from process env (never logged). Missing vars → skip.
 * Env vars: QA8_SUPERADMIN_EMAIL/PASSWORD, QA8_OFFICER_EMAIL/PASSWORD.
 */
const superadminEmail = process.env.QA8_SUPERADMIN_EMAIL?.trim() ?? "";
const superadminPassword = process.env.QA8_SUPERADMIN_PASSWORD?.trim() ?? "";
const hasSuperadminCreds = Boolean(superadminEmail && superadminPassword);
const officerEmail = process.env.QA8_OFFICER_EMAIL?.trim() ?? "";
const officerPassword = process.env.QA8_OFFICER_PASSWORD?.trim() ?? "";
const hasOfficerCreds = Boolean(officerEmail && officerPassword);

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth");
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.waitForURL(url => !url.pathname.startsWith("/auth"), { timeout: 45_000 });
}

test.describe("dialog and cooperative-address UI regressions", () => {
  test("permanent-delete dialog renders padded, separated, aligned buttons", async ({ page }, testInfo) => {
    test.skip(!hasSuperadminCreds, "Missing QA8_SUPERADMIN_EMAIL / QA8_SUPERADMIN_PASSWORD");
    testInfo.setTimeout(120_000);
    await signIn(page, superadminEmail, superadminPassword);
    await page.goto("/dashboard?section=buyers");
    const trigger = page.getByRole("button", { name: "Delete", exact: true }).first();
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await trigger.click();
    const dialog = page.locator('[data-slot="alert-dialog-content"]');
    await expect(dialog).toBeVisible();
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    const confirm = dialog.getByRole("button", { name: "Delete permanently" });
    await expect(cancel).toBeVisible();
    await expect(confirm).toBeVisible();

    const metrics = await page.evaluate(() => {
      const footer = document.querySelector('[data-slot="alert-dialog-footer"]');
      const buttons = [...document.querySelectorAll('[data-slot="alert-dialog-content"] button')];
      const footerStyle = footer ? getComputedStyle(footer) : null;
      return {
        justify: footerStyle?.justifyContent ?? "",
        buttons: buttons.map(button => {
          const rect = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          return {
            text: button.textContent?.trim() ?? "",
            padding: style.padding,
            height: rect.height,
            width: rect.width,
            top: rect.top,
            left: rect.left,
          };
        }),
      };
    });

    for (const button of metrics.buttons) {
      // px-5 py-2 → 20px horizontal / 8px vertical minimum padding.
      expect(button.padding).toMatch(/20px/);
      expect(button.height).toBeGreaterThanOrEqual(40);
    }
    const cancelMetrics = metrics.buttons.find(button => button.text === "Cancel");
    const confirmMetrics = metrics.buttons.find(button => button.text === "Delete permanently");
    expect(cancelMetrics).toBeTruthy();
    expect(confirmMetrics).toBeTruthy();
    const isMobile = page.viewportSize()!.width < 640;
    if (isMobile) {
      // Stacked: affirmative action renders above the negative action.
      expect(confirmMetrics!.top).toBeLessThan(cancelMetrics!.top);
    } else {
      // Negative action left, affirmative action right.
      expect(metrics.justify).toBe("space-between");
      expect(cancelMetrics!.left).toBeLessThan(confirmMetrics!.left);
    }

    // Never confirm a real deletion — dismiss only.
    await cancel.click();
    await expect(dialog).toBeHidden();
  });

  test("My Cooperative shows the pickup address block with an edit/add action", async ({ page }, testInfo) => {
    test.skip(!hasOfficerCreds, "Missing QA8_OFFICER_EMAIL / QA8_OFFICER_PASSWORD");
    testInfo.setTimeout(120_000);
    await signIn(page, officerEmail, officerPassword);
    await page.goto("/dashboard?section=cooperative");
    const section = page.locator('[data-section="cooperative"]');
    await expect(section.getByText("Pickup address")).toBeVisible({ timeout: 30_000 });
    await expect(section.getByRole("button", { name: /address$/i })).toBeVisible();
    await section.getByRole("button", { name: /address$/i }).click();
    await expect(section.getByLabel(/Province/i)).toBeVisible();
    await expect(section.getByLabel(/City \/ municipality/i)).toBeVisible();
    await expect(section.getByLabel(/Barangay/i)).toBeVisible();
    await expect(section.getByLabel(/Street address/i)).toBeVisible();
    // Cancel without saving — never modify genuine cooperative data.
    await section.getByRole("button", { name: "Cancel" }).click();
  });
});
