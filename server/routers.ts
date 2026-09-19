import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { APP_ROLES, canManageSellerOrder, requireOperationalRole } from "./authz";
import { assertInventorySufficient, assertNotSelfTransaction, canTransitionOrder, isQuotationOpen, prepareOrder, transactionStatusFor } from "./marketplaceRules";
import {
  decrementProductStock,
  getAdminOverview,
  getBuyerOrders,
  getBuyerQuotations,
  getCategories,
  getCooperatives,
  getDb,
  getMarketplace,
  getOfficerOverview,
  getProductById,
  getSellerOrders,
  getSellerProducts,
  getSellerQuotations,
} from "./db";
import { cooperatives, orderItems, orders, products, quotations, transactions, users } from "../drizzle/schema";

const roleSchema = z.enum(["buyer", "seller", "officer"]);
const orderStatusSchema = z.enum(["confirmed", "ready", "completed", "cancelled"]);

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The database is temporarily unavailable." });
  return db;
}

export const appRouter = router({
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  account: router({
    myProfile: protectedProcedure.query(({ ctx }) => ctx.user),
    updateProfile: protectedProcedure
      .input(z.object({ role: roleSchema, cooperativeId: z.number().int().positive().nullable(), contactNumber: z.string().max(40).optional(), address: z.string().max(500).optional() }))
      .mutation(async ({ ctx, input }) => {
        const db = await dbOrThrow();
        const approvalStatus = input.role === "buyer" ? "approved" : "pending";
        await db.update(users).set({ ...input, approvalStatus }).where(eq(users.id, ctx.user.id));
        return { success: true, approvalStatus };
      }),
  }),

  cooperatives: router({
    list: publicProcedure.query(() => getCooperatives()),
    create: protectedProcedure
      .input(z.object({ name: z.string().min(3).max(180), location: z.string().min(3).max(180), description: z.string().max(600).optional() }))
      .mutation(async ({ ctx, input }) => {
        requireOperationalRole(ctx.user, ["admin"]);
        const db = await dbOrThrow();
        await db.insert(cooperatives).values(input);
        return { success: true };
      }),
  }),

  marketplace: router({
    list: publicProcedure
      .input(z.object({ category: z.string().optional(), sort: z.enum(["asc", "desc"]).default("asc") }).optional())
      .query(({ input }) => getMarketplace(input?.category, input?.sort ?? "asc")),
    categories: publicProcedure.query(() => getCategories()),
  }),

  products: router({
    mine: protectedProcedure.query(({ ctx }) => {
      requireOperationalRole(ctx.user, ["seller"]);
      return getSellerProducts(ctx.user.id);
    }),
    create: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(160), category: z.string().min(2).max(80), description: z.string().max(1200).optional(), unit: z.string().min(1).max(40), priceCents: z.number().int().positive(), stockQty: z.number().int().min(0), qualityGrade: z.enum(["premium", "standard", "imperfect"]).default("standard") }))
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller"]);
        const db = await dbOrThrow();
        await db.insert(products).values({ ...input, sellerId: seller.id, cooperativeId: seller.cooperativeId });
        return { success: true };
      }),
    update: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), name: z.string().min(2).max(160), category: z.string().min(2).max(80), description: z.string().max(1200).optional(), unit: z.string().min(1).max(40), priceCents: z.number().int().positive(), stockQty: z.number().int().min(0), qualityGrade: z.enum(["premium", "standard", "imperfect"]), status: z.enum(["published", "archived"]) }))
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller"]);
        const db = await dbOrThrow();
        const { id, ...values } = input;
        const result = await db.update(products).set(values).where(and(eq(products.id, id), eq(products.sellerId, seller.id)));
        if (!result[0].affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "This listing is unavailable or belongs to another seller." });
        return { success: true };
      }),
    archive: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller"]);
        const db = await dbOrThrow();
        await db.update(products).set({ status: "archived" }).where(and(eq(products.id, input.id), eq(products.sellerId, seller.id)));
        return { success: true };
      }),
  }),

  quotations: router({
    buyerMine: protectedProcedure.query(({ ctx }) => {
      requireOperationalRole(ctx.user, ["buyer", "seller"]);
      return getBuyerQuotations(ctx.user.id);
    }),
    sellerMine: protectedProcedure.query(({ ctx }) => {
      requireOperationalRole(ctx.user, ["seller"]);
      return getSellerQuotations(ctx.user.id);
    }),
    request: protectedProcedure
      .input(z.object({ productId: z.number().int().positive(), requestedQty: z.number().int().positive(), buyerNote: z.string().max(600).optional() }))
      .mutation(async ({ ctx, input }) => {
        const buyer = requireOperationalRole(ctx.user, ["buyer", "seller"]);
        const product = await getProductById(input.productId);
        if (!product || product.status !== "published") throw new TRPCError({ code: "NOT_FOUND", message: "The selected product is not currently listed." });
        try { assertNotSelfTransaction(buyer.id, product.sellerId); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to request this quotation." }); }
        const db = await dbOrThrow();
        await db.insert(quotations).values({ ...input, buyerId: buyer.id, sellerId: product.sellerId });
        return { success: true };
      }),
    respond: protectedProcedure
      .input(z.object({ quotationId: z.number().int().positive(), quotedPriceCents: z.number().int().positive(), sellerNote: z.string().max(600).optional(), status: z.enum(["responded", "declined"]) }))
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller"]);
        const db = await dbOrThrow();
        const current = (await db.select().from(quotations).where(eq(quotations.id, input.quotationId)).limit(1))[0];
        if (!current || current.sellerId !== seller.id || !isQuotationOpen(current.status)) throw new TRPCError({ code: "NOT_FOUND", message: "That quotation cannot be updated." });
        const { quotationId, ...values } = input;
        const result = await db.update(quotations).set({ ...values, respondedAt: new Date() }).where(and(eq(quotations.id, quotationId), eq(quotations.sellerId, seller.id), eq(quotations.status, "requested")));
        if (!result[0].affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "That quotation cannot be updated." });
        return { success: true };
      }),
  }),

  orders: router({
    buyerMine: protectedProcedure.query(({ ctx }) => {
      requireOperationalRole(ctx.user, ["buyer", "seller"]);
      return getBuyerOrders(ctx.user.id);
    }),
    sellerMine: protectedProcedure.query(({ ctx }) => {
      requireOperationalRole(ctx.user, ["seller"]);
      return getSellerOrders(ctx.user.id);
    }),
    create: protectedProcedure
      .input(z.object({ items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().positive() })).min(1), buyerNote: z.string().max(600).optional(), paymentMethod: z.enum(["f2f", "gcash", "maya", "gotyme", "qrph"]).default("f2f") }))
      .mutation(async ({ ctx, input }) => {
        const buyer = requireOperationalRole(ctx.user, ["buyer", "seller"]);
        const db = await dbOrThrow();
        const productIds = Array.from(new Set(input.items.map(item => item.productId)));
        const listedProducts = await db.select().from(products).where(inArray(products.id, productIds));
        let prepared;
        try { prepared = prepareOrder(listedProducts, input.items); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to prepare this order." }); }
        try { assertNotSelfTransaction(buyer.id, prepared.sellerId); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to prepare this order." }); }
        const isF2f = input.paymentMethod === "f2f";
        const [newOrder] = await db.insert(orders).values({ buyerId: buyer.id, sellerId: prepared.sellerId, cooperativeId: prepared.cooperativeId, orderType: prepared.orderType, totalCents: prepared.totalCents, buyerNote: input.buyerNote, paymentMethod: input.paymentMethod, paymentStatus: isF2f ? "F2F-pending-confirmation" : "pending" }).$returningId();
        await db.insert(orderItems).values(input.items.map(item => ({ orderId: newOrder.id, productId: item.productId, quantity: item.quantity, unitPriceCents: prepared.productMap.get(item.productId)!.priceCents })));
        await db.insert(transactions).values({ orderId: newOrder.id, buyerId: buyer.id, sellerId: prepared.sellerId, amountCents: prepared.totalCents, paymentMethod: isF2f ? "f2f" : "paymongo", status: isF2f ? "payment_coordinated" : "pending" });
        return { success: true, orderId: newOrder.id };
      }),
    updateStatus: protectedProcedure
      .input(z.object({ orderId: z.number().int().positive(), status: orderStatusSchema, paymentReferenceNote: z.string().max(600).optional() }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["seller", "admin"]);
        const db = await dbOrThrow();
        const orderRow = (await db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1))[0];
        if (!orderRow || !canManageSellerOrder(actor, orderRow.sellerId)) throw new TRPCError({ code: "FORBIDDEN", message: "You cannot update this order." });
        if (!canTransitionOrder(orderRow.status, input.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "This fulfillment update is not valid for the order's current status." });
        if (input.status === "completed") {
          const items = await db.select().from(orderItems).where(eq(orderItems.orderId, input.orderId));
          const currentProducts = await db.select().from(products).where(inArray(products.id, items.map(item => item.productId)));
          try { assertInventorySufficient(currentProducts, items); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Insufficient current inventory to complete this order." }); }
          for (const item of items) await decrementProductStock(item.productId, item.quantity);
          await db.update(orders).set({ status: "completed", completedAt: new Date() }).where(eq(orders.id, input.orderId));
          await db.update(transactions).set({ paymentReferenceNote: input.paymentReferenceNote, status: transactionStatusFor(input.paymentReferenceNote) }).where(eq(transactions.orderId, orderRow.id));
        } else {
          await db.update(orders).set({ status: input.status }).where(eq(orders.id, input.orderId));
        }
        return { success: true };
      }),
  }),

  officer: router({
    overview: protectedProcedure.query(({ ctx }) => {
      const officer = requireOperationalRole(ctx.user, ["officer"]);
      return getOfficerOverview(officer.cooperativeId);
    }),
    updateMemberStatus: protectedProcedure
      .input(z.object({ userId: z.number().int().positive(), approvalStatus: z.enum(["approved", "suspended"]) }))
      .mutation(async ({ ctx, input }) => {
        const officer = requireOperationalRole(ctx.user, ["officer"]);
        if (!officer.cooperativeId) throw new TRPCError({ code: "BAD_REQUEST", message: "Assign this officer to a cooperative before validating members." });
        const db = await dbOrThrow();
        await db.update(users).set({ approvalStatus: input.approvalStatus }).where(and(eq(users.id, input.userId), eq(users.cooperativeId, officer.cooperativeId)));
        return { success: true };
      }),
  }),

  admin: router({
    overview: protectedProcedure.query(({ ctx }) => {
      requireOperationalRole(ctx.user, ["admin"]);
      return getAdminOverview();
    }),
    updateUser: protectedProcedure
      .input(z.object({ userId: z.number().int().positive(), role: z.enum(APP_ROLES), approvalStatus: z.enum(["approved", "pending", "suspended"]), cooperativeId: z.number().int().positive().nullable() }))
      .mutation(async ({ ctx, input }) => {
        requireOperationalRole(ctx.user, ["admin"]);
        const db = await dbOrThrow();
        await db.update(users).set({ role: input.role, approvalStatus: input.approvalStatus, cooperativeId: input.cooperativeId }).where(eq(users.id, input.userId));
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
