/** Canonical payment methods for new orders. Legacy values are display-mapped only. */
export const PAYMENT_METHODS = ["cash_pickup", "cash_delivery", "online"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const FULFILLMENT_METHODS = ["pickup", "delivery"] as const;
export type FulfillmentMethod = (typeof FULFILLMENT_METHODS)[number];

export const LEGACY_PAYMENT_METHODS = ["gcash", "f2f"] as const;

export type ListingPaymentFlags = {
  allowsPickup: boolean;
  allowsDelivery: boolean;
  acceptsOnlinePayment: boolean;
};

export function isPaymentMethod(value: string | null | undefined): value is PaymentMethod {
  return value === "cash_pickup" || value === "cash_delivery" || value === "online";
}

/** Normalize API input: accept legacy `gcash` as `online` for new creates. */
export function normalizePaymentMethodInput(value: string): PaymentMethod | null {
  if (value === "gcash" || value === "online") return "online";
  if (value === "cash_pickup" || value === "cash_delivery") return value;
  return null;
}

export function paymentMethodLabel(value: string | null | undefined): string {
  switch (value) {
    case "cash_pickup":
      return "Cash on Pickup";
    case "cash_delivery":
      return "Cash on Delivery";
    case "online":
    case "gcash":
      return "Online Payment";
    case "f2f":
      return "Face-to-face (legacy)";
    default:
      return value ? value.replaceAll("_", " ") : "Payment";
  }
}

export function paymentStatusLabel(value: string | null | undefined): string {
  switch (value) {
    case "pending":
    case "F2F-pending-confirmation":
      return "Awaiting payment";
    case "awaiting_verification":
      return "Awaiting verification";
    case "paid":
    case "verified":
      return "Paid";
    case "failed":
      return "Rejected";
    case "cancelled":
      return "Cancelled";
    case "refunded":
      return "Refunded";
    case "expired":
      return "Expired";
    default:
      return value ? value.replaceAll("_", " ") : "Unknown";
  }
}

export function fulfillmentLabel(value: string | null | undefined): string {
  if (value === "pickup") return "Pickup";
  if (value === "delivery") return "Delivery";
  return value ? value.replaceAll("_", " ") : "Fulfillment";
}

/** Infer fulfillment from a cash payment method when fulfillmentMethod is null (legacy). */
export function fulfillmentFromPaymentMethod(paymentMethod: string | null | undefined): FulfillmentMethod | null {
  if (paymentMethod === "cash_pickup") return "pickup";
  if (paymentMethod === "cash_delivery") return "delivery";
  return null;
}

export function defaultFulfillmentForPayment(
  paymentMethod: PaymentMethod,
  flags: ListingPaymentFlags,
): FulfillmentMethod | null {
  if (paymentMethod === "cash_pickup") return flags.allowsPickup ? "pickup" : null;
  if (paymentMethod === "cash_delivery") return flags.allowsDelivery ? "delivery" : null;
  if (flags.allowsPickup) return "pickup";
  if (flags.allowsDelivery) return "delivery";
  return null;
}

/** Intersection of supported payment methods across a seller group of listings. */
export function methodsForListings(
  listings: ListingPaymentFlags[],
  sellerHasOnlineQr: boolean,
): PaymentMethod[] {
  if (!listings.length) return [];
  const pickup = listings.every(l => l.allowsPickup);
  const delivery = listings.every(l => l.allowsDelivery);
  const online = listings.every(l => l.acceptsOnlinePayment) && sellerHasOnlineQr;
  const methods: PaymentMethod[] = [];
  if (pickup) methods.push("cash_pickup");
  if (delivery) methods.push("cash_delivery");
  if (online) methods.push("online");
  return methods;
}

export function fulfillmentOptionsForListings(listings: ListingPaymentFlags[]): FulfillmentMethod[] {
  if (!listings.length) return [];
  const options: FulfillmentMethod[] = [];
  if (listings.every(l => l.allowsPickup)) options.push("pickup");
  if (listings.every(l => l.allowsDelivery)) options.push("delivery");
  return options;
}

export function isPaymentSettled(paymentStatus: string | null | undefined): boolean {
  return paymentStatus === "paid" || paymentStatus === "verified";
}

export const PAYMENT_METHOD_HELPERS: Record<PaymentMethod, string> = {
  cash_pickup: "Pay the seller in cash when you collect your order.",
  cash_delivery: "Pay the seller in cash when your order is delivered.",
  online: "Pay via the seller’s QR code and upload your receipt before placing the order.",
};
