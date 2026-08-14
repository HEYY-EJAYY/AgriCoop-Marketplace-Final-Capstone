export type OrderItemRequest = { productId: number; quantity: number };
export type AvailableProduct = {
  id: number;
  sellerId: number;
  cooperativeId: number | null;
  stockQty: number;
  priceCents: number;
  status: string;
  name: string;
};

export function prepareOrder(products: AvailableProduct[], items: OrderItemRequest[]) {
  const productIds = new Set(items.map(item => item.productId));
  if (products.length !== productIds.size || products.some(product => product.status !== "published")) {
    throw new Error("One or more selected items are no longer available.");
  }
  const sellerIds = new Set(products.map(product => product.sellerId));
  if (sellerIds.size !== 1) {
    throw new Error("A bulk order must contain products from one seller. Please submit separate orders for other farms.");
  }
  const productMap = new Map(products.map(product => [product.id, product]));
  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product || item.quantity > product.stockQty) throw new Error(`${product?.name || "Selected product"} does not have enough stock for that quantity.`);
  }
  return {
    sellerId: products[0].sellerId,
    cooperativeId: products[0].cooperativeId,
    orderType: items.length === 1 ? "regular" as const : "bulk" as const,
    totalCents: items.reduce((total, item) => total + productMap.get(item.productId)!.priceCents * item.quantity, 0),
    productMap,
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
  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product || product.stockQty < item.quantity) throw new Error("Insufficient current inventory to complete this order.");
  }
}

export function isQuotationOpen(status: string) {
  return status === "requested";
}

export function transactionStatusFor(paymentReferenceNote?: string) {
  return paymentReferenceNote ? "payment_coordinated" as const : "recorded" as const;
}
