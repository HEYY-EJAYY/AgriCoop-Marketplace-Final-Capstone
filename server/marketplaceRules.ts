export type OrderItemRequest = { productId: number; quantity: number };
export type BuyerQuotation = {
  buyerId: number;
  productId: number;
  requestedQty: number;
  quotedPriceCents: number | null;
  status: string;
};
export type AvailableProduct = {
  id: number;
  sellerId: number;
  cooperativeId: number | null;
  stockQty: number;
  minOrderQty: number;
  priceCents: number;
  unit: string;
  status: string;
  name: string;
};

export function aggregateOrderItems(items: OrderItemRequest[]) {
  const quantities = new Map<number, number>();
  for (const item of items) {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }
  return Array.from(quantities, ([productId, quantity]) => ({ productId, quantity }));
}

export async function applyInventoryDeductions(
  items: OrderItemRequest[],
  runInTransaction: (work: (applyDeduction: (item: OrderItemRequest) => Promise<boolean>) => Promise<void>) => Promise<void>,
) {
  await runInTransaction(async deduct => {
    for (const item of aggregateOrderItems(items)) {
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
    sellerId: products[0].sellerId,
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

export function assertInventorySufficient(products: AvailableProduct[], items: OrderItemRequest[]) {
  const productMap = new Map(products.map(product => [product.id, product]));
  for (const item of aggregateOrderItems(items)) {
    const product = productMap.get(item.productId);
    if (!product || product.stockQty < item.quantity) throw new Error("Insufficient current inventory to complete this order.");
  }
}

export function isQuotationOpen(status: string) {
  return status === "requested";
}

export function assertNotSelfTransaction(actorId: number, sellerId: number) {
  if (actorId === sellerId) throw new Error("You cannot request a quotation or place an order for your own listing.");
}

export function transactionStatusFor(paymentReferenceNote?: string) {
  return paymentReferenceNote ? "payment_coordinated" as const : "recorded" as const;
}
