import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

function boxesIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

test.describe("home hero layout and width", () => {
  test("balanced hero, no overflow, glass badge placement", async ({ page }, testInfo) => {
    await page.goto("/");
    const hero = page.getByTestId("home-hero");
    const text = page.getByTestId("hero-text");
    const media = page.getByTestId("hero-media");
    const image = page.getByTestId("hero-image");
    const badge = page.getByTestId("hero-glass-badge");
    const h1 = page.getByRole("heading", { level: 1, name: /Local harvest/i });
    const ctas = page.getByTestId("hero-ctas");

    await expect(h1).toBeVisible();
    await expect(badge).toBeVisible();
    await assertNoHorizontalOverflow(page);

    const heroBox = await hero.boundingBox();
    const textBox = await text.boundingBox();
    const mediaBox = await media.boundingBox();
    const imageBox = await image.boundingBox();
    const badgeBox = await badge.boundingBox();
    const h1Box = await h1.boundingBox();
    const ctaBox = await ctas.boundingBox();
    expect(heroBox && textBox && mediaBox && imageBox && badgeBox && h1Box && ctaBox).toBeTruthy();
    if (!heroBox || !textBox || !mediaBox || !imageBox || !badgeBox || !h1Box || !ctaBox) return;

    // Equal horizontal padding on the hero content shell (±4px)
    const shell = hero.locator(".agri-shell").first();
    const padding = await shell.evaluate(el => {
      const styles = getComputedStyle(el);
      return {
        left: Number.parseFloat(styles.paddingLeft),
        right: Number.parseFloat(styles.paddingRight),
      };
    });
    expect(Math.abs(padding.left - padding.right)).toBeLessThanOrEqual(4);

    // Full-bleed sections match viewport width
    if (testInfo.project.name.startsWith("desktop")) {
      const viewport = page.viewportSize();
      expect(viewport).toBeTruthy();
      if (viewport) {
        expect(Math.abs(heroBox.width - viewport.width)).toBeLessThanOrEqual(2);
        const bands = page.locator("[data-full-bleed]");
        const count = await bands.count();
        for (let i = 0; i < count; i += 1) {
          const box = await bands.nth(i).boundingBox();
          expect(box).toBeTruthy();
          if (box) expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(2);
        }
      }

      // Two-column: image must not intersect text column
      expect(boxesIntersect(imageBox, textBox)).toBe(false);

      // Badge in bottom-right quadrant of hero media
      const mediaMidX = mediaBox.x + mediaBox.width / 2;
      const mediaMidY = mediaBox.y + mediaBox.height / 2;
      expect(badgeBox.x + badgeBox.width / 2).toBeGreaterThanOrEqual(mediaMidX - 8);
      expect(badgeBox.y + badgeBox.height / 2).toBeGreaterThanOrEqual(mediaMidY - 8);
      expect(badgeBox.width).toBeLessThanOrEqual(mediaBox.width * 0.45 + 4);

      // Badge must not cover headline or CTAs
      expect(boxesIntersect(badgeBox, h1Box)).toBe(false);
      expect(boxesIntersect(badgeBox, ctaBox)).toBe(false);
    } else {
      // Mobile: text above media (no overlap of image into headline)
      expect(textBox.y).toBeLessThan(mediaBox.y);
      expect(boxesIntersect(imageBox, h1Box)).toBe(false);
      expect(boxesIntersect(badgeBox, h1Box)).toBe(false);
      expect(boxesIntersect(badgeBox, ctaBox)).toBe(false);
    }
  });

  test("axe has no serious or critical violations on home", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /Local harvest/i })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const blocking = results.violations.filter(v => v.impact === "serious" || v.impact === "critical");
    expect(blocking, JSON.stringify(blocking.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })), null, 2)).toEqual([]);
  });
});
