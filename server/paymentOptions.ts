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
  paymentMethod: "cash_pickup" | "cash_delivery" | "gcash" | "online",
  paymentOptionId: number | undefined,
  activeOptionMatchesOrder: boolean,
): void {
  // Online payment uses the seller's own QR; optional legacy coop paymentOptionId is allowed when present.
  if (paymentMethod === "gcash" || paymentMethod === "online") {
    if (paymentOptionId !== undefined && !activeOptionMatchesOrder) {
      throw new Error("The selected online payment option is not available for this seller.");
    }
    return;
  }
  if (paymentOptionId !== undefined) {
    throw new Error("Cash orders cannot include an online payment option.");
  }
}

export function isGcashCheckoutOption(
  option: { cooperativeId: number | null; paymentMethod: string; isActive: boolean },
  orderCooperativeId: number | null,
): boolean {
  return option.isActive
    && option.paymentMethod === "gcash"
    && option.cooperativeId !== null
    && option.cooperativeId === orderCooperativeId;
}

const QR_CHECKOUT_PROVIDERS = new Set(["gcash", "online", "maya", "maribank", "gotyme", "other"]);

/**
 * Any active QR option usable for an online payment order. Options must be
 * explicitly assigned to the order's cooperative — platform-wide (NULL)
 * assignments are never checkout-eligible.
 */
export function isQrCheckoutOption(
  option: { cooperativeId: number | null; paymentMethod: string; isActive: boolean },
  orderCooperativeId: number | null,
): boolean {
  return option.isActive
    && QR_CHECKOUT_PROVIDERS.has(option.paymentMethod)
    && option.cooperativeId !== null
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
