import { describe, expect, it } from "vitest";
import { canAccessPaymentRecord, canReviewPaymentProof, canVerifyPaymentRecord } from "./authz";
import { legacyPaymentStatusFromOrder } from "./db";
import {
  assertPaymentCanAcceptProof,
  assertOrderCanAcceptPaymentProof,
  assertPaymentOrderEligibleForVerification,
  assertPaymentProofReadyForReview,
  assertPaymentReadyForVerification,
  latestPaymentReviewNotes,
} from "./marketplaceRules";

describe("Payment foundation authorization and legacy mapping", () => {
  it("maps legacy transaction statuses conservatively without treating them as paid", () => {
    expect(legacyPaymentStatusFromOrder("recorded")).toBe("pending");
    expect(legacyPaymentStatusFromOrder("payment_coordinated")).toBe("pending");
    expect(legacyPaymentStatusFromOrder("F2F-pending-confirmation")).toBe("pending");
    expect(legacyPaymentStatusFromOrder("cancelled")).toBe("cancelled");
    expect(legacyPaymentStatusFromOrder("paid")).toBe("pending");
    expect(legacyPaymentStatusFromOrder("refunded")).toBe("refunded");
    expect(legacyPaymentStatusFromOrder("failed")).toBe("failed");
    expect(legacyPaymentStatusFromOrder(undefined)).toBe("pending");
  });

  it("restricts payment visibility to the buyer, seller, matching cooperative admin, or superadmin", () => {
    const payment = { buyerId: 10, sellerId: 20, cooperativeId: 2 };

    expect(canAccessPaymentRecord({ id: 10, role: "buyer", cooperativeId: null }, payment)).toBe(true);
    expect(canAccessPaymentRecord({ id: 11, role: "buyer", cooperativeId: null }, payment)).toBe(false);
    expect(canAccessPaymentRecord({ id: 20, role: "seller", cooperativeId: 2 }, payment)).toBe(true);
    expect(canAccessPaymentRecord({ id: 21, role: "seller", cooperativeId: 2 }, payment)).toBe(false);
    expect(canAccessPaymentRecord({ id: 30, role: "admin", cooperativeId: 2 }, payment)).toBe(true);
    expect(canAccessPaymentRecord({ id: 31, role: "admin", cooperativeId: 3 }, payment)).toBe(false);
    expect(canAccessPaymentRecord({ id: 99, role: "superadmin", cooperativeId: null }, payment)).toBe(true);
  });

  it("limits payment verification to admin and superadmin, and forbids self or seller verification", () => {
    const payment = { buyerId: 10, sellerId: 20, cooperativeId: 2 };

    expect(canVerifyPaymentRecord({ id: 30, role: "admin", cooperativeId: 2 }, payment)).toBe(true);
    expect(canVerifyPaymentRecord({ id: 31, role: "admin", cooperativeId: 3 }, payment)).toBe(false);
    expect(canVerifyPaymentRecord({ id: 10, role: "admin", cooperativeId: 2 }, payment)).toBe(false);
    expect(canVerifyPaymentRecord({ id: 20, role: "admin", cooperativeId: 2 }, payment)).toBe(false);
    expect(canVerifyPaymentRecord({ id: 10, role: "buyer", cooperativeId: null }, payment)).toBe(false);
    expect(canVerifyPaymentRecord({ id: 20, role: "seller", cooperativeId: 2 }, payment)).toBe(false);
    expect(canVerifyPaymentRecord({ id: 99, role: "superadmin", cooperativeId: null }, payment)).toBe(true);
    expect(canVerifyPaymentRecord({ id: 20, role: "superadmin", cooperativeId: null }, payment)).toBe(false);
  });

  it("scopes proof review to cooperative Admins and platform-wide SuperAdmins", () => {
    const order = { buyerId: 10, sellerId: 20, cooperativeId: 2 };
    expect(canReviewPaymentProof({ id: 30, role: "admin", cooperativeId: 2 }, order)).toBe(true);
    expect(canReviewPaymentProof({ id: 31, role: "admin", cooperativeId: 3 }, order)).toBe(false);
    expect(canReviewPaymentProof({ id: 99, role: "superadmin", cooperativeId: null }, order)).toBe(true);
    expect(canReviewPaymentProof({ id: 20, role: "seller", cooperativeId: 2 }, order)).toBe(false);
    expect(canReviewPaymentProof({ id: 10, role: "admin", cooperativeId: 2 }, order)).toBe(false);
  });

  it("keeps the authoritative payment status independent from legacy order transaction states", () => {
    expect(legacyPaymentStatusFromOrder("recorded")).toBe("pending");
    expect(legacyPaymentStatusFromOrder("payment_coordinated")).toBe("pending");
    expect(legacyPaymentStatusFromOrder("paid")).toBe("pending");
  });

  it("only reviews an awaiting payment with an unreviewed submitted attempt", () => {
    expect(() => assertPaymentReadyForVerification(
      { status: "awaiting_verification" },
      { status: "submitted" },
    )).not.toThrow();
    expect(() => assertPaymentReadyForVerification(
      { status: "awaiting_verification" },
      { status: "under_review" },
    )).not.toThrow();
    expect(() => assertPaymentReadyForVerification(
      { status: "pending" },
      { status: "submitted" },
    )).toThrow("Only a payment awaiting review can be verified.");
    expect(() => assertPaymentReadyForVerification(
      { status: "awaiting_verification" },
      { status: "approved" },
    )).toThrow("A submitted payment proof is required before review.");
    expect(() => assertPaymentReadyForVerification(
      { status: "awaiting_verification" },
      undefined,
    )).toThrow("A submitted payment proof is required before review.");
  });

  it("accepts proof only for explicit GCash payments that can be retried", () => {
    expect(() => assertPaymentCanAcceptProof({ paymentMethod: "gcash", status: "pending" })).not.toThrow();
    expect(() => assertPaymentCanAcceptProof({ paymentMethod: "gcash", status: "failed" })).not.toThrow();
    expect(() => assertPaymentCanAcceptProof({ paymentMethod: "f2f", status: "pending" }))
      .toThrow("Online proof can only be submitted for an explicit GCash payment.");
    expect(() => assertPaymentCanAcceptProof({ paymentMethod: "cash_pickup", status: "pending" }))
      .toThrow("Online proof can only be submitted for an explicit GCash payment.");
    expect(() => assertPaymentCanAcceptProof({ paymentMethod: "gcash", status: "verified" }))
      .toThrow("Only pending or previously rejected payments can accept new proof.");
  });

  it("allows verification only for active orders with an unpaid or rejected payment state", () => {
    for (const status of ["submitted", "confirmed", "ready"]) {
      for (const paymentStatus of ["pending", "failed"]) {
        expect(() => assertPaymentOrderEligibleForVerification({ status, paymentStatus })).not.toThrow();
      }
    }

    for (const status of ["completed", "cancelled"]) {
      expect(() => assertPaymentOrderEligibleForVerification({ status, paymentStatus: "pending" }))
        .toThrow("This order is not eligible for payment verification.");
    }
    for (const paymentStatus of ["paid", "refunded", "cancelled", "F2F-pending-confirmation"]) {
      expect(() => assertPaymentOrderEligibleForVerification({ status: "confirmed", paymentStatus }))
        .toThrow("This order is not eligible for payment verification.");
    }
  });

  it("allows proof resubmission only after rejection on an active, unpaid GCash order", () => {
    const order = { status: "confirmed", paymentStatus: "failed", paymentMethod: "gcash" };
    expect(() => assertOrderCanAcceptPaymentProof(order, { verificationStatus: "rejected" })).not.toThrow();
    expect(() => assertOrderCanAcceptPaymentProof(
      { ...order, paymentStatus: "pending" },
      undefined,
    )).not.toThrow();
    expect(() => assertOrderCanAcceptPaymentProof(order, { verificationStatus: "pending" }))
      .toThrow("A payment proof is already awaiting review or has been verified.");
    expect(() => assertOrderCanAcceptPaymentProof(order, { verificationStatus: "verified" }))
      .toThrow("A payment proof is already awaiting review or has been verified.");
    for (const status of ["cancelled", "completed"]) {
      expect(() => assertOrderCanAcceptPaymentProof({ ...order, status }, undefined))
        .toThrow("Cancelled or completed orders cannot accept payment proof.");
    }
    expect(() => assertOrderCanAcceptPaymentProof({ ...order, paymentMethod: "cash_pickup" }, undefined))
      .toThrow("Online proof can only be submitted for an explicit GCash order.");
  });

  it("prevents duplicate review and review after order completion or payment", () => {
    expect(() => assertPaymentProofReadyForReview(
      { status: "confirmed", paymentStatus: "pending" },
      { verificationStatus: "pending" },
    )).not.toThrow();
    expect(() => assertPaymentProofReadyForReview(
      { status: "confirmed", paymentStatus: "pending" },
      { verificationStatus: "verified" },
    )).toThrow("Only a pending payment proof can be reviewed.");
    expect(() => assertPaymentProofReadyForReview(
      { status: "completed", paymentStatus: "pending" },
      { verificationStatus: "pending" },
    )).toThrow("This order is not eligible for payment verification.");
    expect(() => assertPaymentProofReadyForReview(
      { status: "confirmed", paymentStatus: "paid" },
      { verificationStatus: "pending" },
    )).toThrow("This order is not eligible for payment verification.");
  });

  it("returns the latest verification note per payment and ignores non-review events", () => {
    const notes = latestPaymentReviewNotes([
      { paymentId: 7, eventType: "verification_decision", reason: "Latest review" },
      { paymentId: 7, eventType: "proof_submitted", reason: null },
      { paymentId: 7, eventType: "verification_decision", reason: "Older review" },
      { paymentId: 8, eventType: "verification_decision", reason: null },
    ]);

    expect(notes.get(7)).toBe("Latest review");
    expect(notes.get(8)).toBeNull();
    expect(notes.has(9)).toBe(false);
  });
});
