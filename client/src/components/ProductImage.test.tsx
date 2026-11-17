import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductImage, PRODUCT_IMAGE_PLACEHOLDER } from "./ProductImage";

describe("ProductImage", () => {
  it("never falls back to the hero asset for missing or forbidden sources", () => {
    const missing = renderToStaticMarkup(
      React.createElement(ProductImage, { src: null, alt: "Rice bag", productName: "Unknown crop" }),
    );
    const forbidden = renderToStaticMarkup(
      React.createElement(ProductImage, {
        src: "/images/hero-banner-1200.webp",
        alt: "Rice bag",
        productName: "Unknown crop",
      }),
    );
    expect(missing).toContain(`src="${PRODUCT_IMAGE_PLACEHOLDER}"`);
    expect(forbidden).toContain(`src="${PRODUCT_IMAGE_PLACEHOLDER}"`);
    expect(missing).not.toContain("hero-banner");
    expect(forbidden).not.toContain("hero-banner");
  });

  it("renders each listing's own image source", () => {
    const a = renderToStaticMarkup(
      React.createElement(ProductImage, {
        src: "https://cdn.example/products/1.jpg",
        alt: "A",
        productName: "A",
      }),
    );
    const b = renderToStaticMarkup(
      React.createElement(ProductImage, {
        src: "https://cdn.example/products/2.jpg",
        alt: "B",
        productName: "B",
      }),
    );
    expect(a).toContain("products/1.jpg");
    expect(b).toContain("products/2.jpg");
    expect(a).not.toContain("products/2.jpg");
    expect(b).not.toContain("products/1.jpg");
    expect(a).not.toContain("hero-banner");
    expect(b).not.toContain("hero-banner");
  });
});
