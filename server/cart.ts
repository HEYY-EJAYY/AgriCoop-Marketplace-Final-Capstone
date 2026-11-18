import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { cartItems, cooperatives, products, users } from "../drizzle/pg-schema";
import { requireOperationalRole } from "./authz";
import { getDb, getOpenOrderReservationQuantities } from "./db";
import { availableStockAfterReservations, productPurchaseBlockReason } from "./marketplaceRules";
import { protectedProcedure, router } from "./_core/trpc";

const mergeItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive(),
});

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
  return db;
}

async function loadCartRows(userId: number) {
  const db = await dbOrThrow();
  const rows = await db
    .select({
      productId: cartItems.productId,
      quantity: cartItems.quantity,
      name: products.name,
      unit: products.unit,
      minOrderQty: products.minOrderQty,
      stockQty: products.stockQty,
      priceCents: products.priceCents,
      sellerId: products.sellerId,
      sellerName: users.name,
      sellerApprovalStatus: users.approvalStatus,
      sellerDeletedAt: users.deletedAt,
      cooperativeId: products.cooperativeId,
      cooperativeName: cooperatives.name,
      allowsPickup: products.allowsPickup,
      allowsDelivery: products.allowsDelivery,
      acceptsOnlinePayment: products.acceptsOnlinePayment,
      primaryImageUrl: products.primaryImageUrl,
      status: products.status,
      verificationStatus: products.verificationStatus,
      visibility: products.visibility,
      deletedAt: products.deletedAt,
    })
    .from(cartItems)
    .innerJoin(products, eq(cartItems.productId, products.id))
    .innerJoin(users, eq(products.sellerId, users.id))
    .leftJoin(cooperatives, eq(products.cooperativeId, cooperatives.id))
    .where(eq(cartItems.userId, userId));

  const reservations = await getOpenOrderReservationQuantities(db, rows.map(row => row.productId));
  return rows
    .filter(row => productPurchaseBlockReason({
      name: row.name,
      unit: row.unit,
      status: row.status,
      verificationStatus: row.verificationStatus,
      visibility: row.visibility,
      deletedAt: row.deletedAt,
      stockQty: availableStockAfterReservations(
        row.stockQty,
        reservations.get(row.productId) ?? 0,
      ),
      minOrderQty: row.minOrderQty,
      allowsPickup: row.allowsPickup,
      allowsDelivery: row.allowsDelivery,
    }, {
      approvalStatus: row.sellerApprovalStatus,
      deletedAt: row.sellerDeletedAt,
    }) === null)
    .map(row => ({
      productId: row.productId,
      name: row.name,
      unit: row.unit,
      quantity: Math.min(Math.max(row.quantity, row.minOrderQty), row.stockQty),
      minOrderQty: row.minOrderQty,
      stockQty: availableStockAfterReservations(
        row.stockQty,
        reservations.get(row.productId) ?? 0,
      ),
      priceCents: row.priceCents,
      sellerId: row.sellerId,
      sellerName: row.sellerName || "Verified seller",
      cooperativeId: row.cooperativeId,
      cooperativeName: row.cooperativeName ?? null,
      cooperativeSlug: null as string | null,
      sellerHasOnlineQr: false,
      allowsPickup: row.allowsPickup ?? true,
      allowsDelivery: row.allowsDelivery ?? true,
      acceptsOnlinePayment: row.acceptsOnlinePayment ?? false,
      primaryImageUrl: row.primaryImageUrl ?? null,
    }));
}

async function upsertCartQuantity(userId: number, productId: number, quantity: number) {
  const db = await dbOrThrow();
  const [product] = await db
    .select({
      id: products.id,
      name: products.name,
      unit: products.unit,
      sellerId: products.sellerId,
      stockQty: products.stockQty,
      minOrderQty: products.minOrderQty,
      allowsPickup: products.allowsPickup,
      allowsDelivery: products.allowsDelivery,
      status: products.status,
      verificationStatus: products.verificationStatus,
      visibility: products.visibility,
      deletedAt: products.deletedAt,
      sellerApprovalStatus: users.approvalStatus,
      sellerDeletedAt: users.deletedAt,
    })
    .from(products)
    .leftJoin(users, eq(products.sellerId, users.id))
    .where(and(eq(products.id, productId), isNull(products.deletedAt)))
    .limit(1);

  if (!product) {
    throw new TRPCError({ code: "NOT_FOUND", message: "That listing is no longer available." });
  }
  if (product.sellerId === userId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot order your own listing." });
  }
  if (quantity <= 0) {
    await db.delete(cartItems).where(and(eq(cartItems.userId, userId), eq(cartItems.productId, productId)));
    return { clamped: false as const, quantity: 0, stockQty: product.stockQty };
  }

  const reservations = await getOpenOrderReservationQuantities(db, [productId]);
  const availableQty = availableStockAfterReservations(
    product.stockQty,
    reservations.get(productId) ?? 0,
  );
  const blockReason = productPurchaseBlockReason({
    name: product.name,
    unit: product.unit,
    status: product.status,
    verificationStatus: product.verificationStatus,
    visibility: product.visibility,
    deletedAt: product.deletedAt,
    stockQty: availableQty,
    minOrderQty: product.minOrderQty,
    allowsPickup: product.allowsPickup,
    allowsDelivery: product.allowsDelivery,
  }, {
    approvalStatus: product.sellerApprovalStatus ?? "suspended",
    deletedAt: product.sellerDeletedAt,
  });
  if (blockReason) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: blockReason,
    });
  }
  const clamped = Math.min(Math.max(quantity, product.minOrderQty), availableQty);

  await db.execute(sql`
    insert into agricoop_app."cartItems" ("userId", "productId", quantity, "createdAt", "updatedAt")
    values (${userId}, ${productId}, ${clamped}, now(), now())
    on conflict ("userId", "productId") do update set
      quantity = excluded.quantity,
      "updatedAt" = now()
  `);

  return {
    clamped: clamped !== quantity,
    quantity: clamped,
    stockQty: availableQty,
  };
}

export const cartRouter = router({
  mine: protectedProcedure.query(async ({ ctx }) => {
    const actor = requireOperationalRole(ctx.user, ["buyer", "seller"]);
    return loadCartRows(actor.id);
  }),

  count: protectedProcedure.query(async ({ ctx }) => {
    const actor = requireOperationalRole(ctx.user, ["buyer", "seller"]);
    return { count: (await loadCartRows(actor.id)).length };
  }),

  setQuantity: protectedProcedure
    .input(z.object({
      productId: z.number().int().positive(),
      quantity: z.number().int(),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireOperationalRole(ctx.user, ["buyer", "seller"]);
      const result = await upsertCartQuantity(actor.id, input.productId, input.quantity);
      const items = await loadCartRows(actor.id);
      return { ...result, items };
    }),

  add: protectedProcedure
    .input(z.object({ productId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireOperationalRole(ctx.user, ["buyer", "seller"]);
      const db = await dbOrThrow();
      const [existing] = await db
        .select({ quantity: cartItems.quantity })
        .from(cartItems)
        .where(and(eq(cartItems.userId, actor.id), eq(cartItems.productId, input.productId)))
        .limit(1);
      const [product] = await db
        .select({ minOrderQty: products.minOrderQty, stockQty: products.stockQty })
        .from(products)
        .where(eq(products.id, input.productId))
        .limit(1);
      const nextQty = existing
        ? existing.quantity + (product?.minOrderQty ?? 1)
        : (product?.minOrderQty ?? 1);
      const result = await upsertCartQuantity(actor.id, input.productId, nextQty);
      const items = await loadCartRows(actor.id);
      return { ...result, items };
    }),

  remove: protectedProcedure
    .input(z.object({ productId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireOperationalRole(ctx.user, ["buyer", "seller"]);
      const db = await dbOrThrow();
      await db.delete(cartItems).where(and(
        eq(cartItems.userId, actor.id),
        eq(cartItems.productId, input.productId),
      ));
      return { items: await loadCartRows(actor.id) };
    }),

  merge: protectedProcedure
    .input(z.object({ items: z.array(mergeItemSchema).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireOperationalRole(ctx.user, ["buyer", "seller"]);
      const db = await dbOrThrow();
      const existing = await db
        .select({ productId: cartItems.productId, quantity: cartItems.quantity })
        .from(cartItems)
        .where(eq(cartItems.userId, actor.id));
      const byProduct = new Map(existing.map(row => [row.productId, row.quantity]));
      for (const item of input.items) {
        const current = byProduct.get(item.productId) ?? 0;
        byProduct.set(item.productId, Math.max(current, item.quantity));
      }
      for (const entry of Array.from(byProduct.entries())) {
        const [productId, quantity] = entry;
        try {
          await upsertCartQuantity(actor.id, productId, quantity);
        } catch {
          // Skip unavailable leftovers during merge.
        }
      }
      // Drop rows for products that no longer exist in the requested merge set? Keep server rows.
      if (input.items.length) {
        const ids = input.items.map(item => item.productId);
        void ids;
      }
      return { items: await loadCartRows(actor.id) };
    }),

  clearUnavailable: protectedProcedure.mutation(async ({ ctx }) => {
    const actor = requireOperationalRole(ctx.user, ["buyer", "seller"]);
    const db = await dbOrThrow();
    const rows = await db.select({ productId: cartItems.productId }).from(cartItems).where(eq(cartItems.userId, actor.id));
    if (!rows.length) return { removed: 0 };
    const productIds = rows.map(row => row.productId);
    const liveIds = new Set((await loadCartRows(actor.id)).map(row => row.productId));
    const stale = productIds.filter(id => !liveIds.has(id));
    if (stale.length) {
      await db.delete(cartItems).where(and(
        eq(cartItems.userId, actor.id),
        inArray(cartItems.productId, stale),
      ));
    }
    return { removed: stale.length, items: await loadCartRows(actor.id) };
  }),
});
