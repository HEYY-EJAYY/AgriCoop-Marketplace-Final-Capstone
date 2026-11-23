export type OrderItemRequest = { productId: number; quantity: number };
export type OrderItemCompletion = {
  id: number;
  productId: number;
  quantity: number;
  unitPriceCents: number;
};
export type FinalOrderItemQuantity = { orderItemId: number; quantity: number };
export type BuyerQuotation = {
  buyerId: number;
  productId: number;
  requestedQty: number;
  quotedPriceCents: number | null;
  status: string;
};
export type AvailableProduct = {
  id: number;
  sellerId: number | null;
  cooperativeId: number | null;
  stockQty: number;
  minOrderQty: number;
  priceCents: number;
  unit: string;
  status: string;
  name: string;
};

export type PurchasabilityProduct = {
  name: string;
  unit: string;
  status: string;
  verificationStatus: string;
  visibility: string;
  deletedAt?: Date | null;
  stockQty: number;
  minOrderQty: number;
  allowsPickup?: boolean | null;
  allowsDelivery?: boolean | null;
};

export type PurchasabilitySeller = {
  approvalStatus: string;
  deletedAt?: Date | null;
};

export function productPurchaseBlockReason(
  product: PurchasabilityProduct,
  seller: PurchasabilitySeller,
) {
  if (
    product.deletedAt
    || product.status !== "published"
    || product.verificationStatus !== "approved"
    || product.visibility !== "visible"
  ) {
    return `${product.name} is not currently listed for purchase.`;
  }
  if (seller.deletedAt || seller.approvalStatus !== "approved") {
    return `${product.name}'s seller is not currently approved to sell.`;
  }
  if (product.allowsPickup === false && product.allowsDelivery === false) {
    return `${product.name} has no pickup or delivery option available.`;
  }
  if (product.stockQty < product.minOrderQty) {
    return `${product.name} has only ${product.stockQty} ${product.unit} available; the minimum order is ${product.minOrderQty} ${product.unit}.`;
  }
  return null;
}

export function aggregateOrderItems(items: OrderItemRequest[]) {
  const quantities = new Map<number, number>();
  for (const item of items) {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }
  return Array.from(quantities, ([productId, quantity]) => ({ productId, quantity }));
}

export const STOCK_RESERVING_ORDER_STATUSES = ["submitted", "confirmed", "ready"] as const;

export function availableStockAfterReservations(stockQty: number, reservedQty: number) {
  return Math.max(0, stockQty - reservedQty);
}

export async function applyInventoryDeductions(
  items: OrderItemRequest[],
  runInTransaction: (work: (applyDeduction: (item: OrderItemRequest) => Promise<boolean>) => Promise<void>) => Promise<void>,
) {
  await runInTransaction(async deduct => {
    for (const item of aggregateOrderItems(items)) {
      if (item.quantity === 0) continue;
      if (!(await deduct(item))) {
        throw new Error("Insufficient current inventory to complete this order.");
      }
    }
  });
}

export function priceOrderItems(
  items: OrderItemRequest[],
  products: Map<number, AvailableProduct>,
  quotedUnitPriceCents?: number,
) {
  const lines = items.map(item => ({
    ...item,
    unitPriceCents: quotedUnitPriceCents ?? products.get(item.productId)!.priceCents,
  }));
  return {
    lines,
    totalCents: lines.reduce((total, item) => total + item.unitPriceCents * item.quantity, 0),
  };
}

export function canDecideBuyerQuotation(actorId: number, quotation: Pick<BuyerQuotation, "buyerId" | "status">) {
  return quotation.buyerId === actorId && quotation.status === "responded";
}

export function canPlaceAcceptedQuotationOrder(actorId: number, quotation: BuyerQuotation, items: OrderItemRequest[]) {
  return quotation.buyerId === actorId
    && quotation.status === "accepted"
    && quotation.quotedPriceCents !== null
    && items.length === 1
    && items[0].productId === quotation.productId
    && items[0].quantity === quotation.requestedQty;
}

export function prepareOrder(products: AvailableProduct[], items: OrderItemRequest[]) {
  const aggregatedItems = aggregateOrderItems(items);
  const productIds = new Set(aggregatedItems.map(item => item.productId));
  if (products.length !== productIds.size || products.some(product => product.status !== "published")) {
    throw new Error("One or more selected items are no longer available.");
  }
  const sellerIds = new Set(products.map(product => product.sellerId));
  if (sellerIds.size !== 1) {
    throw new Error("A bulk order must contain products from one seller. Please submit separate orders for other farms.");
  }
  const sellerId = products[0].sellerId;
  if (sellerId === null) {
    throw new Error("One or more selected items are no longer available.");
  }
  const productMap = new Map(products.map(product => [product.id, product]));
  for (const item of aggregatedItems) {
    const product = productMap.get(item.productId);
    if (!product) throw new Error("One or more selected items are no longer available.");
    if (item.quantity < product.minOrderQty) {
      throw new Error(`${product.name} has a minimum order of ${product.minOrderQty} ${product.unit}.`);
    }
    if (item.quantity > product.stockQty) {
      throw new Error(`${product.name} has only ${product.stockQty} ${product.unit} available.`);
    }
  }
  return {
    sellerId,
    cooperativeId: products[0].cooperativeId,
    orderType: aggregatedItems.length === 1 ? "regular" as const : "bulk" as const,
    productMap,
    items: aggregatedItems,
  };
}

const transitions: Record<string, string[]> = {
  submitted: ["confirmed", "cancelled"],
  confirmed: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionOrder(current: string, next: string) {
  return transitions[current]?.includes(next) ?? false;
}

export function canCancelOrderPayment(
  paymentStatus: string,
  orderPaymentStatus: string,
  transactionStatus: string,
) {
  if (paymentStatus === "refunded" || orderPaymentStatus === "refunded") {
    return paymentStatus === "refunded"
      && orderPaymentStatus === "refunded"
      && transactionStatus === "paid";
  }
  if (paymentStatus === "verified" || orderPaymentStatus === "paid" || orderPaymentStatus === "verified" || transactionStatus === "paid") {
    return false;
  }
  return ["pending", "awaiting_verification", "failed", "expired"].includes(paymentStatus)
    && ["pending", "failed", "F2F-pending-confirmation", "awaiting_verification", "expired"].includes(orderPaymentStatus)
    && ["recorded", "payment_coordinated", "pending", "failed"].includes(transactionStatus);
}

export function assertInventorySufficient(products: AvailableProduct[], items: OrderItemRequest[]) {
  const productMap = new Map(products.map(product => [product.id, product]));
  for (const item of aggregateOrderItems(items)) {
    const product = productMap.get(item.productId);
    if (!product) throw new Error("A product in this order could not be found.");
    if (product.stockQty < item.quantity) {
      throw new Error(`Insufficient current inventory: ${product.name} has ${product.stockQty} ${product.unit}, but ${item.quantity} ${product.unit} are required.`);
    }
  }
}

export function prepareOrderCompletion(
  items: OrderItemCompletion[],
  finalQuantities: FinalOrderItemQuantity[],
) {
  if (items.length !== finalQuantities.length) {
    throw new Error("Enter a final delivered quantity for every order item.");
  }

  const quantitiesByItemId = new Map<number, number>();
  for (const finalItem of finalQuantities) {
    if (quantitiesByItemId.has(finalItem.orderItemId)) {
      throw new Error("Each order item must have exactly one final delivered quantity.");
    }
    if (!Number.isSafeInteger(finalItem.quantity) || finalItem.quantity < 0) {
      throw new Error("Final delivered quantities must be non-negative whole numbers.");
    }
    quantitiesByItemId.set(finalItem.orderItemId, finalItem.quantity);
  }

  const completedItems = items.map(item => {
    if (!quantitiesByItemId.has(item.id)) {
      throw new Error("Enter a final delivered quantity for every order item.");
    }
    const quantity = quantitiesByItemId.get(item.id)!;
    if (quantity > item.quantity) {
      throw new Error("Final delivered quantity cannot exceed the quantity ordered.");
    }
    return { ...item, quantity };
  });
  if (!completedItems.some(item => item.quantity > 0)) {
    throw new Error("At least one final delivered quantity must be greater than zero.");
  }

  return {
    items: completedItems,
    totalCents: completedItems.reduce((total, item) => total + item.quantity * item.unitPriceCents, 0),
  };
}

export function reconcilePaymentAmount(
  payment: { amountCents: number; status: string },
  orderAmountCents: number,
) {
  if (payment.amountCents === orderAmountCents) return null;
  if (payment.status !== "pending") {
    throw new Error("The order total cannot change because its payment is no longer pending.");
  }
  return {
    previousAmountCents: payment.amountCents,
    amountCents: orderAmountCents,
  };
}

export function assertPaymentConfirmed(payment: { status: string }) {
  if (payment.status !== "verified") {
    throw new Error("Payment must be verified before the order can be completed.");
  }
}

export function assertPaymentReadyForVerification(
  payment: { status: string },
  attempt: { status: string } | undefined,
) {
  if (payment.status !== "awaiting_verification") {
    throw new Error("Only a payment awaiting review can be verified.");
  }
  if (!attempt || (attempt.status !== "submitted" && attempt.status !== "under_review")) {
    throw new Error("A submitted payment proof is required before review.");
  }
}

export function assertPaymentOrderEligibleForVerification(order: {
  status: string;
  paymentStatus: string;
}) {
  if (!["submitted", "confirmed", "ready"].includes(order.status)
    || !["pending", "awaiting_verification", "failed"].includes(order.paymentStatus)) {
    throw new Error("This order is not eligible for payment verification.");
  }
}

export function latestPaymentReviewNotes(events: Array<{
  paymentId: number;
  eventType: string;
  reason: string | null;
}>) {
  const notes = new Map<number, string | null>();
  for (const event of events) {
    if (event.eventType === "verification_decision" && !notes.has(event.paymentId)) {
      notes.set(event.paymentId, event.reason);
    }
  }
  return notes;
}

function isOnlineOrderPaymentMethod(method: string | null | undefined) {
  return method === "gcash" || method === "online";
}

export function assertPaymentCanAcceptProof(payment: { paymentMethod: string; status: string }) {
  if (!isOnlineOrderPaymentMethod(payment.paymentMethod)) {
    throw new Error("Online proof can only be submitted for an online payment.");
  }
  if (payment.status !== "pending" && payment.status !== "failed") {
    throw new Error("Only pending or previously rejected payments can accept new proof.");
  }
}

export function assertOrderCanAcceptPaymentProof(
  order: { status: string; paymentStatus: string; paymentMethod: string | null },
  latestProof: { verificationStatus: string } | undefined,
) {
  if (!isOnlineOrderPaymentMethod(order.paymentMethod)) {
    throw new Error("Online proof can only be submitted for an online payment order.");
  }
  if (!["submitted", "confirmed", "ready"].includes(order.status)) {
    throw new Error("Cancelled or completed orders cannot accept payment proof.");
  }
  if (order.paymentStatus !== "pending" && order.paymentStatus !== "failed") {
    throw new Error("Only unpaid or rejected online payment orders can accept payment proof.");
  }
  if (latestProof && latestProof.verificationStatus !== "rejected") {
    throw new Error("A payment proof is already awaiting review or has been verified.");
  }
}

export function assertPaymentProofReadyForReview(
  order: { status: string; paymentStatus: string },
  proof: { verificationStatus: string },
) {
  assertPaymentOrderEligibleForVerification(order);
  if (proof.verificationStatus !== "pending") {
    throw new Error("Only a pending payment proof can be reviewed.");
  }
}

export function isQuotationOpen(status: string) {
  return status === "requested";
}

type ProductReviewFields = {
  verificationStatus: string;
  name: string;
  category: string;
  variety: string;
  description: string | null;
  unit: string;
  priceCents: number;
  minOrderQty: number;
  qualityGrade: string;
  primaryImageUrl: string | null;
};

const productReviewFieldNames = [
  "name",
  "category",
  "variety",
  "description",
  "unit",
  "priceCents",
  "minOrderQty",
  "qualityGrade",
] as const satisfies readonly (keyof ProductReviewFields)[];

export function prepareProductUpdateReviewState(
  current: ProductReviewFields,
  updates: Partial<Omit<ProductReviewFields, "primaryImageUrl">> & { stockQty?: number; status?: string },
  currentImageUrls: readonly string[],
  nextImageUrls: readonly string[],
  nextPrimaryImageUrl: string | null,
) {
  const listingContentChanged = productReviewFieldNames.some(
    field => updates[field] !== undefined && updates[field] !== current[field],
  );
  const galleryChanged = currentImageUrls.length !== nextImageUrls.length
    || currentImageUrls.some((url, index) => url !== nextImageUrls[index]);
  const contentChanged = listingContentChanged || galleryChanged || current.primaryImageUrl !== nextPrimaryImageUrl;
  const reviewRequired = contentChanged && current.verificationStatus === "approved";
  return {
    reviewRequired,
    moderationUpdate: reviewRequired
      ? {
          verificationStatus: "pending" as const,
          visibility: "hidden" as const,
          rejectionReason: null,
        }
      : {},
  };
}

export function prepareProductReview(
  currentStatus: string,
  decision: "approved" | "rejected",
  rejectionReason?: string,
) {
  if (currentStatus !== "pending") {
    throw new Error("Only a pending product submission can be reviewed.");
  }
  const reason = rejectionReason?.trim();
  if (decision === "rejected" && !reason) {
    throw new Error("A rejection reason is required.");
  }
  return {
    verificationStatus: decision,
    visibility: decision === "approved" ? "visible" as const : "hidden" as const,
    status: decision === "approved" ? "published" as const : "archived" as const,
    rejectionReason: decision === "rejected" ? reason! : null,
  };
}

export function assertNotSelfTransaction(actorId: number, sellerId: number | null) {
  if (actorId === sellerId) throw new Error("You cannot request a quotation or place an order for your own listing.");
}

export function transactionStatusFor(paymentReferenceNote?: string, paymentStatus?: string) {
  if (paymentStatus === "paid" || paymentStatus === "verified" || paymentStatus === "refunded") return "paid" as const;
  if (paymentStatus === "failed" || paymentStatus === "expired") return "failed" as const;
  if (paymentStatus === "awaiting_verification") return "pending" as const;
  return paymentReferenceNote ? "payment_coordinated" as const : "recorded" as const;
}

export type OfficerApprovalItem = {
  productId: number;
  quantity: number;
  fulfillmentType: string | null;
  stockQty: number;
  name: string;
};

const SELLER_CONFIRMATION_LABELS: Record<string, string> = {
  pending: "awaiting the seller's response",
  available: "confirmed available",
  partially_available: "only partially available",
  unavailable: "reported unavailable",
  needs_clarification: "needs clarification",
};

export function evaluateOfficerApproval(input: {
  items: OfficerApprovalItem[];
  reservedByOthers: Map<number, number>;
  sellerConfirmationStatus: string | null;
}): string | null {
  const orderBased = input.items.filter(item => item.fulfillmentType === "order_based");
  if (orderBased.length > 0 && input.sellerConfirmationStatus !== "available") {
    const state = input.sellerConfirmationStatus
      ? SELLER_CONFIRMATION_LABELS[input.sellerConfirmationStatus] ?? input.sellerConfirmationStatus
      : "not yet requested";
    return `This order contains made-to-order items and the seller confirmation is ${state}. Request seller confirmation and wait for an available response before approving.`;
  }
  const shortages = input.items
    .filter(item => item.fulfillmentType !== "order_based")
    .filter(item => {
      const reserved = input.reservedByOthers.get(item.productId) ?? 0;
      return item.stockQty - reserved < item.quantity;
    })
    .map(item => item.name);
  if (shortages.length > 0) {
    return `Insufficient available stock for: ${shortages.join(", ")}. Request seller confirmation or adjust the order before approving.`;
  }
  return null;
}
