import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCheckoutReceiptUploadIntent,
  createPaymentProofUploadIntent,
  isCheckoutReceiptStorageKey,
  isPaymentProofStorageKey,
  sanitizePaymentProofFileName,
  verifyCheckoutReceiptUploadIntent,
  verifyPaymentProofUploadIntent,
} from "./paymentProofs";
import { PAYMENT_PROOF_MAX_BYTES } from "../shared/paymentProofs";
import { matchesImageContentTypeSignature } from "../shared/imageValidation";

describe("payment proof storage keys", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts only keys scoped to the buyer and payment", () => {
    expect(isPaymentProofStorageKey("payment-proofs/7/19/receipt.png", 7, 19)).toBe(true);
    expect(isPaymentProofStorageKey("payment-proofs/8/19/receipt.png", 7, 19)).toBe(false);
    expect(isPaymentProofStorageKey("payment-proofs/7/20/receipt.png", 7, 19)).toBe(false);
  });

  it("rejects empty or path-traversing object names", () => {
    expect(isPaymentProofStorageKey("payment-proofs/7/19/", 7, 19)).toBe(false);
    expect(isPaymentProofStorageKey("payment-proofs/7/19/../other.png", 7, 19)).toBe(false);
    expect(isPaymentProofStorageKey("payment-proofs/7/19/nested/receipt.png", 7, 19)).toBe(false);
  });

  it("sanitizes filenames before storage upload", () => {
    expect(sanitizePaymentProofFileName("../../receipt ?.png")).toBe("..-..-receipt--.png");
  });

  it("checks the selected image type against its file signature", () => {
    expect(matchesImageContentTypeSignature(Uint8Array.from([0xff, 0xd8, 0xff, 0]), "image/jpeg")).toBe(true);
    expect(matchesImageContentTypeSignature(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png")).toBe(true);
    expect(matchesImageContentTypeSignature(Uint8Array.from([..."RIFF", 0, 0, 0, 0, ..."WEBP"].map(value => typeof value === "number" ? value : value.charCodeAt(0))), "image/webp")).toBe(true);
    expect(matchesImageContentTypeSignature(Uint8Array.from([0xff, 0xd8, 0xff]), "image/png")).toBe(false);
    expect(matchesImageContentTypeSignature(Uint8Array.from([0xff, 0xd8, 0xff]), "image/gif")).toBe(false);
  });

  it("binds signed upload intents to the buyer, order, path, metadata, size, and expiry", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "unit-test-key");
    const now = 1_800_000_000_000;
    const token = createPaymentProofUploadIntent({
      buyerId: 7,
      orderId: 19,
      storagePath: "payment-proofs/7/19/receipt.png",
      originalFileName: "receipt.png",
      mimeType: "image/png",
      fileSizeBytes: PAYMENT_PROOF_MAX_BYTES,
    }, now);

    expect(verifyPaymentProofUploadIntent(token, 7, 19, now + 1)).toMatchObject({
      storagePath: "payment-proofs/7/19/receipt.png",
      fileSizeBytes: PAYMENT_PROOF_MAX_BYTES,
    });
    expect(verifyPaymentProofUploadIntent(token, 8, 19, now + 1)).toBeNull();
    expect(verifyPaymentProofUploadIntent(token, 7, 20, now + 1)).toBeNull();
    expect(verifyPaymentProofUploadIntent(token, 7, 19, now + 10 * 60 * 1000)).toBeNull();
    const [payload, signature] = token.split(".");
    const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;
    expect(verifyPaymentProofUploadIntent(`${tamperedPayload}.${signature}`, 7, 19, now + 1)).toBeNull();
  });

  it("binds checkout receipt intents to buyer, seller, metadata, file size, and expiry", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "unit-test-key");
    const now = 1_800_000_000_000;
    const token = createCheckoutReceiptUploadIntent({
      buyerId: 7,
      sellerId: 19,
      storagePath: "payment-proofs/7/checkout/receipt.png",
      originalFileName: "receipt.png",
      mimeType: "image/png",
      fileSizeBytes: 128,
    }, now);

    expect(verifyCheckoutReceiptUploadIntent(token, 7, 19, now + 1)).toMatchObject({
      storagePath: "payment-proofs/7/checkout/receipt.png",
      mimeType: "image/png",
      fileSizeBytes: 128,
    });
    expect(verifyCheckoutReceiptUploadIntent(token, 8, 19, now + 1)).toBeNull();
    expect(verifyCheckoutReceiptUploadIntent(token, 7, 20, now + 1)).toBeNull();
    expect(verifyCheckoutReceiptUploadIntent(token, 7, 19, now + 10 * 60 * 1000)).toBeNull();
    expect(isCheckoutReceiptStorageKey("payment-proofs/7/checkout/receipt.png", 7)).toBe(true);
    expect(isCheckoutReceiptStorageKey("payment-proofs/8/checkout/receipt.png", 7)).toBe(false);
  });
});
