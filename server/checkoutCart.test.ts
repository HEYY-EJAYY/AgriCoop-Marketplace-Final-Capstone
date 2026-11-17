import { describe, expect, it } from "vitest";
import { checkoutCartSchema, hasMinimumOrderStock } from "../shared/checkoutCart";

describe("checkout cart session payload", () => {
  const item = {
    productId: 7,
    name: "Tomatoes",
    unit: "kg",
    quantity: 3,
    minOrderQty: 1,
    stockQty: 8,
    priceCents: 5000,
    sellerId: 9,
    sellerName: "Farm seller",
  };

  it("accepts valid order display data and defaults the selected cash method", () => {
    expect(checkoutCartSchema.parse({
      cooperativeId: 4,
      items: [item],
    })).toMatchObject({
      cooperativeId: 4,
      paymentMethod: "cash_pickup",
      items: [item],
    });
  });

  it("rejects malformed or out-of-range client cart data", () => {
    expect(checkoutCartSchema.safeParse({
      cooperativeId: 4,
      items: [{ ...item, quantity: 0 }],
    }).success).toBe(false);
    expect(checkoutCartSchema.safeParse({
      cooperativeId: 4,
      items: [{ ...item, quantity: 9 }],
    }).success).toBe(false);
    expect(checkoutCartSchema.safeParse({
      cooperativeId: -1,
      items: [item],
    }).success).toBe(false);
    expect(checkoutCartSchema.safeParse({
      cooperativeId: 4,
      paymentMethod: "gcash",
      items: [item],
    }).success).toBe(false);
  });

  it("only enables marketplace actions when the minimum order is in stock", () => {
    expect(hasMinimumOrderStock(4, 4)).toBe(true);
    expect(hasMinimumOrderStock(1, 2)).toBe(false);
    expect(hasMinimumOrderStock(0, 1)).toBe(false);
    expect(hasMinimumOrderStock(4, 1.5)).toBe(false);
  });
});
