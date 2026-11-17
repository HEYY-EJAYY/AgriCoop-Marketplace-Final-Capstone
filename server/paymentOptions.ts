export function getPaymentOptionCooperativeId(
  role: "buyer" | "seller" | "admin" | "superadmin",
  actorCooperativeId: number | null,
  requestedCooperativeId?: number | null,
): number | null {
  if (role === "superadmin") return requestedCooperativeId ?? null;
  if (role !== "admin") throw new Error("Only an Admin or SuperAdmin can manage payment option storage.");
  if (actorCooperativeId === null) {
    throw new Error("Admin accounts must be assigned to a cooperative.");
  }
  return actorCooperativeId;
}

export function getPaymentQrStoragePrefix(cooperativeId: number | null): string {
  return cooperativeId === null
    ? "payment-options/platform/"
    : `payment-options/cooperative-${cooperativeId}/`;
}

export function assertPaymentOptionSelection(
  paymentMethod: "cash_pickup" | "cash_delivery" | "gcash",
  paymentOptionId: number | undefined,
  activeOptionMatchesOrder: boolean,
): void {
  if (paymentMethod === "gcash") {
    if (paymentOptionId === undefined || !activeOptionMatchesOrder) {
      throw new Error("Choose an active GCash option for this seller's cooperative.");
    }
    return;
  }
  if (paymentOptionId !== undefined) {
    throw new Error("Cash orders cannot include a GCash payment option.");
  }
}

export function isGcashCheckoutOption(
  option: { cooperativeId: number | null; paymentMethod: string; isActive: boolean },
  orderCooperativeId: number | null,
): boolean {
  return option.isActive
    && option.paymentMethod === "gcash"
    && option.cooperativeId === orderCooperativeId;
}

export function paymentOptionDetailsChanged(
  previous: {
    paymentMethod: string;
    displayName: string;
    accountName: string | null;
    accountNumber: string | null;
    qrImagePath: string | null;
    instructions: string | null;
  },
  next: {
    paymentMethod: string;
    displayName: string;
    accountName: string | null;
    accountNumber: string | null;
    qrImagePath: string | null;
    instructions: string | null;
  },
): boolean {
  return previous.paymentMethod !== next.paymentMethod
    || previous.displayName !== next.displayName
    || previous.accountName !== next.accountName
    || previous.accountNumber !== next.accountNumber
    || previous.qrImagePath !== next.qrImagePath
    || previous.instructions !== next.instructions;
}
