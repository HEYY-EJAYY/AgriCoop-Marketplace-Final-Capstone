import { z } from "zod";

export const CHECKOUT_CART_STORAGE_KEY = "agricoop-checkout-cart";

export function hasMinimumOrderStock(stockQty: number, minOrderQty: number) {
  return Number.isSafeInteger(stockQty)
    && stockQty >= 0
    && Number.isSafeInteger(minOrderQty)
    && minOrderQty > 0
    && stockQty >= minOrderQty;
}

export const checkoutCartSchema = z.object({
  cooperativeId: z.number().int().positive().nullable(),
  paymentMethod: z.enum(["cash_pickup", "cash_delivery"]).default("cash_pickup"),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    name: z.string().min(1),
    unit: z.string().min(1),
    quantity: z.number().int().positive(),
    minOrderQty: z.number().int().positive(),
    stockQty: z.number().int().nonnegative(),
    priceCents: z.number().int().nonnegative(),
    sellerId: z.number().int().positive(),
    sellerName: z.string().min(1),
  })).min(1),
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

export type CheckoutCart = z.infer<typeof checkoutCartSchema>;
