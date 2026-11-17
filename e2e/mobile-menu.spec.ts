import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { LOGGED_OUT_CENTER } from "../client/src/navigation/roleNav";

async function openMobileMenu(page: Page) {
  const toggle = page.getByTestId("mobile-menu-toggle");
  await expect(toggle).toBeVisible();
  const before = await toggle.boundingBox();
  await toggle.click();
  await expect(page.getByTestId("mobile-menu-panel")).toBeVisible();
  return { toggle, before };
}

test.describe("mobile menu overlay", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith("desktop"), "Mobile menu is for < lg viewports");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /Local harvest/i })).toBeVisible();
  });

  test("opening the menu does not move page content or change scroll", async ({ page }) => {
    // Use a CSS locator (not getByRole): while open, main is inert/aria-hidden for a11y.
    const heading = page.locator("main h1").first();
    const beforeBox = await heading.boundingBox();
    const beforeMetrics = await page.evaluate(() => ({
      scrollY: window.scrollY,
      headingTop: document.querySelector("main h1")?.getBoundingClientRect().top ?? -1,
      headingLeft: document.querySelector("main h1")?.getBoundingClientRect().left ?? -1,
    }));
    expect(beforeBox).toBeTruthy();

    const { toggle, before: toggleBefore } = await openMobileMenu(page);

    const afterMetrics = await page.evaluate(() => ({
      bodyTop: document.body.style.top,
      position: document.body.style.position,
      headingTop: document.querySelector("main h1")?.getBoundingClientRect().top ?? -1,
      headingLeft: document.querySelector("main h1")?.getBoundingClientRect().left ?? -1,
    }));
    if (!beforeBox || !toggleBefore) return;

    // Page content must not reflow — heading stays in the same viewport position
    expect(Math.abs(afterMetrics.headingTop - beforeMetrics.headingTop)).toBeLessThanOrEqual(2);
    expect(Math.abs(afterMetrics.headingLeft - beforeMetrics.headingLeft)).toBeLessThanOrEqual(2);
    expect(afterMetrics.position).toBe("fixed");
    expect(Math.abs(Number.parseFloat(afterMetrics.bodyTop) + beforeMetrics.scrollY)).toBeLessThanOrEqual(0.5);

    const toggleAfter = await toggle.boundingBox();
    expect(toggleAfter).toBeTruthy();
    if (toggleAfter) {
      expect(Math.abs(toggleAfter.x - toggleBefore.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(toggleAfter.y - toggleBefore.y)).toBeLessThanOrEqual(2);
    }

    const panel = page.getByTestId("mobile-menu-panel");
    const panelBox = await panel.boundingBox();
    const viewport = page.viewportSize();
    expect(panelBox && viewport).toBeTruthy();
    if (panelBox && viewport) {
      expect(panelBox.width).toBeGreaterThanOrEqual(viewport.width - 2);
      expect(panelBox.y + panelBox.height).toBeGreaterThanOrEqual(viewport.height - 4);
    }

    const nav = page.getByTestId("mobile-menu-nav");
    const navBox = await nav.boundingBox();
    const firstLink = page.getByTestId("mobile-menu-link-Marketplace");
    const linkBox = await firstLink.boundingBox();
    expect(navBox && linkBox).toBeTruthy();
    if (navBox && linkBox) {
      const navCenter = navBox.x + navBox.width / 2;
      const linkCenter = linkBox.x + linkBox.width / 2;
      expect(Math.abs(navCenter - linkCenter)).toBeLessThanOrEqual(8);
      expect(linkBox.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("Esc, backdrop, link, and desktop resize close the menu and restore focus", async ({ page }) => {
    const { toggle } = await openMobileMenu(page);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("mobile-menu-panel")).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await expect.poll(async () => page.evaluate(() => document.body.style.position)).toBe("");

    await openMobileMenu(page);
    await page.getByTestId("mobile-menu-backdrop").click({ position: { x: 8, y: 8 } });
    await expect(page.getByTestId("mobile-menu-panel")).toHaveCount(0);
    await expect(toggle).toBeFocused();

    await openMobileMenu(page);
    await page.getByTestId("mobile-menu-link-How It Works").click();
    await expect(page).toHaveURL(/\/about/);
    await expect(page.getByTestId("mobile-menu-panel")).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => document.body.style.position)).toBe("");

    await page.goto("/");
    await openMobileMenu(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId("mobile-menu-panel")).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => document.body.style.position)).toBe("");
  });

  test("axe has no serious or critical violations while menu is open", async ({ page }) => {
    await openMobileMenu(page);
    const results = await new AxeBuilder({ page })
      .include('[data-testid="mobile-menu-root"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const blocking = results.violations.filter(v => v.impact === "serious" || v.impact === "critical");
    expect(
      blocking,
      JSON.stringify(
        blocking.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
        null,
        2,
      ),
    ).toEqual([]);
  });

  test("logged-out menu shows guest actions only", async ({ page }) => {
    await openMobileMenu(page);
    for (const item of LOGGED_OUT_CENTER) {
      await expect(page.getByTestId(`mobile-menu-link-${item.label}`)).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Login" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Join AgriCoop" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log Out" })).toHaveCount(0);
    await expect(page.getByTestId("mobile-menu-user-chip")).toHaveCount(0);
  });
});
