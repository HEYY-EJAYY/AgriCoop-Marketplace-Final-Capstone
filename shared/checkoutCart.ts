import { z } from "zod";
import { FULFILLMENT_METHODS, PAYMENT_METHODS } from "./paymentMethods";

export const CHECKOUT_CART_STORAGE_KEY = "agricoop-checkout-cart";

export function hasMinimumOrderStock(stockQty: number, minOrderQty: number) {
  return Number.isSafeInteger(stockQty)
    && stockQty >= 0
    && Number.isSafeInteger(minOrderQty)
    && minOrderQty > 0
    && stockQty >= minOrderQty;
}

export const checkoutCartItemSchema = z.object({
  productId: z.number().int().positive(),
  name: z.string().min(1),
  unit: z.string().min(1),
  quantity: z.number().int().positive(),
  minOrderQty: z.number().int().positive(),
  stockQty: z.number().int().nonnegative(),
  priceCents: z.number().int().nonnegative(),
  sellerId: z.number().int().positive(),
  sellerName: z.string().min(1),
  cooperativeId: z.number().int().positive().nullable().optional(),
  cooperativeName: z.string().nullable().optional(),
  cooperativeSlug: z.string().nullable().optional(),
  sellerHasOnlineQr: z.boolean().optional(),
  allowsPickup: z.boolean().default(true),
  allowsDelivery: z.boolean().default(true),
  acceptsOnlinePayment: z.boolean().default(false),
  primaryImageUrl: z.string().nullable().optional(),
});

export const checkoutSellerGroupSchema = z.object({
  sellerId: z.number().int().positive(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  fulfillmentMethod: z.enum(FULFILLMENT_METHODS),
  receiptStoragePath: z.string().min(1).max(1000).optional(),
  paymentOptionId: z.number().int().positive().optional(),
});

/** Multi-seller cart: payment is chosen per seller group at checkout, not in the cart panel. */
export const checkoutCartSchema = z.object({
  cooperativeId: z.number().int().positive().nullable().optional(),
  /** @deprecated Prefer per-group payment at checkout. Kept for reading older session carts. */
  paymentMethod: z.enum(["cash_pickup", "cash_delivery", "online", "gcash"]).optional(),
  items: z.array(checkoutCartItemSchema).min(1),
  sellerGroups: z.array(checkoutSellerGroupSchema).optional(),
}).superRefine((cart, context) => {
  cart.items.forEach((item, index) => {
    if (!hasMinimumOrderStock(item.stockQty, item.minOrderQty) || item.quantity < item.minOrderQty || item.quantity > item.stockQty) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index, "quantity"],
        message: "Cart quantity must satisfy the product's minimum and available stock.",
      });
    }
  });
});

export type CheckoutCartItem = z.infer<typeof checkoutCartItemSchema>;
export type CheckoutSellerGroup = z.infer<typeof checkoutSellerGroupSchema>;
export type CheckoutCart = z.infer<typeof checkoutCartSchema>;

export function groupCartItemsBySeller(items: CheckoutCartItem[]) {
  const map = new Map<number, CheckoutCartItem[]>();
  for (const item of items) {
    const list = map.get(item.sellerId) ?? [];
    list.push(item);
    map.set(item.sellerId, list);
  }
  return map;
}
