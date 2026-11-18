import { TRPCError } from "@trpc/server";

/** Ensures every requested order id was returned from a buyer-scoped query. */
export function assertBuyerOwnsOrders(orderIds: number[], ownedRows: readonly { id: number }[]) {
  if (ownedRows.length !== orderIds.length) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You can only manage your own orders." });
  }
  const owned = new Set(ownedRows.map(row => row.id));
  if (orderIds.some(id => !owned.has(id))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You can only manage your own orders." });
  }
}