import { describe, expect, it } from "vitest";
import {
  assertPaymentOptionSelection,
  getPaymentOptionCooperativeId,
  getPaymentQrStoragePrefix,
  isGcashCheckoutOption,
  isQrCheckoutOption,
  paymentOptionDetailsChanged,
} from "./paymentOptions";

describe("payment option storage scope", () => {
  it("keeps Admin options within the actor's cooperative", () => {
    expect(getPaymentOptionCooperativeId("admin", 12)).toBe(12);
    expect(getPaymentOptionCooperativeId("admin", 12, 99)).toBe(12);
    expect(() => getPaymentOptionCooperativeId("admin", null)).toThrow(
      "Admin accounts must be assigned to a cooperative.",
    );
    expect(() => getPaymentOptionCooperativeId("buyer", null)).toThrow(
      "Only an Admin or SuperAdmin can manage payment option storage.",
    );
  });

  it("allows SuperAdmin to choose a cooperative or platform-wide scope", () => {
    expect(getPaymentOptionCooperativeId("superadmin", null)).toBeNull();
    expect(getPaymentOptionCooperativeId("superadmin", null, 12)).toBe(12);
  });

  it("uses disjoint storage prefixes for platform and cooperative QR images", () => {
    expect(getPaymentQrStoragePrefix(null)).toBe("payment-options/platform/");
    expect(getPaymentQrStoragePrefix(12)).toBe("payment-options/cooperative-12/");
  });

  it("allows online/gcash without a coop option when seller QR is used, and rejects options on cash orders", () => {
    expect(() => assertPaymentOptionSelection("gcash", 4, true)).not.toThrow();
    expect(() => assertPaymentOptionSelection("gcash", undefined, true)).not.toThrow();
    expect(() => assertPaymentOptionSelection("online", undefined, false)).not.toThrow();
    expect(() => assertPaymentOptionSelection("gcash", 4, false)).toThrow(
      "The selected online payment option is not available",
    );
    expect(() => assertPaymentOptionSelection("cash_pickup", 4, true)).toThrow(
      "Cash orders cannot include",
    );
    expect(() => assertPaymentOptionSelection("cash_delivery", undefined, false)).not.toThrow();
  });

  it("only exposes active GCash options assigned to the order's cooperative", () => {
    const option = { cooperativeId: 12, paymentMethod: "gcash", isActive: true };
    expect(isGcashCheckoutOption(option, 12)).toBe(true);
    expect(isGcashCheckoutOption({ ...option, cooperativeId: null }, 12)).toBe(false);
    expect(isGcashCheckoutOption({ ...option, isActive: false }, 12)).toBe(false);
    expect(isGcashCheckoutOption({ ...option, paymentMethod: "bank" }, 12)).toBe(false);
    expect(isGcashCheckoutOption({ ...option, cooperativeId: null }, null)).toBe(true);
  });

  it("exposes every active QR provider option assigned to the order's cooperative", () => {
    for (const paymentMethod of ["gcash", "maya", "maribank", "gotyme", "other"]) {
      const option = { cooperativeId: 12, paymentMethod, isActive: true };
      expect(isQrCheckoutOption(option, 12)).toBe(true);
      expect(isQrCheckoutOption({ ...option, cooperativeId: 99 }, 12)).toBe(false);
      expect(isQrCheckoutOption({ ...option, cooperativeId: null }, 12)).toBe(false);
      expect(isQrCheckoutOption({ ...option, isActive: false }, 12)).toBe(false);
      expect(isQrCheckoutOption({ ...option, paymentMethod: "bank" }, 12)).toBe(false);
    }
    expect(isQrCheckoutOption({ cooperativeId: null, paymentMethod: "gcash", isActive: true }, null)).toBe(true);
  });

  it("detects payment-detail changes that must be blocked after an option is used", () => {
    const option = {
      paymentMethod: "gcash",
      displayName: "GCash QR",
      accountName: "Farm Co-op",
      accountNumber: "123",
      qrImagePath: "payment-options/cooperative-12/qr.png",
      instructions: "Pay exact amount",
    };
    expect(paymentOptionDetailsChanged(option, { ...option })).toBe(false);
    expect(paymentOptionDetailsChanged(option, { ...option, qrImagePath: "payment-options/cooperative-12/new.png" })).toBe(true);
    expect(paymentOptionDetailsChanged(option, { ...option, accountNumber: null })).toBe(true);
  });
});
