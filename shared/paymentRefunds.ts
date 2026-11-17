export const REFUND_STATES = ["recorded", "pending", "completed", "cancelled"] as const;
export type RefundState = (typeof REFUND_STATES)[number];

export type RefundRecord = {
  refundId: string;
  amountCents: number;
  status: RefundState;
  reason: string;
  confirmationReference?: string;
};

export type RefundAuditEvent = {
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  metadata: string | null;
};

function isRefundState(value: unknown): value is RefundState {
  return typeof value === "string" && REFUND_STATES.includes(value as RefundState);
}

function parseRefundMetadata(metadata: string | null) {
  if (!metadata) throw new Error("Refund history is incomplete.");
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Refund history is invalid.");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("Refund history is invalid.");
  }
}

export function parseRefundRecords(events: RefundAuditEvent[]): RefundRecord[] {
  const records = new Map<string, RefundRecord>();
  for (const event of events) {
    if (event.eventType !== "refund_recorded" && event.eventType !== "refund_status_changed") continue;
    const metadata = parseRefundMetadata(event.metadata);
    const refundId = metadata.refundId;
    const amountCents = metadata.amountCents;
    const status = metadata.status;
    if (
      typeof refundId !== "string"
      || !refundId
      || typeof amountCents !== "number"
      || !Number.isSafeInteger(amountCents)
      || Number(amountCents) <= 0
      || !isRefundState(status)
      || event.toStatus !== status
    ) {
      throw new Error("Refund history is invalid.");
    }

    if (event.eventType === "refund_recorded") {
      if (records.has(refundId) || status !== "recorded" || event.fromStatus !== null) {
        throw new Error("Refund history has a duplicate or invalid initial event.");
      }
      records.set(refundId, {
        refundId,
        amountCents: Number(amountCents),
        status,
        reason: event.reason?.trim() ?? "",
      });
      continue;
    }

    const current = records.get(refundId);
    if (current && current.status === status) {
      throw new Error("Refund history contains a duplicate transition event.");
    }
    if (!current || current.amountCents !== amountCents || event.fromStatus !== current.status) {
      throw new Error("Refund history has an inconsistent state transition.");
    }
    const confirmationReference = typeof metadata.confirmationReference === "string"
      ? metadata.confirmationReference
      : undefined;
    const next = transitionRefundRecord(Array.from(records.values()), refundId, status, confirmationReference);
    if (!next.changed) throw new Error("Refund history contains a duplicate transition event.");
    records.set(refundId, {
      ...next.record,
      reason: current.reason,
    });
  }
  return Array.from(records.values());
}

export function reservedRefundAmountCents(records: readonly RefundRecord[]) {
  let total = 0;
  for (const record of records) {
    if (record.status === "cancelled") continue;
    total += record.amountCents;
    if (!Number.isSafeInteger(total)) throw new Error("Refund amount exceeds the supported range.");
  }
  return total;
}

export function completedRefundAmountCents(records: readonly RefundRecord[]) {
  let total = 0;
  for (const record of records) {
    if (record.status !== "completed") continue;
    total += record.amountCents;
    if (!Number.isSafeInteger(total)) throw new Error("Refund amount exceeds the supported range.");
  }
  return total;
}

export function createRefundRecord(
  records: readonly RefundRecord[],
  input: { refundId: string; amountCents: number; reason: string },
  verifiedAmountCents: number,
) {
  const existing = records.find(record => record.refundId === input.refundId);
  if (existing) {
    if (existing.amountCents !== input.amountCents || existing.reason !== input.reason.trim()) {
      throw new Error("The refund idempotency key was already used with different details.");
    }
    return { record: existing, created: false };
  }
  if (!Number.isSafeInteger(verifiedAmountCents) || verifiedAmountCents <= 0) {
    throw new Error("The verified payment amount is invalid.");
  }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Refund amounts must be positive whole cents.");
  }
  if (!input.reason.trim()) throw new Error("A refund reason is required.");
  const totalReserved = reservedRefundAmountCents(records) + input.amountCents;
  if (!Number.isSafeInteger(totalReserved) || totalReserved > verifiedAmountCents) {
    throw new Error("Total refunds cannot exceed the verified payment amount.");
  }
  return {
    record: {
      refundId: input.refundId,
      amountCents: input.amountCents,
      status: "recorded" as const,
      reason: input.reason.trim(),
    },
    created: true,
  };
}

export function canTransitionRefundState(current: RefundState, next: RefundState) {
  const allowed: Record<RefundState, readonly RefundState[]> = {
    recorded: ["pending", "cancelled"],
    pending: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
  };
  return allowed[current].includes(next);
}

export function transitionRefundRecord(
  records: readonly RefundRecord[],
  refundId: string,
  nextStatus: RefundState,
  confirmationReference?: string,
) {
  const current = records.find(record => record.refundId === refundId);
  if (!current) throw new Error("Refund record was not found.");
  if (current.status === nextStatus) return { record: current, changed: false };
  if (!canTransitionRefundState(current.status, nextStatus)) {
    throw new Error(`Cannot change a ${current.status} refund to ${nextStatus}.`);
  }
  const normalizedReference = confirmationReference?.trim();
  if (nextStatus === "completed" && !normalizedReference) {
    throw new Error("A confirmation reference is required before completing a refund.");
  }
  return {
    record: {
      ...current,
      status: nextStatus,
      ...(nextStatus === "completed" ? { confirmationReference: normalizedReference } : {}),
    },
    changed: true,
  };
}
