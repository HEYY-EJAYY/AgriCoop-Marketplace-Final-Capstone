import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_PRODUCT_IMAGE_PATHS,
  PRODUCT_IMAGE_PLACEHOLDER,
  isForbiddenProductImageUrl,
  resolveProductImageSrc,
} from "./productImages";

describe("productImages", () => {
  it("never treats the marketing hero as a valid product image", () => {
    for (const path of FORBIDDEN_PRODUCT_IMAGE_PATHS) {
      expect(isForbiddenProductImageUrl(path)).toBe(true);
      expect(resolveProductImageSrc(path, "Unknown crop")).toBe(PRODUCT_IMAGE_PLACEHOLDER);
    }
    expect(resolveProductImageSrc("/images/hero-banner-1200.webp", "Rice")).not.toContain("hero-banner");
  });

  it("keeps each listing's own Storage object URL without render transforms", () => {
    const a = "https://adxprwseqawqrwuijata.supabase.co/storage/v1/object/public/product-images/products/1/a.jpg";
    const b = "https://adxprwseqawqrwuijata.supabase.co/storage/v1/object/public/product-images/products/2/b.jpg";
    expect(resolveProductImageSrc(a, "A")).toBe(a);
    expect(resolveProductImageSrc(b, "B")).toBe(b);
    expect(resolveProductImageSrc(a, "A")).not.toBe(resolveProductImageSrc(b, "B"));
  });

  it("repairs broken /render/image/ URLs back to object/public", () => {
    const broken =
      "https://adxprwseqawqrwuijata.supabase.co/storage/v1/render/image/public/product-images/products/1/a.jpg?width=640";
    const fixed = resolveProductImageSrc(broken, "Cassava");
    expect(fixed).toContain("/storage/v1/object/");
    expect(fixed).not.toContain("/render/image/");
    expect(fixed).not.toContain("hero-banner");
  });

  it("uses the default placeholder when a listing has no image", () => {
    expect(resolveProductImageSrc(null, "Mystery")).toBe(PRODUCT_IMAGE_PLACEHOLDER);
    expect(resolveProductImageSrc("", "Mystery")).toBe(PRODUCT_IMAGE_PLACEHOLDER);
  });
});
