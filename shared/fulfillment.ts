export const FULFILLMENT_TYPES = ["on_hand", "order_based"] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

export const FULFILLMENT_TYPE_LABELS: Record<FulfillmentType, string> = {
  on_hand: "On-Hand · Ready Stock",
  order_based: "Order-Based · Prepared After Order",
};

export function fulfillmentTypeLabel(value: string | null | undefined): string {
  return value === "order_based" ? FULFILLMENT_TYPE_LABELS.order_based : FULFILLMENT_TYPE_LABELS.on_hand;
}

export function isFulfillmentType(value: unknown): value is FulfillmentType {
  return value === "on_hand" || value === "order_based";
}
