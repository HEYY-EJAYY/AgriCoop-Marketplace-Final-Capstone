import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies.js";
import { publicProcedure, protectedProcedure, router, supabaseProtectedProcedure } from "./_core/trpc.js";
import { adminOverviewCooperativeScope, APP_ROLES, canAccessConversation, canAccessOrderForCooperative, canManageCooperativeResource, canSubmitProfileVerification, canUpdateCooperativeUser, canUpdateOrderStatus, isSellerApproved, requireOperationalRole } from "./authz.js";
import { applyInventoryDeductions, assertInventorySufficient, assertNotSelfTransaction, canDecideBuyerQuotation, canPlaceAcceptedQuotationOrder, canTransitionOrder, isQuotationOpen, prepareOrder, prepareOrderCompletion, priceOrderItems, transactionStatusFor } from "./marketplaceRules.js";
import {
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
} from "./db.js";
import { createSupabaseProfile, findOrCreateSupabaseCooperative, findSupabaseCooperative, getSupabaseMarketplaceProduct, getSupabaseRoleId, isUuid, listSupabaseCooperatives, listSupabaseMarketplace, listSupabaseMarketplaceCategories } from "./supabaseData.js";
import { conversationMessages, conversations, cooperatives, orderEvents, orderItems, orders, products, quotations, transactions, users } from "../drizzle/schema.js";
import { supabaseAdmin } from "./clients.js";
import { assertSupabaseServerEnvironment } from "./supabaseConfig.js";
import { archiveSupabaseProduct, createSupabaseOrder, createSupabaseProduct, createSupabaseQuotation, decideSupabaseQuotation, listSupabaseBuyerOrders, listSupabaseBuyerQuotations, listSupabaseSellerProducts, SUPABASE_PRODUCT_ACTIVE_STATUS, SUPABASE_PRODUCT_ARCHIVED_STATUS, updateSupabaseProduct } from "./supabaseCommerce.js";
import { getSupabaseAdminOverview, getSupabaseOfficerOverview, reviewSupabaseProduct, reviewSupabaseQuotation, updateSupabaseMemberStatus, updateSupabaseOfficerOrder, updateSupabaseProfileAsAdmin } from "./supabaseOperations.js";
import { normalizeCooperativeName } from "./cooperativeNames.js";
import { isProductImageSizeAllowed, MAX_PRODUCT_IMAGE_SIZE_BYTES, PRODUCT_UNITS } from "../shared/productOptions.js";
import { storageCreateSignedUpload } from "./storage.js";
import { systemRouter } from "./_core/systemRouter.js";

const registrationRoleSchema = z.enum(["buyer", "seller", "admin"]);
const orderStatusSchema = z.enum(["confirmed", "ready", "completed", "cancelled"]);
export const accountProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  contactNumber: z.string().max(40).optional(),
  address: z.string().max(500).optional(),
}).strict();
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
    imageUrl => /^https?:\/\//i.test(imageUrl) || imageUrl.startsWith("/images/"),
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
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.supabaseUser ?? opts.ctx.user),
    register: publicProcedure
      .input(z.object({
        email: z.string().email(),
        password: z.string().min(6).max(128),
        name: z.string().min(2).max(120),
        role: registrationRoleSchema,
        sellerType: z.enum(["individual", "cooperative"]).optional(),
        cooperativeId: z.string().uuid().optional(),
        cooperativeName: z.string().max(180).optional(),
      }))
      .mutation(async ({ input }) => {
        try {
          assertSupabaseServerEnvironment(process.env);
        } catch {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Supabase server configuration is incomplete." });
        }

        let cooperativeId: string | null = null;
        let cooperativeName: string | null = null;

        if (input.role === "seller") {
          if (!input.sellerType) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Choose whether you are an individual seller or a cooperative member." });
          }
          if (input.sellerType === "cooperative") {
            if (input.cooperativeId !== undefined) {
              const existing = await findSupabaseCooperative(input.cooperativeId);
              if (!existing) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an active cooperative from the list." });
              }
              cooperativeId = existing.cooperative_id;
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
              const created = await findOrCreateSupabaseCooperative(normalized.displayName);
              cooperativeId = created.cooperative_id;
              cooperativeName = created.name;
            } else {
              throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an existing cooperative or enter a new cooperative name." });
            }
          }
        }

        const roleName = input.role === "admin" ? "coop_officer" : input.role;
        const roleId = await getSupabaseRoleId(roleName);
        const { data, error } = await supabaseAdmin.auth.admin.createUser({ email: input.email, password: input.password, email_confirm: true, user_metadata: { name: input.name } });
        if (error || !data.user) throw new TRPCError({ code: "BAD_REQUEST", message: error?.message || "Unable to create the account." });
        try {
          await createSupabaseProfile({ userId: data.user.id, fullName: input.name, email: input.email, roleId, cooperativeId, accountStatus: input.role === "buyer" ? "approved" : "pending" });
        } catch {
          await supabaseAdmin.auth.admin.deleteUser(data.user.id);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The account could not be initialized safely." });
        }
        return { success: true, cooperativeName, joinedExistingCooperative: null };
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      ctx.res.setHeader("Cache-Control", "no-store");
      return { success: true } as const;
    }),
  }),

  conversations: router({
    mine: protectedProcedure.query(({ ctx }) => getConversationsForUser(
      ctx.user.id,
      ctx.user.role === "superadmin",
      ctx.user.role === "admin" ? ctx.user.cooperativeId : null,
    )),
    messages: protectedProcedure.input(z.object({ conversationId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const thread = (await db.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1))[0];
      const seller = thread?.sellerId === null || thread?.sellerId === undefined
        ? undefined
        : (await db.select({ cooperativeId: users.cooperativeId }).from(users).where(eq(users.id, thread.sellerId)).limit(1))[0];
      if (!thread || !canAccessConversation(ctx.user, thread, seller?.cooperativeId ?? null)) throw new TRPCError({ code: "FORBIDDEN", message: "You cannot view this conversation." });
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
      const seller = thread?.sellerId === null || thread?.sellerId === undefined
        ? undefined
        : (await db.select({ cooperativeId: users.cooperativeId }).from(users).where(eq(users.id, thread.sellerId)).limit(1))[0];
      if (!thread || !canAccessConversation(ctx.user, thread, seller?.cooperativeId ?? null)) throw new TRPCError({ code: "FORBIDDEN", message: "You cannot reply to this conversation." });
      const [message] = await db.insert(conversationMessages).values({ conversationId: input.conversationId, senderId: ctx.user.id, body: input.body }).$returningId();
      await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, input.conversationId));
      return { success: true };
    }),
  }),

  account: router({
    myProfile: protectedProcedure.query(({ ctx }) => ctx.user),
    updateProfile: protectedProcedure
      .input(accountProfileInputSchema)
      .mutation(async ({ ctx, input }) => {
        const db = await dbOrThrow();
        await db.update(users).set(input).where(eq(users.id, ctx.user.id));
        return { success: true };
      }),
    submitVerification: protectedProcedure
      .input(z.object({
        birthdate: z.string().trim().min(1).max(40).optional(),
        phone: z.string().trim().max(40).optional(),
        address: z.string().trim().max(500).optional(),
        idNumber: z.string().trim().min(4).max(80).optional(),
        selfieUrl: z.string().trim().max(1000).optional(),
        note: z.string().trim().max(600).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!canSubmitProfileVerification({ role: ctx.user.role, verificationStatus: ctx.user.verificationStatus })) {
          throw new TRPCError({ code: "FORBIDDEN", message: "This profile is already verified or cannot be verified with the current role." });
        }
        const db = await dbOrThrow();
        const birthdateValue = input.birthdate ? new Date(input.birthdate) : undefined;
        if (input.birthdate && Number.isNaN(birthdateValue?.getTime() ?? NaN)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The birthdate is not a valid date." });
        }
        await db.update(users)
          .set({
            birthdate: birthdateValue ?? null,
            phone: input.phone?.trim() || null,
            address: input.address?.trim() || null,
            profileImageUrl: input.selfieUrl?.trim() || null,
            verificationStatus: "pending",
            verificationNote: input.note?.trim() || null,
            verifiedAt: null,
          })
          .where(eq(users.id, ctx.user.id));
        return { success: true, verificationStatus: "pending" };
      }),
    reviewVerification: protectedProcedure
      .input(z.object({ userId: z.number().int().positive(), decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(600).optional() }))
      .mutation(async ({ ctx, input }) => {
        requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        const target = (await db.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
        if (!target) {
          throw new TRPCError({ code: "NOT_FOUND", message: "The requested user record was not found." });
        }
        if (ctx.user.role === "admin" && target.cooperativeId !== ctx.user.cooperativeId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You can only review members from your own cooperative." });
        }
        await db.update(users).set({
          verificationStatus: input.decision,
          verificationNote: input.note?.trim() || null,
          verifiedBy: ctx.user.id,
          verifiedAt: new Date(),
        }).where(eq(users.id, input.userId));
        return { success: true, verificationStatus: input.decision };
      }),
  }),

  cooperatives: router({
    list: publicProcedure.query(() => listSupabaseCooperatives().then(rows => rows.map(row => ({ id: row.cooperative_id, name: row.name, location: row.location, status: "active" as const })))),
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
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input }) => {
        const listing = await getSupabaseMarketplaceProduct(input.id);
        if (!listing) throw new TRPCError({ code: "NOT_FOUND", message: "This product is not currently available." });
        return listing;
      }),
    list: publicProcedure
      .input(z.object({ category: z.string().optional(), sort: z.enum(["asc", "desc"]).default("asc") }).optional())
      .query(({ input }) => listSupabaseMarketplace(input?.category, input?.sort ?? "asc")),
    categories: publicProcedure.query(() => listSupabaseMarketplaceCategories()),
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
        size: z.number().int().positive().max(MAX_PRODUCT_IMAGE_SIZE_BYTES),
      }))
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller", "admin", "superadmin"]);
        if (!isProductImageSizeAllowed(input.size)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Product images must be 5 MB or less." });
        }
        const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "product-image";
        return storageCreateSignedUpload(`products/${seller.id}/${Date.now()}-${safeName}`);
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
          imageUrl => /^https?:\/\//i.test(imageUrl) || imageUrl.startsWith("/images/"),
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

  supabaseProducts: router({
    mine: supabaseProtectedProcedure.query(async ({ ctx }) => {
      if (ctx.supabaseUser.role !== "seller") throw new TRPCError({ code: "FORBIDDEN", message: "Only Seller accounts can manage products." });
      return listSupabaseSellerProducts(ctx.supabaseUser.id);
    }),
    create: supabaseProtectedProcedure
      .input(z.object({ name: z.string().trim().min(2).max(160), category: z.string().trim().min(2).max(80), description: z.string().trim().min(1).max(1200), unit: z.string().trim().min(1).max(40), priceCents: z.number().int().positive(), stockQty: z.number().int().min(0), status: z.enum([SUPABASE_PRODUCT_ACTIVE_STATUS, SUPABASE_PRODUCT_ARCHIVED_STATUS]).default(SUPABASE_PRODUCT_ACTIVE_STATUS) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.supabaseUser.role !== "seller") throw new TRPCError({ code: "FORBIDDEN", message: "Only Seller accounts can create products." });
        try {
          return await createSupabaseProduct({ ...input, sellerId: ctx.supabaseUser.id });
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to create this product." });
        }
      }),
    update: supabaseProtectedProcedure
      .input(z.object({ productId: z.string().uuid(), name: z.string().trim().min(2).max(160), category: z.string().trim().min(2).max(80), description: z.string().trim().min(1).max(1200), unit: z.string().trim().min(1).max(40), priceCents: z.number().int().positive(), stockQty: z.number().int().min(0), status: z.enum([SUPABASE_PRODUCT_ACTIVE_STATUS, SUPABASE_PRODUCT_ARCHIVED_STATUS]) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.supabaseUser.role !== "seller") throw new TRPCError({ code: "FORBIDDEN", message: "Only Seller accounts can update products." });
        try {
          return await updateSupabaseProduct({ ...input, sellerId: ctx.supabaseUser.id });
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to update this product." });
        }
      }),
    archive: supabaseProtectedProcedure
      .input(z.object({ productId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.supabaseUser.role !== "seller") throw new TRPCError({ code: "FORBIDDEN", message: "Only Seller accounts can archive products." });
        try {
          return await archiveSupabaseProduct(ctx.supabaseUser.id, input.productId);
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to archive this product." });
        }
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
        const db = await dbOrThrow();
        const seller = (await db.select({ approvalStatus: users.approvalStatus }).from(users).where(eq(users.id, product.sellerId)).limit(1))[0];
        if (!isSellerApproved(seller?.approvalStatus)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "This Seller is not currently approved to receive quotation requests." });
        }
        if (input.requestedQty < product.minOrderQty) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Minimum order is ${product.minOrderQty} ${product.unit}.` });
        }
        if (input.requestedQty > product.stockQty) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Only ${product.stockQty} ${product.unit} are currently available.` });
        }
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
    decide: protectedProcedure
      .input(z.object({ quotationId: z.number().int().positive(), status: z.enum(["accepted", "declined"]) }))
      .mutation(async ({ ctx, input }) => {
        const buyer = requireOperationalRole(ctx.user, ["buyer", "seller"]);
        const db = await dbOrThrow();
        const quotation = (await db.select().from(quotations).where(eq(quotations.id, input.quotationId)).limit(1))[0];
        if (!quotation || !canDecideBuyerQuotation(buyer.id, quotation)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "That quotation is unavailable or no longer awaiting your decision." });
        }
        const result = await db.update(quotations)
          .set({ status: input.status })
          .where(and(
            eq(quotations.id, input.quotationId),
            eq(quotations.buyerId, buyer.id),
            eq(quotations.status, "responded"),
          ));
        if (!result[0].affectedRows) {
          throw new TRPCError({ code: "NOT_FOUND", message: "That quotation is unavailable or no longer awaiting your decision." });
        }
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
      .input(z.object({ items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().positive() })).min(1), buyerNote: z.string().max(600).optional(), quotationId: z.number().int().positive().optional() }))
      .mutation(async ({ ctx, input }) => {
        const buyer = requireOperationalRole(ctx.user, ["buyer", "seller"]);
        const db = await dbOrThrow();
        const productIds = Array.from(new Set(input.items.map(item => item.productId)));
        const listedProducts = await db.select().from(products).where(inArray(products.id, productIds));
        if (listedProducts.length !== productIds.length || listedProducts.some(product => product.status !== "published" || product.verificationStatus !== "approved" || product.visibility !== "visible")) throw new TRPCError({ code: "BAD_REQUEST", message: "One or more products are no longer available for purchase." });
        let prepared;
        try { prepared = prepareOrder(listedProducts, input.items); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to prepare this order." }); }
        try { assertNotSelfTransaction(buyer.id, prepared.sellerId); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to prepare this order." }); }
        const seller = (await db.select({ approvalStatus: users.approvalStatus }).from(users).where(eq(users.id, prepared.sellerId)).limit(1))[0];
        if (!isSellerApproved(seller?.approvalStatus)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "This Seller is not currently approved to receive orders." });
        }
        let quotedPriceCents: number | undefined;
        if (input.quotationId !== undefined) {
          const quotation = (await db.select().from(quotations).where(eq(quotations.id, input.quotationId)).limit(1))[0];
          if (!quotation || !canPlaceAcceptedQuotationOrder(buyer.id, quotation, prepared.items)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Only your accepted quotation and its quoted quantity can be used for this order." });
          }
          if (quotation.quotedPriceCents === null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "An accepted quotation can only be ordered for its product and quoted quantity." });
          }
          quotedPriceCents = quotation.quotedPriceCents;
        }
        const pricing = priceOrderItems(prepared.items, prepared.productMap, quotedPriceCents);
        const [newOrder] = await db.insert(orders).values({ buyerId: buyer.id, sellerId: prepared.sellerId, cooperativeId: prepared.cooperativeId, orderType: prepared.orderType, totalCents: pricing.totalCents, buyerNote: input.buyerNote, paymentMethod: "f2f", paymentStatus: "F2F-pending-confirmation" }).$returningId();
        await db.insert(orderItems).values(pricing.lines.map(item => ({ orderId: newOrder.id, productId: item.productId, quantity: item.quantity, unitPriceCents: item.unitPriceCents })));
        await db.insert(transactions).values({ orderId: newOrder.id, buyerId: buyer.id, sellerId: prepared.sellerId, amountCents: pricing.totalCents, paymentMethod: "f2f", status: "payment_coordinated" });
        const conversationId = await openSupportThread(db, { buyerId: buyer.id, sellerId: prepared.sellerId, orderId: newOrder.id, quotationId: input.quotationId, subject: `Order #${newOrder.id} support`, body: "Please confirm availability, F2F payment coordination, and handover details." });
        return { success: true, orderId: newOrder.id, conversationId };
      }),
    updateStatus: protectedProcedure
      .input(z.object({
        orderId: z.number().int().positive(),
        status: orderStatusSchema,
        paymentReferenceNote: z.string().max(600).optional(),
        finalItems: z.array(z.object({
          orderItemId: z.number().int().positive(),
          quantity: z.number().int().min(0, "Final delivered quantity cannot be negative."),
        })).optional(),
      }).superRefine((input, context) => {
        if (input.status === "completed" && !input.finalItems) {
          context.addIssue({ code: "custom", path: ["finalItems"], message: "Final delivered quantities are required to complete this order." });
        }
        if (input.status === "completed" && input.finalItems && !input.finalItems.some(item => item.quantity > 0)) {
          context.addIssue({ code: "custom", path: ["finalItems"], message: "At least one final delivered quantity must be greater than zero." });
        }
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["seller", "admin", "superadmin"]);
        const db = await dbOrThrow();
        try {
          await db.transaction(async tx => {
            const [orderRow] = await tx.select().from(orders)
              .where(eq(orders.id, input.orderId))
              .for("update");
            if (!orderRow) throw new TRPCError({ code: "NOT_FOUND", message: "This order could not be found." });
            if (!canUpdateOrderStatus(actor, orderRow, input.status)) {
              throw new TRPCError({ code: "FORBIDDEN", message: "Only the seller's cooperative Admin Officer or a SuperAdmin can complete or cancel this order. Sellers may only confirm orders or mark them ready." });
            }
            if (!canTransitionOrder(orderRow.status, input.status)) {
              const message = orderRow.status === "completed" || orderRow.status === "cancelled"
                ? "This order is already completed or cancelled and cannot be changed."
                : "This fulfillment update is not valid for the order's current status.";
              throw new TRPCError({ code: "BAD_REQUEST", message });
            }

            const previousStatus = orderRow.status;
            if (input.status === "completed") {
              const orderedItems = await tx.select().from(orderItems)
                .where(eq(orderItems.orderId, input.orderId))
                .for("update");
              let completion: ReturnType<typeof prepareOrderCompletion>;
              try {
                completion = prepareOrderCompletion(orderedItems, input.finalItems ?? []);
              } catch (error) {
                throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Final delivered quantities are invalid." });
              }

              const productIds = Array.from(new Set(orderedItems.map(item => item.productId)));
              const lockedProducts = productIds.length
                ? await tx.select().from(products).where(inArray(products.id, productIds)).orderBy(asc(products.id)).for("update")
                : [];
              if (lockedProducts.length !== productIds.length) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "A product in this order could not be found." });
              }
              try {
                assertInventorySufficient(
                  lockedProducts,
                  completion.items.map(item => ({ productId: item.productId, quantity: item.quantity })),
                );
              } catch (error) {
                throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Insufficient current inventory to complete this order." });
              }

              await applyInventoryDeductions(completion.items, async applyDeduction => {
                await applyDeduction(async item => {
                  const result = await tx.update(products)
                    .set({ stockQty: sql`${products.stockQty} - ${item.quantity}` })
                    .where(and(eq(products.id, item.productId), gte(products.stockQty, item.quantity)));
                  return result[0].affectedRows > 0;
                });
              });
              const completedAt = new Date();
              for (const item of completion.items) {
                await tx.update(orderItems)
                  .set({ quantity: item.quantity })
                  .where(and(eq(orderItems.id, item.id), eq(orderItems.orderId, input.orderId)));
              }
              await tx.update(orders)
                .set({ status: "completed", totalCents: completion.totalCents, completedAt })
                .where(eq(orders.id, input.orderId));
              await tx.insert(transactions).values({
                orderId: orderRow.id,
                buyerId: orderRow.buyerId,
                sellerId: orderRow.sellerId,
                amountCents: completion.totalCents,
                paymentReferenceNote: input.paymentReferenceNote,
                status: transactionStatusFor(input.paymentReferenceNote),
                paymentMethod: "f2f",
                completedAt,
              }).onDuplicateKeyUpdate({
                set: {
                  amountCents: completion.totalCents,
                  paymentReferenceNote: input.paymentReferenceNote,
                  status: transactionStatusFor(input.paymentReferenceNote),
                  paymentMethod: "f2f",
                  completedAt,
                },
              });
              await tx.insert(orderEvents).values({
                orderId: input.orderId,
                actorUserId: actor.id,
                action: "status_change",
                fromStatus: previousStatus,
                toStatus: input.status,
                note: input.paymentReferenceNote ?? null,
              });
            } else {
              await tx.update(orders).set({ status: input.status }).where(eq(orders.id, input.orderId));
              await tx.update(transactions).set({
                paymentReferenceNote: input.paymentReferenceNote,
                status: transactionStatusFor(input.paymentReferenceNote),
              }).where(eq(transactions.orderId, orderRow.id));
              await tx.insert(orderEvents).values({
                orderId: input.orderId,
                actorUserId: actor.id,
                action: "status_change",
                fromStatus: previousStatus,
                toStatus: input.status,
                note: input.paymentReferenceNote ?? null,
              });
            }
          });
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          if (error instanceof Error && error.message === "Insufficient current inventory to complete this order.") {
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          }
          throw error;
        }
        return { success: true };
      }),
  }),

  // UUID/Supabase implementations used by the migrated buyer flows. The
  // legacy numeric-ID procedures remain below until their seller/officer
  // counterparts are migrated and covered by integration tests.
  supabaseQuotations: router({
    buyerMine: supabaseProtectedProcedure.query(async ({ ctx }) => {
      if (ctx.supabaseUser.role !== "buyer" && ctx.supabaseUser.role !== "seller") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only Buyer or Seller accounts can view quotation requests." });
      }
      return listSupabaseBuyerQuotations(ctx.supabaseUser.id);
    }),
    request: supabaseProtectedProcedure
      .input(z.object({ productId: z.string().uuid(), requestedQty: z.number().int().positive(), buyerNote: z.string().max(600).optional() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.supabaseUser.role !== "buyer" && ctx.supabaseUser.role !== "seller") throw new TRPCError({ code: "FORBIDDEN", message: "Only Buyer or Seller accounts can request quotations." });
        try {
          return await createSupabaseQuotation({ buyerId: ctx.supabaseUser.id, productId: input.productId, requestedQty: input.requestedQty });
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to request this quotation." });
        }
      }),
    decide: supabaseProtectedProcedure
      .input(z.object({ quotationId: z.string().uuid(), status: z.enum(["accepted", "declined"]) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.supabaseUser.role !== "buyer" && ctx.supabaseUser.role !== "seller") throw new TRPCError({ code: "FORBIDDEN", message: "Only Buyer or Seller accounts can decide quotations." });
        try {
          return await decideSupabaseQuotation({ buyerId: ctx.supabaseUser.id, quotationId: input.quotationId, status: input.status });
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to save this quotation decision." });
        }
      }),
  }),

  supabaseOrders: router({
    buyerMine: supabaseProtectedProcedure.query(async ({ ctx }) => {
      if (ctx.supabaseUser.role !== "buyer" && ctx.supabaseUser.role !== "seller") throw new TRPCError({ code: "FORBIDDEN", message: "Only Buyer or Seller accounts can view orders." });
      return listSupabaseBuyerOrders(ctx.supabaseUser.id);
    }),
    create: supabaseProtectedProcedure
      .input(z.object({ items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().positive() })).min(1), buyerNote: z.string().max(600).optional(), quotationId: z.string().uuid().optional() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.supabaseUser.role !== "buyer" && ctx.supabaseUser.role !== "seller") throw new TRPCError({ code: "FORBIDDEN", message: "Only Buyer or Seller accounts can place orders." });
        try {
          return await createSupabaseOrder({ buyerId: ctx.supabaseUser.id, items: input.items, quotationId: input.quotationId });
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to create this order." });
        }
      }),
  }),

  supabaseOfficer: router({
    overview: supabaseProtectedProcedure.query(async ({ ctx }) => {
      if (ctx.supabaseUser.role !== "admin" && ctx.supabaseUser.role !== "superadmin") throw new TRPCError({ code: "FORBIDDEN", message: "Cooperative officer access is required." });
      if (!ctx.supabaseUser.cooperativeId) throw new TRPCError({ code: "FORBIDDEN", message: "Assign this officer to a cooperative before viewing cooperative records." });
      try {
        return await getSupabaseOfficerOverview(ctx.supabaseUser.cooperativeId);
      } catch (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "Unable to load cooperative records." });
      }
    }),
    updateMemberStatus: supabaseProtectedProcedure
      .input(z.object({ userId: z.string().uuid(), accountStatus: z.enum(["approved", "suspended"]) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.supabaseUser.role !== "admin" && ctx.supabaseUser.role !== "superadmin") throw new TRPCError({ code: "FORBIDDEN", message: "Cooperative officer access is required." });
        try {
          return await updateSupabaseMemberStatus(ctx.supabaseUser.id, input.userId, input.accountStatus);
        } catch (error) {
          throw new TRPCError({ code: "FORBIDDEN", message: error instanceof Error ? error.message : "Unable to update member status." });
        }
      }),
    reviewProduct: supabaseProtectedProcedure
      .input(z.object({ productId: z.string().uuid(), decision: z.enum([SUPABASE_PRODUCT_ACTIVE_STATUS, SUPABASE_PRODUCT_ARCHIVED_STATUS]) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.supabaseUser.role !== "admin" && ctx.supabaseUser.role !== "superadmin") throw new TRPCError({ code: "FORBIDDEN", message: "Cooperative officer access is required." });
        try {
          return await reviewSupabaseProduct(ctx.supabaseUser.id, input.productId, input.decision);
        } catch (error) {
          throw new TRPCError({ code: "FORBIDDEN", message: error instanceof Error ? error.message : "Unable to review this product." });
        }
      }),
    reviewQuotation: supabaseProtectedProcedure
      .input(z.object({ quotationId: z.string().uuid(), decision: z.enum(["responded", "declined"]), proposedPriceCents: z.number().int().positive().optional() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.supabaseUser.role !== "admin" && ctx.supabaseUser.role !== "superadmin") throw new TRPCError({ code: "FORBIDDEN", message: "Cooperative officer access is required." });
        try {
          return await reviewSupabaseQuotation(ctx.supabaseUser.id, input.quotationId, input.decision, input.proposedPriceCents);
        } catch (error) {
          throw new TRPCError({ code: "FORBIDDEN", message: error instanceof Error ? error.message : "Unable to review this quotation." });
        }
      }),
    updateOrderStatus: supabaseProtectedProcedure
      .input(z.object({ orderId: z.string().uuid(), status: z.enum(["confirmed", "ready", "completed", "cancelled"]) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.supabaseUser.role !== "admin" && ctx.supabaseUser.role !== "superadmin") throw new TRPCError({ code: "FORBIDDEN", message: "Cooperative officer access is required." });
        try {
          return await updateSupabaseOfficerOrder(ctx.supabaseUser.id, input.orderId, input.status);
        } catch (error) {
          throw new TRPCError({ code: "FORBIDDEN", message: error instanceof Error ? error.message : "Unable to update this order." });
        }
      }),
  }),

  supabaseAdmin: router({
    overview: supabaseProtectedProcedure.query(async ({ ctx }) => {
      if (ctx.supabaseUser.role !== "superadmin") throw new TRPCError({ code: "FORBIDDEN", message: "System administrator access is required." });
      try {
        return await getSupabaseAdminOverview();
      } catch (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "Unable to load administrator records." });
      }
    }),
    updateProfile: supabaseProtectedProcedure
      .input(z.object({ userId: z.string().uuid(), roleName: z.enum(["buyer", "seller", "coop_officer", "system_admin"]), accountStatus: z.enum(["approved", "pending", "suspended"]), cooperativeId: z.string().uuid().nullable() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.supabaseUser.role !== "superadmin") throw new TRPCError({ code: "FORBIDDEN", message: "System administrator access is required." });
        try {
          return await updateSupabaseProfileAsAdmin({ actorId: ctx.supabaseUser.id, targetUserId: input.userId, roleName: input.roleName, accountStatus: input.accountStatus, cooperativeId: input.cooperativeId });
        } catch (error) {
          throw new TRPCError({ code: "FORBIDDEN", message: error instanceof Error ? error.message : "Unable to update this profile." });
        }
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
      const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
      return getAdminOverview(adminOverviewCooperativeScope(actor));
    }),
    reviewProduct: protectedProcedure.input(z.object({ productId: z.number().int().positive(), decision: z.enum(["approved", "rejected"]), rejectionReason: z.string().max(600).optional() })).mutation(async ({ ctx, input }) => {
      const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
      const db = await dbOrThrow();
      const target = (await db.select({ cooperativeId: products.cooperativeId }).from(products).where(eq(products.id, input.productId)).limit(1))[0];
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });
      if (!canManageCooperativeResource(actor, target.cooperativeId)) throw new TRPCError({ code: "FORBIDDEN", message: "You cannot review a product outside your cooperative." });
      const scope = actor.role === "superadmin" ? eq(products.id, input.productId) : and(eq(products.id, input.productId), eq(products.cooperativeId, actor.cooperativeId!));
      const result = await db.update(products).set({ verificationStatus: input.decision, visibility: input.decision === "approved" ? "visible" : "hidden", rejectionReason: input.rejectionReason ?? null, status: input.decision === "approved" ? "published" : "archived" }).where(scope);
      if (!result[0].affectedRows) throw new TRPCError({ code: "FORBIDDEN", message: "You cannot review a product outside your cooperative." });
      return { success: true };
    }),
    updateUser: protectedProcedure
      .input(z.object({ userId: z.number().int().positive(), role: z.enum(APP_ROLES), approvalStatus: z.enum(["approved", "pending", "suspended"]), cooperativeId: z.number().int().positive().nullable() }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        if (actor.role === "admin" && !actor.cooperativeId) throw new TRPCError({ code: "FORBIDDEN", message: "Assign this officer to a cooperative before managing users." });
        const target = (await db.select({ cooperativeId: users.cooperativeId }).from(users).where(eq(users.id, input.userId)).limit(1))[0];
        if (!target || !canUpdateCooperativeUser(actor, target.cooperativeId, input.cooperativeId, input.role)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You cannot manage this user or change their cooperative assignment." });
        }
        const scope = actor.role === "superadmin"
          ? eq(users.id, input.userId)
          : and(eq(users.id, input.userId), eq(users.cooperativeId, actor.cooperativeId!));
        const result = await db.update(users).set({ role: input.role, approvalStatus: input.approvalStatus, cooperativeId: input.cooperativeId }).where(scope);
        if (!result[0].affectedRows) throw new TRPCError({ code: "FORBIDDEN", message: "You cannot manage this user or change their cooperative assignment." });
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
