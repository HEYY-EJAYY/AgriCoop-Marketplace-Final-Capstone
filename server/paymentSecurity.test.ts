import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertBuyerOwnsReceiptPath,
  canViewSellerOnlinePaymentDetails,
  isCheckoutReceiptStorageKey,
  isPaymentProofStorageKey,
  isSellerPaymentQrKey,
  SELLER_PAYMENT_QR_BUCKET,
} from "./paymentProofs";
import { canReviewOrderPaymentProof, canViewOrder } from "./orderAccess";
import { canManageCashReceipt } from "./authz";
import { paymentMethodLabel } from "../shared/paymentMethods";
import { SYSTEM_PAYMENT_QR_BUCKET, isSystemPaymentQrKey } from "./systemPayment";

describe("seller online payment secrecy", () => {
  it("uses the private seller-payment-qr bucket (legacy; no longer written by app)", () => {
    expect(SELLER_PAYMENT_QR_BUCKET).toBe("seller-payment-qr");
  });

  it("uses the private system-payment-qr bucket for officer-managed Online payment", () => {
    expect(SYSTEM_PAYMENT_QR_BUCKET).toBe("system-payment-qr");
    expect(isSystemPaymentQrKey("system/1/qr.png")).toBe(true);
    expect(isSystemPaymentQrKey("22/qr.png")).toBe(false);
  });

  it("denies sellers payment review and cash-received management", () => {
    const order = { sellerId: 22, cooperativeId: 4 };
    expect(canReviewOrderPaymentProof({ id: 22, role: "seller" }, order, null)).toBe(false);
    expect(canReviewOrderPaymentProof({ id: 40, role: "admin" }, order, 4)).toBe(true);
    expect(canManageCashReceipt(
      { id: 22, role: "seller", cooperativeId: 4 },
      { buyerId: 10, sellerId: 22, cooperativeId: 4 },
    )).toBe(false);
    expect(canManageCashReceipt(
      { id: 40, role: "admin", cooperativeId: 4 },
      { buyerId: 10, sellerId: 22, cooperativeId: 4 },
    )).toBe(true);
  });

  it("limits QR/account visibility to buyer, owning seller, and officers", () => {
    expect(canViewSellerOnlinePaymentDetails({ id: 10, role: "buyer" }, 22)).toBe(true);
    expect(canViewSellerOnlinePaymentDetails({ id: 22, role: "seller" }, 22)).toBe(true);
    expect(canViewSellerOnlinePaymentDetails({ id: 23, role: "seller" }, 22)).toBe(false);
    expect(canViewSellerOnlinePaymentDetails({ id: 30, role: "admin" }, 22)).toBe(true);
    expect(canViewSellerOnlinePaymentDetails({ id: 1, role: "superadmin" }, 22)).toBe(true);
  });

  it("marketplace list query never selects account secret columns", () => {
    const source = readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");
    const marketplaceSlice = source.slice(
      source.indexOf("export async function getMarketplace"),
      source.indexOf("export async function getMarketplaceProduct"),
    );
    expect(marketplaceSlice).toContain("onlinePaymentAvailable");
    expect(marketplaceSlice).toContain("sellerHasOnlineQr");
    expect(marketplaceSlice).not.toContain("onlinePaymentQrPath");
    expect(marketplaceSlice).not.toContain("onlinePaymentAccountName");
    expect(marketplaceSlice).not.toContain("onlinePaymentAccountNumber");
    expect(marketplaceSlice).not.toContain("onlinePaymentLabel");
  });

  it("seller QR object keys stay under the seller id prefix", () => {
    expect(isSellerPaymentQrKey("22/qr.png", 22)).toBe(true);
    expect(isSellerPaymentQrKey("23/qr.png", 22)).toBe(false);
    expect(isSellerPaymentQrKey("22/nested/qr.png", 22)).toBe(false);
  });
});

describe("receipt path ownership", () => {
  it("rejects online checkout without a receipt at order create", () => {
    const routers = readFileSync(fileURLToPath(new URL("./routers.ts", import.meta.url)), "utf8");
    expect(routers).toContain('if (!input.receiptStoragePath)');
    expect(routers).toContain("Upload your payment receipt before placing an online payment order.");
    expect(routers).toContain("assertBuyerOwnsReceiptPath(input.receiptStoragePath, buyer.id)");
  });

  it("accepts checkout and order-scoped buyer paths only", () => {
    expect(() => assertBuyerOwnsReceiptPath("payment-proofs/7/checkout/receipt.png", 7)).not.toThrow();
    expect(() => assertBuyerOwnsReceiptPath("payment-proofs/7/19/receipt.png", 7, 19)).not.toThrow();
    expect(() => assertBuyerOwnsReceiptPath("payment-proofs/8/checkout/receipt.png", 7)).toThrow(/own storage folder/i);
    expect(() => assertBuyerOwnsReceiptPath("payment-proofs/8/19/receipt.png", 7, 19)).toThrow(/own storage folder/i);
  });

  it("rejects cross-buyer payment proof keys", () => {
    expect(isCheckoutReceiptStorageKey("payment-proofs/7/checkout/a.png", 7)).toBe(true);
    expect(isCheckoutReceiptStorageKey("payment-proofs/8/checkout/a.png", 7)).toBe(false);
    expect(isPaymentProofStorageKey("payment-proofs/7/19/a.png", 7, 19)).toBe(true);
    expect(isPaymentProofStorageKey("payment-proofs/8/19/a.png", 7, 19)).toBe(false);
  });
});

describe("order detail authorization", () => {
  const order = { buyerId: 10, sellerId: 20 };

  it("allows buyer, seller, admin, and superadmin only", () => {
    expect(canViewOrder({ id: 10, role: "buyer" }, order)).toBe(true);
    expect(canViewOrder({ id: 20, role: "seller" }, order)).toBe(true);
    expect(canViewOrder({ id: 30, role: "admin" }, order)).toBe(true);
    expect(canViewOrder({ id: 1, role: "superadmin" }, order)).toBe(true);
    expect(canViewOrder({ id: 11, role: "buyer" }, order)).toBe(false);
    expect(canViewOrder({ id: 21, role: "seller" }, order)).toBe(false);
  });
});

describe("legacy payment display", () => {
  it("maps legacy gcash and f2f without rewriting stored values", () => {
    expect(paymentMethodLabel("gcash")).toBe("Online Payment");
    expect(paymentMethodLabel("f2f")).toBe("Face-to-face (legacy)");
    expect(paymentMethodLabel("online")).toBe("Online Payment");
    expect(paymentMethodLabel("cash_pickup")).toBe("Cash on Pickup");
  });
});
