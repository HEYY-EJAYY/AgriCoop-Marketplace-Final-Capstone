import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { APP_ROLES, canAccessOrderForCooperative, canManageSellerOrder, requireOperationalRole } from "./authz";
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
  getMarketplaceProduct,
  getOfficerOverview,
  getOrderDetail,
  getProductById,
  getSellerOrders,
  getSellerProducts,
  getSellerQuotations,
  getConversationMessages,
  getConversationsForUser,
  upsertUser,
} from "./db";
import { conversationMessages, conversations, cooperatives, orderEvents, orderItems, orders, products, quotations, transactions, users } from "../drizzle/schema";
import { supabaseAdmin } from "./clients";
import { publishConversationMessage } from "./realtime";
import { normalizeCooperativeName } from "./cooperativeNames";
import { PRODUCT_UNITS } from "../shared/productOptions";
import { storagePut } from "./storage";

const roleSchema = z.enum(["buyer", "seller"]);
const registrationRoleSchema = z.enum(["buyer", "seller", "admin"]);
const orderStatusSchema = z.enum(["confirmed", "ready", "completed", "cancelled"]);
const productFields = {
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(80),
  variety: z.string().trim().min(1, "Enter or choose a product variety.").max(180),
  description: z.string().trim().min(1, "Enter a product description.").max(1200),
  unit: z.enum(PRODUCT_UNITS),
  priceCents: z.number().int().positive("Enter a price greater than zero."),
  stockQty: z.number().int().positive("Available stock must be greater than zero."),
  minOrderQty: z.number().int().positive("Minimum order quantity must be greater than zero."),
};

function validateProductQuantities(
  input: { stockQty: number; minOrderQty: number },
  context: z.RefinementCtx,
) {
  if (input.minOrderQty > input.stockQty) {
    context.addIssue({
      code: "custom",
      path: ["minOrderQty"],
      message: "Minimum order quantity cannot exceed available stock.",
    });
  }
}

const newProductSchema = z.object({
  ...productFields,
  qualityGrade: z.enum(["premium", "standard", "imperfect"]).default("standard"),
  imageUrls: z.array(z.string().max(1000).refine(
    imageUrl => /^https?:\/\//i.test(imageUrl) || imageUrl.startsWith("/manus-storage/") || imageUrl.startsWith("/images/"),
    "Image must be a valid URL or local image path.",
  )).max(10).default([]),
  submitForVerification: z.boolean().default(true),
}).superRefine(validateProductQuantities);

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The database is temporarily unavailable." });
  return db;
}

async function openSupportThread(db: Awaited<ReturnType<typeof dbOrThrow>>, input: { buyerId: number; sellerId?: number; productId?: number; subject: string; body: string; orderId?: number; quotationId?: number }) {
  const [thread] = await db.insert(conversations).values({ buyerId: input.buyerId, sellerId: input.sellerId, productId: input.productId, subject: input.subject, orderId: input.orderId, quotationId: input.quotationId }).$returningId();
  await db.insert(conversationMessages).values({ conversationId: thread.id, senderId: input.buyerId, body: input.body });
  return thread.id;
}

async function recordOrderEvent(db: Awaited<ReturnType<typeof dbOrThrow>>, input: { orderId: number; actorUserId: number; action: string; fromStatus?: string | null; toStatus?: string | null; note?: string | null }) {
  await db.insert(orderEvents).values({
    orderId: input.orderId,
    actorUserId: input.actorUserId,
    action: input.action,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    note: input.note ?? null,
  });
}

export const appRouter = router({
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    register: publicProcedure
      .input(z.object({
        email: z.string().email(),
        password: z.string().min(6).max(128),
        name: z.string().min(2).max(120),
        role: registrationRoleSchema,
        sellerType: z.enum(["individual", "cooperative"]).optional(),
        cooperativeId: z.number().int().positive().optional(),
        cooperativeName: z.string().max(180).optional(),
      }))
      .mutation(async ({ input }) => {
        let cooperativeId: number | null = null;
        let joinedExistingCooperative: string | null = null;
        let cooperativeName: string | null = null;

        if (input.role === "seller") {
          if (!input.sellerType) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Choose whether you are an individual seller or a cooperative member." });
          }
          if (input.sellerType === "cooperative") {
            const db = await dbOrThrow();
            if (input.cooperativeId !== undefined) {
              const existing = (await db.select().from(cooperatives).where(eq(cooperatives.id, input.cooperativeId)).limit(1))[0];
              if (!existing || existing.status !== "active") {
                throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an active cooperative from the list." });
              }
              cooperativeId = existing.id;
              cooperativeName = existing.name;
            } else if (input.cooperativeName !== undefined) {
              let normalized: ReturnType<typeof normalizeCooperativeName>;
              try {
                normalized = normalizeCooperativeName(input.cooperativeName);
              } catch (error) {
                throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Enter a valid cooperative name." });
              }
              if (normalized.displayName.length > 180) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "Cooperative name must be 180 characters or fewer." });
              }
              const existing = (await db.select().from(cooperatives).where(eq(cooperatives.normalizedName, normalized.normalizedName)).limit(1))[0];
              if (existing) {
                cooperativeId = existing.id;
                cooperativeName = existing.name;
                joinedExistingCooperative = existing.name;
              } else {
                try {
                  const [created] = await db.insert(cooperatives).values({
                    name: normalized.displayName,
                    normalizedName: normalized.normalizedName,
                    location: "Not specified",
                  }).$returningId();
                  cooperativeId = created.id;
                  cooperativeName = normalized.displayName;
                } catch (error) {
                  const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
                  const errorCode = typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;
                  const errorNumber = typeof cause === "object" && cause !== null && "errno" in cause ? cause.errno : undefined;
                  if (errorCode !== "ER_DUP_ENTRY" && errorNumber !== 1062) throw error;
                  const racedExisting = (await db.select().from(cooperatives).where(eq(cooperatives.normalizedName, normalized.normalizedName)).limit(1))[0];
                  if (!racedExisting) throw error;
                  cooperativeId = racedExisting.id;
                  cooperativeName = racedExisting.name;
                  joinedExistingCooperative = racedExisting.name;
                }
              }
            } else {
              throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an existing cooperative or enter a new cooperative name." });
            }
          }
        }

        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email: input.email,
          password: input.password,
          email_confirm: true,
          user_metadata: { name: input.name, role: input.role },
        });
        if (error || !data.user) throw new TRPCError({ code: "BAD_REQUEST", message: error?.message || "Unable to create the account." });
        await upsertUser({
          openId: data.user.id,
          email: input.email,
          name: input.name,
          role: input.role,
          approvalStatus: input.role === "buyer" ? "approved" : "pending",
          cooperativeId,
          loginMethod: "supabase",
        });
        return { success: true, cooperativeName, joinedExistingCooperative };
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      ctx.res.setHeader("Cache-Control", "no-store");
      return { success: true } as const;
    }),
  }),

  conversations: router({
    mine: protectedProcedure.query(({ ctx }) => getConversationsForUser(ctx.user.id, ctx.user.role === "admin" || ctx.user.role === "superadmin")),
    messages: protectedProcedure.input(z.object({ conversationId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const thread = (await db.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1))[0];
      if (!thread || (thread.buyerId !== ctx.user.id && ctx.user.role !== "admin" && ctx.user.role !== "superadmin")) throw new TRPCError({ code: "FORBIDDEN", message: "You cannot view this conversation." });
      return getConversationMessages(input.conversationId);
    }),
    create: protectedProcedure.input(z.object({ subject: z.string().min(3).max(180), body: z.string().min(1).max(2000) })).mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const id = await openSupportThread(db, { buyerId: ctx.user.id, subject: input.subject, body: input.body });
      return { success: true, conversationId: id };
    }),
    send: protectedProcedure.input(z.object({ conversationId: z.number().int().positive(), body: z.string().min(1).max(2000) })).mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const thread = (await db.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1))[0];
      if (!thread || (thread.buyerId !== ctx.user.id && ctx.user.role !== "admin" && ctx.user.role !== "superadmin")) throw new TRPCError({ code: "FORBIDDEN", message: "You cannot reply to this conversation." });
      const [message] = await db.insert(conversationMessages).values({ conversationId: input.conversationId, senderId: ctx.user.id, body: input.body }).$returningId();
      publishConversationMessage({ conversationId: input.conversationId, messageId: message.id, senderId: ctx.user.id });
      await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, input.conversationId));
      return { success: true };
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
        requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        const normalized = normalizeCooperativeName(input.name);
        await db.insert(cooperatives).values({
          ...input,
          name: normalized.displayName,
          normalizedName: normalized.normalizedName,
        });
        return { success: true };
      }),
  }),

  marketplace: router({
    byId: publicProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        const listing = await getMarketplaceProduct(input.id);
        if (!listing) throw new TRPCError({ code: "NOT_FOUND", message: "This product is not currently available." });
        return listing;
      }),
    list: publicProcedure
      .input(z.object({ category: z.string().optional(), sort: z.enum(["asc", "desc"]).default("asc") }).optional())
      .query(({ input }) => getMarketplace(input?.category, input?.sort ?? "asc")),
    categories: publicProcedure.query(() => getCategories()),
  }),

  products: router({
    mine: protectedProcedure.query(({ ctx }) => {
      requireOperationalRole(ctx.user, ["seller", "admin", "superadmin"]);
      return getSellerProducts(ctx.user.id);
    }),
    create: protectedProcedure
      .input(newProductSchema)
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller", "admin", "superadmin"]);
        const db = await dbOrThrow();
        const { imageUrls, submitForVerification, ...productValues } = input; await db.insert(products).values({ ...productValues, sellerId: seller.id, cooperativeId: seller.cooperativeId, verificationStatus: submitForVerification ? "pending" : "draft", visibility: "hidden", primaryImageUrl: imageUrls[0] ?? null });
        return { success: true };
      }),
    uploadImage: protectedProcedure
      .input(z.object({
        fileName: z.string().min(1).max(255),
        contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        base64: z.string().min(1).max(12_000_000),
      }))
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller", "admin", "superadmin"]);
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The selected image file is invalid." });
        }
        const bytes = Buffer.from(input.base64, "base64");
        if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Product images must be smaller than 8 MB." });
        }
        const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "product-image";
        const uploaded = await storagePut(`products/${seller.id}/${Date.now()}-${safeName}`, bytes, input.contentType);
        return { url: uploaded.url };
      }),
    submit: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller", "admin", "superadmin"]);
        const db = await dbOrThrow();
        const result = await db.update(products).set({ verificationStatus: "pending", visibility: "hidden", rejectionReason: null }).where(and(eq(products.id, input.id), eq(products.sellerId, seller.id)));
        if (!result[0].affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "This listing is unavailable or belongs to another Seller." });
        return { success: true };
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        ...productFields,
        qualityGrade: z.enum(["premium", "standard", "imperfect"]),
        status: z.enum(["published", "archived"]),
        primaryImageUrl: z.string().max(1000).refine(
          imageUrl => /^https?:\/\//i.test(imageUrl) || imageUrl.startsWith("/manus-storage/") || imageUrl.startsWith("/images/"),
          "Image must be a valid URL or local image path.",
        ).nullable().optional(),
      }).superRefine(validateProductQuantities))
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller", "admin", "superadmin"]);
        const db = await dbOrThrow();
        const { id, ...values } = input;
        const result = await db.update(products).set(values).where(and(eq(products.id, id), eq(products.sellerId, seller.id)));
        if (!result[0].affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "This listing is unavailable or belongs to another seller." });
        return { success: true };
      }),
    archive: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller", "admin", "superadmin"]);
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
        if (!product || product.status !== "published" || product.verificationStatus !== "approved" || product.visibility !== "visible") throw new TRPCError({ code: "NOT_FOUND", message: "The selected product is not currently listed." });
        try { assertNotSelfTransaction(buyer.id, product.sellerId); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to request this quotation." }); }
        if (input.requestedQty < product.minOrderQty) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Minimum order is ${product.minOrderQty} ${product.unit}.` });
        }
        if (input.requestedQty > product.stockQty) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Only ${product.stockQty} ${product.unit} are currently available.` });
        }
        const db = await dbOrThrow();
        const [quotation] = await db.insert(quotations).values({ ...input, buyerId: buyer.id, sellerId: product.sellerId }).$returningId();
        const conversationId = await openSupportThread(db, { buyerId: buyer.id, sellerId: product.sellerId, productId: product.id, quotationId: quotation.id, subject: `Quotation request: ${product.name}`, body: input.buyerNote || `I would like a quotation for ${input.requestedQty} ${product.unit} of ${product.name}.` });
        return { success: true, conversationId };
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
      .input(z.object({ items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().positive() })).min(1), buyerNote: z.string().max(600).optional() }))
      .mutation(async ({ ctx, input }) => {
        const buyer = requireOperationalRole(ctx.user, ["buyer", "seller"]);
        const db = await dbOrThrow();
        const productIds = Array.from(new Set(input.items.map(item => item.productId)));
        const listedProducts = await db.select().from(products).where(inArray(products.id, productIds));
        if (listedProducts.length !== productIds.length || listedProducts.some(product => product.status !== "published" || product.verificationStatus !== "approved" || product.visibility !== "visible")) throw new TRPCError({ code: "BAD_REQUEST", message: "One or more products are no longer available for purchase." });
        let prepared;
        try { prepared = prepareOrder(listedProducts, input.items); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to prepare this order." }); }
        try { assertNotSelfTransaction(buyer.id, prepared.sellerId); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to prepare this order." }); }
        const [newOrder] = await db.insert(orders).values({ buyerId: buyer.id, sellerId: prepared.sellerId, cooperativeId: prepared.cooperativeId, orderType: prepared.orderType, totalCents: prepared.totalCents, buyerNote: input.buyerNote, paymentMethod: "f2f", paymentStatus: "F2F-pending-confirmation" }).$returningId();
        await db.insert(orderItems).values(input.items.map(item => ({ orderId: newOrder.id, productId: item.productId, quantity: item.quantity, unitPriceCents: prepared.productMap.get(item.productId)!.priceCents })));
        await db.insert(transactions).values({ orderId: newOrder.id, buyerId: buyer.id, sellerId: prepared.sellerId, amountCents: prepared.totalCents, paymentMethod: "f2f", status: "payment_coordinated" });
        const conversationId = await openSupportThread(db, { buyerId: buyer.id, sellerId: prepared.sellerId, orderId: newOrder.id, subject: `Order #${newOrder.id} support`, body: "Please confirm availability, F2F payment coordination, and handover details." });
        return { success: true, orderId: newOrder.id, conversationId };
      }),
    updateStatus: protectedProcedure
      .input(z.object({ orderId: z.number().int().positive(), status: orderStatusSchema, paymentReferenceNote: z.string().max(600).optional() }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["seller", "admin"]);
        const db = await dbOrThrow();
        const orderRow = (await db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1))[0];
        if (!orderRow || !canManageSellerOrder(actor, orderRow.sellerId)) throw new TRPCError({ code: "FORBIDDEN", message: "You cannot update this order." });
        if (!canTransitionOrder(orderRow.status, input.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "This fulfillment update is not valid for the order's current status." });
        const previousStatus = orderRow.status;
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
        await recordOrderEvent(db, { orderId: input.orderId, actorUserId: actor.id, action: "status_change", fromStatus: previousStatus, toStatus: input.status, note: input.paymentReferenceNote ?? null });
        return { success: true };
      }),
  }),

  cooperativeAdmin: router({
    overview: protectedProcedure.query(({ ctx }) => {
      const cooperativeAdmin = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
      return getOfficerOverview(cooperativeAdmin.cooperativeId);
    }),
    orderDetails: protectedProcedure
      .input(z.object({ orderId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        const orderDetail = await getOrderDetail(input.orderId);
        if (!orderDetail) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
        if (!canAccessOrderForCooperative(actor, orderDetail.order.cooperativeId)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "This officer can only view orders in their cooperative." });
        }
        const seller = await db.select().from(users).where(eq(users.id, orderDetail.order.sellerId)).limit(1);
        const buyer = await db.select().from(users).where(eq(users.id, orderDetail.order.buyerId)).limit(1);
        return {
          order: orderDetail.order,
          buyer: buyer[0],
          seller: seller[0],
          items: orderDetail.items,
          events: orderDetail.events,
        };
      }),
    updateMemberStatus: protectedProcedure
      .input(z.object({ userId: z.number().int().positive(), approvalStatus: z.enum(["approved", "suspended"]) }))
      .mutation(async ({ ctx, input }) => {
        const cooperativeAdmin = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        if (!cooperativeAdmin.cooperativeId) throw new TRPCError({ code: "BAD_REQUEST", message: "Assign this officer to a cooperative before validating members." });
        const db = await dbOrThrow();
        await db.update(users).set({ approvalStatus: input.approvalStatus }).where(and(eq(users.id, input.userId), eq(users.cooperativeId, cooperativeAdmin.cooperativeId)));
        return { success: true };
      }),
  }),

  admin: router({
    overview: protectedProcedure.query(({ ctx }) => {
      requireOperationalRole(ctx.user, ["admin", "superadmin"]);
      return getAdminOverview();
    }),
    reviewProduct: protectedProcedure.input(z.object({ productId: z.number().int().positive(), decision: z.enum(["approved", "rejected"]), rejectionReason: z.string().max(600).optional() })).mutation(async ({ ctx, input }) => { requireOperationalRole(ctx.user, ["admin", "superadmin"]); const db = await dbOrThrow(); await db.update(products).set({ verificationStatus: input.decision, visibility: input.decision === "approved" ? "visible" : "hidden", rejectionReason: input.rejectionReason ?? null, status: input.decision === "approved" ? "published" : "archived" }).where(eq(products.id, input.productId)); return { success: true }; }),
    updateUser: protectedProcedure
      .input(z.object({ userId: z.number().int().positive(), role: z.enum(APP_ROLES), approvalStatus: z.enum(["approved", "pending", "suspended"]), cooperativeId: z.number().int().positive().nullable() }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        if (actor.role === "admin" && input.role === "superadmin") throw new TRPCError({ code: "FORBIDDEN", message: "Only a SuperAdmin can assign the SuperAdmin role." });
        const db = await dbOrThrow();
        await db.update(users).set({ role: input.role, approvalStatus: input.approvalStatus, cooperativeId: input.cooperativeId }).where(eq(users.id, input.userId));
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
