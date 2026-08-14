import { describe, expect, it } from "vitest";
import { assertInventorySufficient, assertNotSelfTransaction, canTransitionOrder, isQuotationOpen, prepareOrder, transactionStatusFor } from "./marketplaceRules";

const products = [
  { id: 1, sellerId: 12, cooperativeId: 3, stockQty: 20, priceCents: 5500, status: "published", name: "Fresh Cabbage" },
  { id: 2, sellerId: 12, cooperativeId: 3, stockQty: 12, priceCents: 4000, status: "published", name: "Sweet Corn" },
];

describe("marketplace order rules", () => {
  it("normalizes a multi-product order from one farmer and calculates its total", () => {
    const order = prepareOrder(products, [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 3 }]);
    expect(order.orderType).toBe("bulk");
    expect(order.sellerId).toBe(12);
    expect(order.cooperativeId).toBe(3);
    expect(order.totalCents).toBe(23000);
  });

  it("rejects cross-farm and unavailable orders before records are created", () => {
    expect(() => prepareOrder([products[0], { ...products[1], id: 3, sellerId: 22 }], [{ productId: 1, quantity: 1 }, { productId: 3, quantity: 1 }])).toThrow("one seller");
    expect(() => prepareOrder([products[0]], [{ productId: 1, quantity: 21 }])).toThrow("enough stock");
    expect(() => prepareOrder([{ ...products[0], status: "archived" }], [{ productId: 1, quantity: 1 }])).toThrow("no longer available");
  });

  it("protects the fulfillment workflow and transaction traceability", () => {
    expect(canTransitionOrder("submitted", "confirmed")).toBe(true);
    expect(canTransitionOrder("submitted", "completed")).toBe(false);
    expect(canTransitionOrder("completed", "ready")).toBe(false);
    expect(() => assertInventorySufficient(products, [{ productId: 2, quantity: 13 }])).toThrow("Insufficient current inventory");
    expect(transactionStatusFor()).toBe("recorded");
    expect(transactionStatusFor("Cash received at the cooperative office")).toBe("payment_coordinated");
  });
});

describe("quotation workflow rule", () => {
  it("allows a seller response only while a quotation is requested", () => {
    expect(isQuotationOpen("requested")).toBe(true);
    expect(isQuotationOpen("responded")).toBe(false);
    expect(isQuotationOpen("declined")).toBe(false);
  });

  it("prevents a farmer from creating a transaction against their own listing", () => {
    expect(() => assertNotSelfTransaction(12, 12)).toThrow("own listing");
    expect(() => assertNotSelfTransaction(12, 22)).not.toThrow();
  });
});
