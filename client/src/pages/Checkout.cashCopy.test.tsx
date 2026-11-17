import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN =
  "Cash pickup or delivery. Sellers record cash received; AgriCoop does not process cash payments.";

describe("Checkout cash copy", () => {
  it("does not include the removed cash-payment disclaimer in the checkout page source", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "Checkout.tsx"), "utf8");
    expect(source).not.toContain(FORBIDDEN);
    expect(source).not.toContain("AgriCoop does not process cash payments");
    expect(source).not.toContain("Sellers record cash received");
    expect(source).toContain("Cash on pickup");
    expect(source).toContain("Cash on delivery");
  });

  it("does not include the removed sentence in Marketplace cart UI source", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "Marketplace.tsx"), "utf8");
    expect(source).not.toContain(FORBIDDEN);
    expect(source).not.toContain("AgriCoop does not process cash payments");
  });
});
