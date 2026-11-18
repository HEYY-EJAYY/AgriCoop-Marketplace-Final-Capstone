import { describe, expect, it } from "vitest";
import { checkoutCartSchema, groupCartItemsBySeller, hasMinimumOrderStock } from "../shared/checkoutCart";
import { methodsForListings, normalizePaymentMethodInput, paymentMethodLabel } from "../shared/paymentMethods";

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

  it("accepts multi-seller cart items without requiring a cart-level payment method", () => {
    const parsed = checkoutCartSchema.parse({
      items: [
        item,
        { ...item, productId: 8, sellerId: 10, sellerName: "Other seller" },
      ],
    });
    expect(parsed.items).toHaveLength(2);
    expect(parsed.paymentMethod).toBeUndefined();
    expect(groupCartItemsBySeller(parsed.items).size).toBe(2);
  });

  it("accepts optional legacy paymentMethod including online/gcash for old sessions", () => {
    expect(checkoutCartSchema.parse({
      paymentMethod: "gcash",
      items: [item],
    }).paymentMethod).toBe("gcash");
    expect(checkoutCartSchema.parse({
      paymentMethod: "online",
      items: [item],
      sellerGroups: [{ sellerId: 9, paymentMethod: "online", fulfillmentMethod: "pickup", receiptStoragePath: "1/order-temp/a.jpg" }],
    }).sellerGroups?.[0]?.paymentMethod).toBe("online");
  });

  it("rejects malformed or out-of-range client cart data", () => {
    expect(checkoutCartSchema.safeParse({
      items: [{ ...item, quantity: 0 }],
    }).success).toBe(false);
    expect(checkoutCartSchema.safeParse({
      items: [{ ...item, quantity: 9 }],
    }).success).toBe(false);
  });

  it("only enables marketplace actions when the minimum order is in stock", () => {
    expect(hasMinimumOrderStock(4, 4)).toBe(true);
    expect(hasMinimumOrderStock(1, 2)).toBe(false);
    expect(hasMinimumOrderStock(0, 1)).toBe(false);
    expect(hasMinimumOrderStock(4, 1.5)).toBe(false);
  });
});

describe("payment method helpers", () => {
  it("maps legacy gcash to online and labels consistently", () => {
    expect(normalizePaymentMethodInput("gcash")).toBe("online");
    expect(paymentMethodLabel("gcash")).toBe("Online Payment");
    expect(paymentMethodLabel("f2f")).toBe("Face-to-face (legacy)");
  });

  it("intersects listing flags for a seller group", () => {
    expect(methodsForListings([
      { allowsPickup: true, allowsDelivery: true, acceptsOnlinePayment: true },
      { allowsPickup: true, allowsDelivery: false, acceptsOnlinePayment: true },
    ], true)).toEqual(["cash_pickup", "online"]);
    expect(methodsForListings([
      { allowsPickup: true, allowsDelivery: true, acceptsOnlinePayment: true },
    ], false)).toEqual(["cash_pickup", "cash_delivery"]);
  });

  it("applies system payment availability instead of listing online flags", () => {
    const flags = [{ allowsPickup: true, allowsDelivery: true, acceptsOnlinePayment: true }];
    expect(methodsForListings(flags, {
      cashPickupEnabled: false,
      cashDeliveryEnabled: true,
      onlineEnabled: true,
      onlineAccountReady: false,
    })).toEqual(["cash_delivery"]);
    expect(methodsForListings(flags, {
      cashPickupEnabled: true,
      cashDeliveryEnabled: false,
      onlineEnabled: true,
      onlineAccountReady: true,
    })).toEqual(["cash_pickup", "online"]);
    expect(methodsForListings(flags, {
      cashPickupEnabled: false,
      cashDeliveryEnabled: false,
      onlineEnabled: false,
      onlineAccountReady: true,
    })).toEqual([]);
  });
});
