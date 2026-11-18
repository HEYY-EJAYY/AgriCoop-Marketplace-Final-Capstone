import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { LOGGED_OUT_CENTER, ROLE_CENTER_NAV } from "../client/src/navigation/roleNav";

const PUBLIC_ROUTES = ["/", "/marketplace", "/about", "/support", "/auth", "/auth?register=1", "/404"] as const;

const EXPECTED_CENTER = LOGGED_OUT_CENTER.map(item => ({ label: item.label, href: item.href }));

const buyerEmail = process.env.QA_BUYER_EMAIL?.trim() ?? "";
const buyerPassword = process.env.QA_BUYER_PASSWORD ?? "";
const sellerEmail = process.env.QA_SELLER_EMAIL?.trim() ?? "";
const sellerPassword = process.env.QA_SELLER_PASSWORD ?? "";
const adminEmail = process.env.QA_ADMIN_EMAIL?.trim() ?? "";
const adminPassword = process.env.QA_ADMIN_PASSWORD ?? "";
const superadminEmail = process.env.QA_SUPERADMIN_EMAIL?.trim() ?? process.env.QA_ADMIN_EMAIL?.trim() ?? "";
const superadminPassword = process.env.QA_SUPERADMIN_PASSWORD ?? process.env.QA_ADMIN_PASSWORD ?? "";

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function readLoggedOutNav(page: Page) {
  const header = page.getByTestId("site-header");
  await expect(header).toBeVisible();

  const center = await page.locator('[data-testid="primary-nav"] a').evaluateAll(anchors =>
    anchors.map(a => ({
      label: (a.textContent ?? "").trim(),
      href: a.getAttribute("href") ?? "",
      box: a.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number },
    })),
  );

  const login = page.getByTestId("nav-login");
  const join = page.getByTestId("nav-join");
  const viewport = page.viewportSize();
  const isDesktopNav = (viewport?.width ?? 0) >= 1024;

  if (isDesktopNav) {
    await expect(login).toBeVisible();
    await expect(join).toBeVisible();
    await expect(login).toHaveAttribute("href", "/auth");
  }

  const headerBox = await header.boundingBox();
  return { center, headerBox, isDesktopNav };
}

test.describe("logged-out public nav identity", () => {
  test("same center items, Login, and Join on every public route", async ({ page }, testInfo) => {
    // Focus the four requested widths; keep mobile-360 covered by existing suites.
    test.skip(testInfo.project.name === "mobile-360", "Covered by mobile-375");

    const snapshots: Array<{
      route: string;
      labels: string[];
      hrefs: string[];
      headerBox: { x: number; y: number; width: number; height: number } | null;
      itemBoxes: Array<{ x: number; y: number; width: number; height: number }>;
    }> = [];

    for (const route of PUBLIC_ROUTES) {
      await page.goto(route);
      await expect(page.getByTestId("site-header")).toBeVisible();

      const { center, headerBox, isDesktopNav } = await readLoggedOutNav(page);
      expect(center.map(c => c.label)).toEqual(EXPECTED_CENTER.map(c => c.label));
      expect(center.map(c => c.href)).toEqual(EXPECTED_CENTER.map(c => c.href));

      // Logged-out actions must never include search / cart / logout in the header.
      await expect(page.getByTestId("site-header").getByText("Log Out")).toHaveCount(0);
      await expect(page.getByTestId("nav-profile-menu")).toHaveCount(0);

      if (!isDesktopNav) {
        const toggle = page.getByTestId("mobile-menu-toggle");
        await toggle.click();
        const panel = page.getByTestId("mobile-menu-panel");
        await expect(panel).toBeVisible();
        await expect(panel.getByRole("link", { name: "Login" })).toBeVisible();
        await expect(panel.getByRole("button", { name: "Join AgriCoop" })).toBeVisible();
        for (const item of EXPECTED_CENTER) {
          await expect(page.getByTestId(`mobile-menu-link-${item.label}`)).toBeVisible();
        }
        await page.keyboard.press("Escape");
      }

      snapshots.push({
        route,
        labels: center.map(c => c.label),
        hrefs: center.map(c => c.href),
        headerBox,
        itemBoxes: center.map(c => c.box),
      });
    }

    const baseline = snapshots[0];
    for (const snap of snapshots.slice(1)) {
      expect(snap.labels).toEqual(baseline.labels);
      expect(snap.hrefs).toEqual(baseline.hrefs);
      if (baseline.headerBox && snap.headerBox) {
        expect(Math.abs(snap.headerBox.x - baseline.headerBox.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(snap.headerBox.y - baseline.headerBox.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(snap.headerBox.width - baseline.headerBox.width)).toBeLessThanOrEqual(2);
        expect(Math.abs(snap.headerBox.height - baseline.headerBox.height)).toBeLessThanOrEqual(2);
      }
      for (let i = 0; i < baseline.itemBoxes.length; i += 1) {
        const a = baseline.itemBoxes[i];
        const b = snap.itemBoxes[i];
        expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(2);
      }
    }
  });
});

test.describe("marketing boxed layout", () => {
  for (const route of ["/", "/about", "/support"] as const) {
    test(`${route} equal side padding, max width, full-bleed bands, no overflow`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === "mobile-360", "Covered by mobile-375");

      await page.goto(route);
      await expect(page.getByTestId("site-header")).toBeVisible();
      await assertNoHorizontalOverflow(page);

      const marketingShell = page.locator("main.agri-marketing-shell, main .agri-marketing-shell").first();
      await expect(marketingShell).toBeVisible();

      const metrics = await marketingShell.evaluate(el => {
        const styles = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          padLeft: Number.parseFloat(styles.paddingLeft),
          padRight: Number.parseFloat(styles.paddingRight),
          maxWidthPx: Number.parseFloat(styles.maxWidth),
          width: rect.width,
          clientWidth: document.documentElement.clientWidth,
        };
      });

      expect(Math.abs(metrics.padLeft - metrics.padRight)).toBeLessThanOrEqual(1);
      expect(metrics.maxWidthPx).toBeLessThanOrEqual(1280 + 0.5);
      expect(metrics.width).toBeLessThanOrEqual(Math.min(1280, metrics.clientWidth) + 1);

      const bands = page.locator("[data-full-bleed], footer.border-t, header[data-testid='site-header']");
      const count = await bands.count();
      for (let i = 0; i < count; i += 1) {
        const width = await bands.nth(i).evaluate(el => el.getBoundingClientRect().width);
        expect(Math.abs(width - metrics.clientWidth)).toBeLessThanOrEqual(2);
      }
    });
  }

  test("Home, How It Works, Support axe AA", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-360", "Covered by mobile-375");
    for (const route of ["/", "/about", "/support"] as const) {
      await page.goto(route);
      await expect(page.getByTestId("site-header")).toBeVisible();
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(axe.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    }
  });
});

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth");
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 30_000 });
  const toggle = page.getByRole("button", { name: /Already registered\? Sign in|New to AgriCoop\? Create an account/i });
  if (await toggle.count()) {
    const label = await toggle.innerText();
    if (/Already registered/i.test(label)) await toggle.click();
  }
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await expect(page.getByTestId("nav-profile-menu")).toBeVisible({ timeout: 45_000 });
}

test.describe("Support logged-in role nav", () => {
  const roles: Array<{
    role: keyof typeof ROLE_CENTER_NAV;
    email: string;
    password: string;
    envKeys: string[];
  }> = [
    { role: "buyer", email: buyerEmail, password: buyerPassword, envKeys: ["QA_BUYER_EMAIL", "QA_BUYER_PASSWORD"] },
    { role: "seller", email: sellerEmail, password: sellerPassword, envKeys: ["QA_SELLER_EMAIL", "QA_SELLER_PASSWORD"] },
    { role: "admin", email: adminEmail, password: adminPassword, envKeys: ["QA_ADMIN_EMAIL", "QA_ADMIN_PASSWORD"] },
    {
      role: "superadmin",
      email: superadminEmail,
      password: superadminPassword,
      envKeys: ["QA_SUPERADMIN_EMAIL|QA_ADMIN_EMAIL", "QA_SUPERADMIN_PASSWORD|QA_ADMIN_PASSWORD"],
    },
  ];

  for (const entry of roles) {
    test(`Support as ${entry.role}: role nav, profile chip, no Login/Join`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop-1280", "Role checks once on desktop-1280");
      test.skip(!entry.email || !entry.password, `Missing ${entry.envKeys.join(", ")}`);

      await signIn(page, entry.email, entry.password);
      await page.goto("/support");
      await expect(page.getByTestId("site-header")).toBeVisible();
      await expect(page.getByTestId("nav-login")).toHaveCount(0);
      await expect(page.getByTestId("nav-join")).toHaveCount(0);
      await expect(page.getByTestId("nav-profile-menu")).toBeVisible();

      const expected = ROLE_CENTER_NAV[entry.role];
      for (const item of expected) {
        await expect(page.getByTestId(`nav-link-${item.label}`)).toBeVisible();
      }
    });
  }
});
