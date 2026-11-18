import { describe, expect, it } from "vitest";
import {
  assertOrderPaidBeforeComplete,
  canReviewOrderPaymentProof,
  canViewOrder,
  isOnlinePaymentMethod,
} from "./orderAccess";

describe("orderAccess", () => {
  it("allows buyer, seller, and officers to view an order", () => {
    const order = { buyerId: 1, sellerId: 2 };
    expect(canViewOrder({ id: 1, role: "buyer" }, order)).toBe(true);
    expect(canViewOrder({ id: 2, role: "seller" }, order)).toBe(true);
    expect(canViewOrder({ id: 9, role: "admin" }, order)).toBe(true);
    expect(canViewOrder({ id: 9, role: "superadmin" }, order)).toBe(true);
    expect(canViewOrder({ id: 3, role: "buyer" }, order)).toBe(false);
  });

  it("limits payment proof review to admin and superadmin", () => {
    const order = { sellerId: 22, cooperativeId: 4 };
    expect(canReviewOrderPaymentProof({ id: 22, role: "seller" }, order, null)).toBe(false);
    expect(canReviewOrderPaymentProof({ id: 23, role: "seller" }, order, null)).toBe(false);
    expect(canReviewOrderPaymentProof({ id: 40, role: "admin" }, order, 4)).toBe(true);
    expect(canReviewOrderPaymentProof({ id: 40, role: "admin" }, order, 5)).toBe(false);
    expect(canReviewOrderPaymentProof({ id: 1, role: "superadmin" }, order, null)).toBe(true);
  });

  it("blocks completion until payment is settled", () => {
    expect(() => assertOrderPaidBeforeComplete("pending")).toThrow(/paid/i);
    expect(() => assertOrderPaidBeforeComplete("awaiting_verification")).toThrow(/paid/i);
    expect(() => assertOrderPaidBeforeComplete("paid")).not.toThrow();
    expect(() => assertOrderPaidBeforeComplete("verified")).not.toThrow();
  });

  it("treats online and legacy gcash as online methods", () => {
    expect(isOnlinePaymentMethod("online")).toBe(true);
    expect(isOnlinePaymentMethod("gcash")).toBe(true);
    expect(isOnlinePaymentMethod("cash_pickup")).toBe(false);
  });
});
