import { formatEnumLabel } from "./enumLabels";

/** Canonical payment methods for new orders. Legacy values are display-mapped only. */
export const PAYMENT_METHODS = ["cash_pickup", "cash_delivery", "online"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const FULFILLMENT_METHODS = ["pickup", "delivery"] as const;
export type FulfillmentMethod = (typeof FULFILLMENT_METHODS)[number];

export const LEGACY_PAYMENT_METHODS = ["gcash", "f2f"] as const;

export type ListingPaymentFlags = {
  allowsPickup: boolean;
  allowsDelivery: boolean;
  /** @deprecated Ignored for checkout availability; online is a system setting. Kept for legacy DTO compatibility. */
  acceptsOnlinePayment?: boolean;
};

/** Platform toggles + whether an active online account+QR exists. */
export type SystemPaymentAvailability = {
  cashPickupEnabled: boolean;
  cashDeliveryEnabled: boolean;
  onlineEnabled: boolean;
  onlineAccountReady: boolean;
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
      return "F2F";
    default:
      return value ? formatEnumLabel(value) : "Payment";
  }
}

export function paymentStatusLabel(value: string | null | undefined): string {
  switch (value) {
    case "pending":
    case "F2F-pending-confirmation":
      return "Awaiting Payment";
    case "awaiting_verification":
      return "Awaiting Verification";
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
      return value ? formatEnumLabel(value) : "Unknown";
  }
}

export function fulfillmentLabel(value: string | null | undefined): string {
  if (value === "pickup") return "Pickup";
  if (value === "delivery") return "Delivery";
  return value ? formatEnumLabel(value) : "Fulfillment";
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

/**
 * Intersection of supported payment methods across a seller group of listings.
 * Pickup/delivery require listing flags AND system toggles.
 * Online requires system online enabled + active account/QR (identical for every seller).
 */
export function methodsForListings(
  listings: ListingPaymentFlags[],
  availability: boolean | SystemPaymentAvailability,
): PaymentMethod[] {
  if (!listings.length) return [];
  const system: SystemPaymentAvailability = typeof availability === "boolean"
    ? {
      // Legacy boolean = “seller has QR”; treat as online-only hint for old call sites/tests.
      cashPickupEnabled: true,
      cashDeliveryEnabled: true,
      onlineEnabled: availability,
      onlineAccountReady: availability,
    }
    : availability;
  const pickup = system.cashPickupEnabled && listings.every(l => l.allowsPickup);
  const delivery = system.cashDeliveryEnabled && listings.every(l => l.allowsDelivery);
  const online = system.onlineEnabled
    && system.onlineAccountReady
    && (listings.every(listing => listing.allowsPickup) || listings.every(listing => listing.allowsDelivery));
  const methods: PaymentMethod[] = [];
  if (pickup) methods.push("cash_pickup");
  if (delivery) methods.push("cash_delivery");
  if (online) methods.push("online");
  return methods;
}

export function paymentMethodAvailability(
  method: PaymentMethod,
  listings: ListingPaymentFlags[],
  availability: SystemPaymentAvailability,
) {
  if (!listings.length) return { available: false, reason: "Add a product to see available payment methods." };
  if (method === "cash_pickup") {
    if (!listings.every(listing => listing.allowsPickup)) {
      return { available: false, reason: "This seller doesn't offer pickup." };
    }
    if (!availability.cashPickupEnabled) {
      return { available: false, reason: "Cash on pickup is temporarily unavailable." };
    }
  }
  if (method === "cash_delivery") {
    if (!listings.every(listing => listing.allowsDelivery)) {
      return { available: false, reason: "This seller doesn't offer delivery." };
    }
    if (!availability.cashDeliveryEnabled) {
      return { available: false, reason: "Cash on delivery is temporarily unavailable." };
    }
  }
  if (method === "online") {
    if (!listings.every(listing => listing.allowsPickup) && !listings.every(listing => listing.allowsDelivery)) {
      return { available: false, reason: "These listings don't share a pickup or delivery option." };
    }
    if (!availability.onlineEnabled || !availability.onlineAccountReady) {
      return { available: false, reason: "Online payment isn't set up yet." };
    }
  }
  return { available: true, reason: null };
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
  cash_pickup: "Pay in cash when you collect your order. An officer confirms cash received.",
  cash_delivery: "Pay in cash when your order is delivered. An officer confirms cash received.",
  online: "Pay via the AgriCoop QR code and upload your receipt before placing the order.",
};
