import { describe, expect, it } from "vitest";
import {
  completedRefundAmountCents,
  createRefundRecord,
  parseRefundRecords,
  reservedRefundAmountCents,
  transitionRefundRecord,
} from "../shared/paymentRefunds";

describe("payment refund lifecycle", () => {
  const firstRefund = {
    refundId: "refund-one",
    amountCents: 2500,
    status: "recorded" as const,
    reason: "Damaged produce",
  };

  it("limits recorded refunds to the verified amount and makes retries idempotent", () => {
    const created = createRefundRecord([], firstRefund, 5000);
    expect(created).toEqual({ record: firstRefund, created: true });
    expect(createRefundRecord([firstRefund], firstRefund, 5000)).toEqual({ record: firstRefund, created: false });
    expect(() => createRefundRecord([firstRefund], {
      ...firstRefund,
      amountCents: 2600,
    }, 5000)).toThrow("idempotency key");
    expect(() => createRefundRecord([firstRefund], {
      refundId: "refund-two",
      amountCents: 2501,
      reason: "Second refund",
    }, 5000)).toThrow("cannot exceed");
    expect(() => createRefundRecord([], {
      refundId: "refund-zero",
      amountCents: 0,
      reason: "Invalid",
    }, 5000)).toThrow("positive whole cents");
  });

  it("requires a pending refund and an explicit confirmation before completion", () => {
    expect(() => transitionRefundRecord([firstRefund], firstRefund.refundId, "completed", "REF-1"))
      .toThrow("Cannot change a recorded refund to completed");
    const pending = transitionRefundRecord([firstRefund], firstRefund.refundId, "pending");
    expect(pending.record.status).toBe("pending");
    expect(() => transitionRefundRecord([pending.record], firstRefund.refundId, "completed"))
      .toThrow("confirmation reference");
    const completed = transitionRefundRecord([pending.record], firstRefund.refundId, "completed", "GCASH-REF-1");
    expect(completed.record).toMatchObject({ status: "completed", confirmationReference: "GCASH-REF-1" });
    expect(transitionRefundRecord([completed.record], firstRefund.refundId, "completed").changed).toBe(false);
    expect(() => transitionRefundRecord([completed.record], firstRefund.refundId, "cancelled"))
      .toThrow("Cannot change a completed refund");
  });

  it("releases cancelled reservations and totals completed refunds", () => {
    const second = { refundId: "refund-two", amountCents: 2500, status: "cancelled" as const, reason: "Duplicate request" };
    expect(reservedRefundAmountCents([firstRefund, second])).toBe(2500);
    expect(completedRefundAmountCents([firstRefund, second])).toBe(0);
    const pending = transitionRefundRecord([firstRefund], firstRefund.refundId, "pending").record;
    const completed = transitionRefundRecord([pending], firstRefund.refundId, "completed", "BANK-REF-2").record;
    expect(completedRefundAmountCents([completed, second])).toBe(2500);
  });

  it("reconstructs and validates refund states from auditable payment events", () => {
    const events = [
      {
        eventType: "refund_recorded",
        fromStatus: null,
        toStatus: "recorded",
        reason: "Damaged produce",
        metadata: JSON.stringify({ refundId: firstRefund.refundId, amountCents: 2500, status: "recorded" }),
      },
      {
        eventType: "refund_status_changed",
        fromStatus: "recorded",
        toStatus: "pending",
        reason: null,
        metadata: JSON.stringify({ refundId: firstRefund.refundId, amountCents: 2500, status: "pending" }),
      },
      {
        eventType: "refund_status_changed",
        fromStatus: "pending",
        toStatus: "completed",
        reason: "GCASH-REF-3",
        metadata: JSON.stringify({
          refundId: firstRefund.refundId,
          amountCents: 2500,
          status: "completed",
          confirmationReference: "GCASH-REF-3",
        }),
      },
    ];
    expect(parseRefundRecords(events)).toEqual([{
      ...firstRefund,
      status: "completed",
      confirmationReference: "GCASH-REF-3",
    }]);
    expect(() => parseRefundRecords([...events, events[2]])).toThrow("duplicate transition");
  });
});
