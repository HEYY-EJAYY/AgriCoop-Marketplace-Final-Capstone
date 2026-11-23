import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
// isNull used by conversation inbox filters
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { formatEnumLabel } from "../shared/enumLabels";
import { getSessionCookieOptions } from "./_core/cookies";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { adminOverviewCooperativeScope, APP_ROLES, canAccessConversation, canAccessOrderForCooperative, canManageCashReceipt, canManageCooperativeResource, canManageRefundRecord, canRecordCashReceipt, canReviewPaymentProof, canSubmitProfileVerification, canUpdateCooperativeUser, canUpdateOrderStatus, canVerifyPaymentRecord, isPaymentOrderConsistent, isPaymentTransactionConsistent, isSellerApproved, requireOperationalRole } from "./authz";
import { applyInventoryDeductions, assertInventorySufficient, assertNotSelfTransaction, assertOrderCanAcceptPaymentProof, assertPaymentProofReadyForReview, availableStockAfterReservations, canCancelOrderPayment, canDecideBuyerQuotation, canPlaceAcceptedQuotationOrder, canTransitionOrder, evaluateOfficerApproval, isQuotationOpen, prepareOrder, prepareOrderCompletion, prepareProductReview, prepareProductUpdateReviewState, priceOrderItems, productPurchaseBlockReason } from "./marketplaceRules";
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
  getOpenOrderReservationQuantities,
  getSellerOrders,
  getSellerProducts,
  getSellerQuotations,
  getConversationMessages,
  getConversationsForUser,
  getPendingActivityCounts,
  ensureOrderPaymentRecord,
  syncProfileRoleToApplicationRole,
  upsertUser,
  withRequestDatabaseScope,
} from "./db";
import { cartItems, conversationMessages, conversations, cooperativeAssociationRequests, cooperativeAdminApplications, cooperatives, auditLogs, notifications, orderEvents, orderHistory, orderItems, orders, paymentEvents, paymentOptions, paymentProofs, payments, productImages, products, profileVerificationSubmissions, quotations, roles, supportTicketMessages, supportTickets, systemOnlinePaymentAccounts, systemPaymentSettings, threadStates, transactions, users, profiles } from "../drizzle/pg-schema";
import { formatExactDuplicateConflict, formatSimilarMatchesConflict } from "../shared/cooperativeConflicts";
import { previewUserCooperativeSelection, resolveUserCooperativeSelection, type ResolveUserCooperativeResult } from "./userCooperatives";
import {
  defaultFulfillmentForPayment,
  fulfillmentOptionsForListings,
  isPaymentSettled,
  methodsForListings,
  normalizePaymentMethodInput,
  type FulfillmentMethod,
  type PaymentMethod,
} from "../shared/paymentMethods";
import { assertOrderPaidBeforeComplete, canReviewOrderPaymentProof, canViewOrder, isOnlinePaymentMethod } from "./orderAccess";
import { createPublicAuthClient, supabaseAdmin } from "./clients";
import { publishConversationMessage } from "./realtime";
import {
  normalizeCooperativeAddress,
  normalizeCooperativeLocation,
  normalizeCooperativeName,
} from "./cooperativeNames";
import { isProductImageSizeAllowed, MAX_PRODUCT_IMAGE_SIZE_BYTES, MAX_PRODUCT_IMAGES, PRODUCT_UNITS } from "../shared/productOptions";
import { isProfileImageSizeAllowed, MAX_PROFILE_IMAGE_SIZE_BYTES } from "../shared/profileImage";
import {
  assertPaymentOptionSelection,
  getPaymentOptionCooperativeId,
  getPaymentQrStoragePrefix,
  isGcashCheckoutOption,
  paymentOptionDetailsChanged,
} from "./paymentOptions";
import { isStorageKeyWithinPrefix, isStoragePublicUrlWithinPrefix, storageCreateSignedUploadUrl, storageDeleteObject, storageDeletePublicUrl, storageDownloadPrivateObject, storageDownloadPrivateProof, storageGet, storageGetSignedUrl, storageKeyFromPublicUrlWithinPrefix, storagePut } from "./storage";
import { quotationResponseInputSchema } from "../shared/quotation";
import { findAuthUserByEmail, getClientIp, getEmailVerificationRedirectUrl, isDuplicateSignupError, isVerifiedSupabaseEmail, RegistrationCleanupError, RegistrationRateLimitError, registrationRateLimiter, provisionAuthAccount } from "./registration";
import { canRequestCooperativeAssociation, canReviewCooperativeAssociation, cooperativeAssociationRequestBlock } from "./cooperativeAssociations";
import { canAccessSupportTicket, canAssignSupportTicket, canTransitionSupportTicketStatus, resolveSupportTicketCooperativeId, supportTicketStatusAfterReply } from "./supportTickets";
import {
  createCheckoutReceiptUploadIntent,
  createPaymentProofUploadIntent,
  isCheckoutReceiptStorageKey,
  isPaymentProofStorageKey,
  PAYMENT_PROOF_BUCKET,
  sanitizePaymentProofFileName,
  verifyCheckoutReceiptUploadIntent,
  verifyPaymentProofUploadIntent,
} from "./paymentProofs";
import { PAYMENT_PROOF_CONTENT_TYPES, PAYMENT_PROOF_MAX_BYTES } from "../shared/paymentProofs";
import { FULFILLMENT_TYPES } from "../shared/fulfillment";
import { SUPPORT_TICKET_STATUSES } from "../shared/supportTicketStatus";
import { matchesImageContentTypeSignature } from "../shared/imageValidation";
import { createRefundRecord, completedRefundAmountCents, parseRefundRecords, reservedRefundAmountCents, transitionRefundRecord, type RefundState } from "../shared/paymentRefunds";
import { PROFILE_VERIFICATION_BUCKET, PROFILE_VERIFICATION_CONTENT_TYPES, PROFILE_VERIFICATION_MAX_BYTES } from "../shared/profileVerification";
import { COOP_ADMIN_APPLICATION_BUCKET } from "../shared/coopAdminApplication";
import { createProfileVerificationUploadIntent, isProfileVerificationStorageKey, profileVerificationExtension, verifyProfileVerificationUploadIntent } from "./profileVerification";
import { resolvePublicRegistrationIdentity } from "./authIdentity";
import { adminAccountsRouter, officerApplicationsRouter, orderArchiveProcedures, quotationArchiveProcedures, upsertPerUserThreadState } from "./part2Routers";
import { cartRouter } from "./cart";
import { accountInactiveMessage, canSoftDeleteTargetUser } from "./userSoftDelete";
import {
  SYSTEM_PAYMENT_QR_BUCKET,
  ensureSystemPaymentSettings,
  getActiveOnlineAccount,
  getSystemPaymentAvailability,
  recordSystemPaymentAudit,
  systemPaymentQrPrefix,
} from "./systemPayment";

function throwIfCooperativeConflict(
  result:
    | ResolveUserCooperativeResult
    | { kind: "ok_to_create"; normalizedName?: string; normalizedLocation?: string; address?: string },
) {
  if (result.kind === "exact_duplicate") {
    throw new TRPCError({
      code: "CONFLICT",
      message: formatExactDuplicateConflict(result.match),
    });
  }
  if (result.kind === "similar_matches") {
    throw new TRPCError({
      code: "CONFLICT",
      message: formatSimilarMatchesConflict(result.matches),
    });
  }
  if (result.kind === "needs_confirmation") {
    throw new TRPCError({
      code: "CONFLICT",
      message: formatSimilarMatchesConflict([result.suggestion]),
    });
  }
}

function assertCooperativeManagementScope(
  actor: Parameters<typeof canManageCooperativeResource>[0],
  cooperativeId: number,
) {
  if (!canManageCooperativeResource(actor, cooperativeId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Officer Admins can manage only their own cooperative.",
    });
  }
}

export const registrationRoleSchema = z.enum(["buyer", "seller", "coop_admin"]);
export const publicRegistrationInputSchema = z.object({
  email: z.string().trim().email().max(320).transform(value => value.toLowerCase()),
  password: z.string().min(6).max(128),
  name: z.string().min(2).max(120),
  role: registrationRoleSchema,
  cooperativeId: z.number().int().positive().optional(),
  newCooperativeName: z.string().trim().min(3).max(180).optional(),
  newCooperativeLocation: z.string().trim().min(3).max(180).optional(),
  newCooperativeAddress: z.string().trim().min(3).max(255).optional(),
  /** When set to a suggested normalizedName, accept that existing coop; when set to the new name's normalized form, create anyway. */
  confirmSimilarNormalizedName: z.string().trim().min(2).max(180).optional(),
}).strict().superRefine((value, ctx) => {
  const needsCoop = value.role === "seller" || value.role === "coop_admin";
  const hasExisting = typeof value.cooperativeId === "number";
  const hasNew = Boolean(value.newCooperativeName?.trim());
  if (needsCoop && !hasExisting && !hasNew) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Seller and Cooperative Admin sign-ups require a cooperative.",
      path: ["cooperativeId"],
    });
  }
  if (hasExisting && hasNew) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Choose an existing cooperative or add a new one, not both.",
      path: ["cooperativeId"],
    });
  }
  if (hasNew) {
    if (!value.newCooperativeAddress?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a street or barangay address for the new cooperative.",
        path: ["newCooperativeAddress"],
      });
    }
    if (!value.newCooperativeLocation?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a location (municipality/city and province).",
        path: ["newCooperativeLocation"],
      });
    }
  }
});
const orderStatusSchema = z.enum(["confirmed", "ready", "completed", "cancelled"]);
const supportTicketStatusSchema = z.enum(SUPPORT_TICKET_STATUSES);
export const accountProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  contactNumber: z.string().max(40).optional(),
  address: z.string().max(500).optional(),
  profileImageUrl: z.string().url().max(1000).nullable().optional(),
}).strict();
function isValidVerificationBirthdate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value
    && parsed.getTime() <= Date.now();
}

export const profileVerificationUploadInputSchema = z.object({
  contentType: z.enum(PROFILE_VERIFICATION_CONTENT_TYPES),
  fileSizeBytes: z.number().int().min(1).max(PROFILE_VERIFICATION_MAX_BYTES),
}).strict();

export const profileVerificationSubmissionInputSchema = z.object({
  uploadIntent: z.string().min(1).max(2048),
  birthdate: z.string().trim().refine(isValidVerificationBirthdate, "Enter a valid birthdate that is not in the future."),
  phone: z.string().trim().min(7).max(40),
  address: z.string().trim().max(500).optional(),
  note: z.string().trim().max(600).optional(),
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
  if (input.stockQty > 0 && input.minOrderQty > input.stockQty) {
    context.addIssue({
      code: "custom",
      path: ["minOrderQty"],
      message: "Minimum order quantity cannot exceed available stock.",
    });
  }
}

export const newProductSchema = z.object({
  ...productFields,
  qualityGrade: z.enum(["premium", "standard", "imperfect"]).default("standard"),
  allowsPickup: z.boolean().default(true),
  allowsDelivery: z.boolean().default(true),
  acceptsOnlinePayment: z.boolean().default(false),
  onlinePaymentEnabled: z.boolean().default(true),
  fulfillmentType: z.enum(FULFILLMENT_TYPES).default("on_hand"),
  prepTimeDays: z.number().int().min(1).max(90).optional(),
  capacityNote: z.string().trim().max(300).optional(),
  imageUrls: z.array(z.string().max(1000).refine(
    imageUrl => /^https?:\/\//i.test(imageUrl) || imageUrl.startsWith("/manus-storage/") || imageUrl.startsWith("/images/"),
    "Image must be a valid URL or local image path.",
  )).max(MAX_PRODUCT_IMAGES, `A product can have up to ${MAX_PRODUCT_IMAGES} images.`).default([]),
  submitForVerification: z.boolean().default(true),
}).superRefine((input, context) => {
  validateProductQuantities(input, context);
  if (!input.allowsPickup && !input.allowsDelivery) {
    context.addIssue({ code: "custom", path: ["allowsPickup"], message: "Choose at least Pickup or Delivery for this listing." });
  }
});

export const updateProductSchema = z.object({
  id: z.number().int().positive(),
  ...productFields,
  stockQty: z.number().int().min(0, "Available stock cannot be negative."),
  qualityGrade: z.enum(["premium", "standard", "imperfect"]),
  status: z.enum(["published", "archived"]),
  allowsPickup: z.boolean().optional(),
  allowsDelivery: z.boolean().optional(),
  acceptsOnlinePayment: z.boolean().optional(),
  onlinePaymentEnabled: z.boolean().optional(),
  fulfillmentType: z.enum(FULFILLMENT_TYPES).optional(),
  prepTimeDays: z.number().int().min(1).max(90).nullable().optional(),
  capacityNote: z.string().trim().max(300).nullable().optional(),
  imageUrls: z.array(z.string().max(1000).refine(
    imageUrl => /^https?:\/\//i.test(imageUrl) || imageUrl.startsWith("/manus-storage/") || imageUrl.startsWith("/images/"),
    "Image must be a valid URL or local image path.",
  )).max(MAX_PRODUCT_IMAGES, `A product can have up to ${MAX_PRODUCT_IMAGES} images.`).optional(),
  primaryImageUrl: z.string().max(1000).refine(
    imageUrl => /^https?:\/\//i.test(imageUrl) || imageUrl.startsWith("/manus-storage/") || imageUrl.startsWith("/images/"),
    "Image must be a valid URL or local image path.",
  ).nullable().optional(),
}).superRefine((input, context) => {
  validateProductQuantities(input, context);
  if (input.allowsPickup === false && input.allowsDelivery === false) {
    context.addIssue({ code: "custom", path: ["allowsPickup"], message: "Choose at least Pickup or Delivery for this listing." });
  }
});

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The database is temporarily unavailable." });
  return db;
}

export function validateProductImageUrls(imageUrls: string[], sellerId: number, existingUrls: string[] = []) {
  if (imageUrls.length > MAX_PRODUCT_IMAGES || new Set(imageUrls).size !== imageUrls.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Choose up to ${MAX_PRODUCT_IMAGES} unique product images.` });
  }
  const allowedPrefix = `products/${sellerId}/`;
  if (imageUrls.some(url =>
    !isStoragePublicUrlWithinPrefix(url, allowedPrefix) && !existingUrls.includes(url)
  )) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Product images must be uploaded to your authorized AgriCoop Storage location." });
  }
}

export function assertProductImageUpdateInput(
  imageUrls: string[] | undefined,
  primaryImageUrl: string | null | undefined,
) {
  if (primaryImageUrl !== undefined && imageUrls === undefined) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Update product images through the image gallery." });
  }
  if (imageUrls !== undefined && primaryImageUrl !== undefined && primaryImageUrl !== (imageUrls[0] ?? null)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The primary image must match the first image in the gallery." });
  }
}

async function openSupportThread(db: Awaited<ReturnType<typeof dbOrThrow>>, input: { buyerId: number; sellerId?: number; productId?: number; subject: string; body: string; orderId?: number; quotationId?: number; senderId?: number }) {
  const [thread] = await db.insert(conversations).values({ buyerId: input.buyerId, sellerId: input.sellerId, productId: input.productId, subject: input.subject, orderId: input.orderId, quotationId: input.quotationId }).returning({ id: conversations.id });
  await db.insert(conversationMessages).values({ conversationId: thread.id, senderId: input.senderId ?? input.buyerId, body: input.body });
  return thread.id;
}

async function recordAuditLog(db: Awaited<ReturnType<typeof dbOrThrow>>, input: { actorUserId: number; action: string; entityType: string; entityId?: number; cooperativeId?: number | null; metadata?: any }) {
  // Actor is pinned inside agricoop_app.write_audit_log from auth.uid(); actorUserId is retained for call-site clarity/tests.
  void input.actorUserId;
  await db.execute(sql`
    with trusted_audit_scope as materialized (
      select set_config('agricoop.server_audit_write', 'on', true)
    )
    select agricoop_app.write_audit_log(
      ${input.action},
      ${input.entityType},
      ${input.entityId ?? null},
      ${input.cooperativeId ?? null},
      ${input.metadata ? JSON.stringify(input.metadata) : null}
    )
    from trusted_audit_scope
  `);
}

async function createNotification(db: Awaited<ReturnType<typeof dbOrThrow>>, input: { userId: number; type: string; title: string; content: string; link?: string; relatedEntityId?: number; relatedEntityType?: string }) {
  await db.execute(sql`
    select agricoop_app.create_notification(
      ${input.userId},
      ${input.type},
      ${input.title},
      ${input.content},
      ${input.link ?? null},
      ${input.relatedEntityId ?? null},
      ${input.relatedEntityType ?? null}
    )
  `);
}

/** Officers only. Uses order_status_updated because the DB allowlist rejects ad-hoc payment types for non-buyer recipients. */
export async function notifyApprovedOfficers(
  db: Awaited<ReturnType<typeof dbOrThrow>>,
  input: { title: string; content: string; link: string; relatedEntityId: number },
  cooperativeId: number | null,
) {
  const officers = await db.select({
    id: users.id,
    role: users.role,
    cooperativeId: users.cooperativeId,
    approvalStatus: users.approvalStatus,
    deletedAt: users.deletedAt,
  }).from(users).where(inArray(users.role, ["admin", "superadmin"]));
  const recipients = officers.filter(officer =>
    officer.approvalStatus === "approved"
    && officer.deletedAt === null
    && (
      officer.role === "superadmin"
      || (officer.role === "admin" && cooperativeId !== null && officer.cooperativeId === cooperativeId)
    ),
  );
  for (const officer of recipients) {
    await createNotification(db, {
      userId: officer.id,
      type: "order_status_updated",
      title: input.title,
      content: input.content,
      link: input.link,
      relatedEntityId: input.relatedEntityId,
      relatedEntityType: "order",
    });
  }
}

export const appRouter = router({
  cart: cartRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    status: publicProcedure.query(opts => opts.ctx.authResolution),
    register: publicProcedure
      .input(publicRegistrationInputSchema)
      .mutation(async ({ input, ctx }) => {
        try {
          // IP throttle runs early; the per-email quota is only consumed right before
          // account creation so failed validations don't burn a legitimate user's allowance.
          registrationRateLimiter.consume("register", getClientIp(ctx.req), undefined);
        } catch (error) {
          if (error instanceof RegistrationRateLimitError) {
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: error.message });
          }
          throw error;
        }

        const correlationId = `reg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

        // Soft-deleted emails cannot register again (same contact-admin message as login).
        // auth.register is excluded from the outer request scope and runs as `anon`,
        // which cannot SELECT agricoop_app.users — use the SECURITY DEFINER probe.
        await withRequestDatabaseScope(null, async () => {
          const db = await getDb();
          const rows = await db.execute(sql`
            select agricoop_app.email_has_deleted_user(${input.email.toLowerCase()}) as "deleted"
          `);
          const [row] = Array.from(rows as unknown as Array<{ deleted: boolean }>);
          if (row?.deleted) {
            throw new TRPCError({ code: "FORBIDDEN", message: accountInactiveMessage() });
          }
        });

        // Duplicate / "Did you mean?" check before Auth createUser (no orphan accounts).
        if (input.cooperativeId || input.newCooperativeName) {
          try {
            await withRequestDatabaseScope(null, async () => {
              const previewDb = await getDb();
              const preview = await previewUserCooperativeSelection(previewDb, {
                cooperativeId: input.cooperativeId,
                newCooperativeName: input.newCooperativeName,
                newCooperativeLocation: input.newCooperativeLocation,
                newCooperativeAddress: input.newCooperativeAddress,
                confirmSimilarNormalizedName: input.confirmSimilarNormalizedName,
              });
              throwIfCooperativeConflict(preview);
            });
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: error instanceof Error ? error.message : "Invalid cooperative selection.",
            });
          }
        }

        let emailRedirectTo: string;
        try {
          emailRedirectTo = getEmailVerificationRedirectUrl(process.env.APP_URL);
        } catch (configError) {
          console.error("[registration] redirect_config_invalid", {
            correlationId,
            errorType: configError instanceof Error ? configError.name : "UnknownError",
            message: configError instanceof Error ? configError.message : "unknown",
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Unable to start registration. Please try again later. (ref: ${correlationId})`,
          });
        }
        try {
          registrationRateLimiter.consume("register", undefined, input.email);
        } catch (error) {
          if (error instanceof RegistrationRateLimitError) {
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: error.message });
          }
          throw error;
        }
        // Prefer admin.createUser (email_confirm:false) so Auth account creation does not block on
        // SMTP delivery. Public signUp previously hung past the Vercel 30s limit under email
        // rate-limit / slow SMTP, surfacing only as "Unable to start registration".
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email: input.email,
          password: input.password,
          email_confirm: false,
          user_metadata: { name: input.name },
        });
        let authUserId: string | null = null;
        let removeAuthUserOnProvisionFailure = false;
        if (error) {
          if (isDuplicateSignupError(error)) {
            const existingAuth = await findAuthUserByEmail(input.email);
            const orphanAuth = existingAuth
              && !isVerifiedSupabaseEmail(existingAuth)
              && !(await withRequestDatabaseScope(null, async () => {
                const previewDb = await getDb();
                const [existingApp] = await previewDb.select({ id: users.id }).from(users)
                  .where(eq(users.openId, existingAuth.id))
                  .limit(1);
                return Boolean(existingApp);
              }));
            if (orphanAuth) {
              authUserId = existingAuth.id;
              removeAuthUserOnProvisionFailure = false;
            } else {
              return { success: true, verificationRequired: true };
            }
          } else {
            const errorCode = "code" in error ? String(error.code) : "unknown";
            const isEmailRateLimited = errorCode === "over_email_send_rate_limit"
              || /rate limit|only request this after/i.test(error.message);
            console.error("[registration] signup_failed", {
              correlationId,
              errorType: error.name ?? "AuthError",
              errorCode,
              status: "status" in error ? Number(error.status) : undefined,
              message: error.message,
            });
            throw new TRPCError({
              code: isEmailRateLimited ? "TOO_MANY_REQUESTS" : "INTERNAL_SERVER_ERROR",
              message: isEmailRateLimited
                ? `Too many verification emails were requested. Wait a few minutes, then try again or use Resend verification. (ref: ${correlationId})`
                : `Unable to start registration. Please try again later. (ref: ${correlationId})`,
            });
          }
        } else {
          const createdAuthUser = data.user;
          if (!createdAuthUser) {
            console.error("[registration] signup_missing_user", { correlationId });
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Unable to start registration. Please try again later. (ref: ${correlationId})`,
            });
          }
          if (isVerifiedSupabaseEmail(createdAuthUser)) {
            try {
              const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(createdAuthUser.id);
              if (deleteError) throw deleteError;
            } catch (deleteError) {
              console.error("[registration] Could not remove an account created without email confirmation", {
                correlationId,
                errorType: deleteError instanceof Error ? deleteError.name : "UnknownError",
              });
            }
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Email confirmation is not enabled. Contact support before registering.",
            });
          }
          authUserId = createdAuthUser.id;
          removeAuthUserOnProvisionFailure = true;
        }
        if (!authUserId) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Unable to start registration. Please try again later. (ref: ${correlationId})`,
          });
        }
        const provisionRegistration = () => withRequestDatabaseScope(authUserId!, async () => {
              const db = await getDb();
              const identity = resolvePublicRegistrationIdentity(input.role);
              if (!identity || identity.registrationChoice !== input.role) {
                throw new Error("The requested role is not permitted for public registration.");
              }
              const publicRoles = await db.select({ roleId: roles.roleId, roleName: roles.roleName })
                .from(roles)
                .where(eq(roles.roleName, identity.publicRoleName))
                .limit(2);
              if (publicRoles.length !== 1) {
                throw new Error("Canonical registration role is missing or ambiguous.");
              }

              const registrationIntent = identity.registrationChoice === "coop_admin"
                ? "cooperative_admin" as const
                : identity.applicationRole;

              let cooperativeId: number | null = null;
              const assignCoopOnUser = identity.applicationRole === "seller"
                || identity.registrationChoice === "buyer";
              // RLS requires cooperativeId IS NULL on INSERT; link afterward via GUC.
              await upsertUser({
                openId: authUserId!,
                email: input.email,
                name: input.name,
                role: identity.applicationRole,
                approvalStatus: identity.approvalStatus,
                cooperativeId: null,
                requestedRole: identity.registrationChoice === "coop_admin" ? "admin" : null,
                loginMethod: "supabase",
              }, undefined, { intent: registrationIntent });

              if (input.cooperativeId || input.newCooperativeName) {
                const resolved = await resolveUserCooperativeSelection(db, {
                  cooperativeId: input.cooperativeId,
                  newCooperativeName: input.newCooperativeName,
                  newCooperativeLocation: input.newCooperativeLocation,
                  newCooperativeAddress: input.newCooperativeAddress,
                  confirmSimilarNormalizedName: input.confirmSimilarNormalizedName,
                  rateLimitEmail: input.email,
                  consumeRateLimit: () => {
                    try {
                      registrationRateLimiter.consume("create_cooperative", ctx.req.ip, input.email);
                    } catch (error) {
                      if (error instanceof RegistrationRateLimitError) {
                        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: error.message });
                      }
                      throw error;
                    }
                  },
                });
                throwIfCooperativeConflict(resolved);
                if (resolved.kind !== "existing" && resolved.kind !== "created") {
                  throw new Error("Invalid cooperative resolution.");
                }
                cooperativeId = resolved.cooperativeId;
                if (resolved.kind === "created") {
                  const [appUserForAudit] = await db.select({ id: users.id }).from(users)
                    .where(eq(users.openId, authUserId!)).limit(1);
                  if (appUserForAudit) {
                    await recordAuditLog(db, {
                      actorUserId: appUserForAudit.id,
                      action: "user_access_updated",
                      entityType: "cooperative",
                      entityId: cooperativeId,
                      cooperativeId,
                      metadata: { createdCooperativeId: cooperativeId, source: "user", registrationRole: input.role },
                    });
                  }
                }
              }

              // First-time NULL → cooperativeId. Guard allows this only with registration GUC.
              if (cooperativeId && assignCoopOnUser) {
                await db.execute(sql`
                  select set_config('agricoop.allow_registration_coop_assign', '1', true)
                `);
                await db.execute(sql`
                  update agricoop_app.users
                  set "cooperativeId" = ${cooperativeId}
                  where "openId" = ${authUserId!}
                    and "cooperativeId" is null
                `);
              }

              // Explicit columns only — Drizzle expands defaults for cooperative_id /
              // account_status / created_at, which authenticated cannot INSERT (42501).
              await db.execute(sql`
                insert into public.profiles (user_id, full_name, email, role_id)
                values (
                  ${authUserId!}::uuid,
                  ${input.name},
                  ${input.email},
                  ${publicRoles[0].roleId}
                )
              `);

              if (identity.registrationChoice === "coop_admin") {
                if (!cooperativeId) {
                  throw new Error("Cooperative Admin registration requires a cooperative.");
                }
                const [appUser] = await db.select({ id: users.id }).from(users)
                  .where(eq(users.openId, authUserId!)).limit(1);
                if (!appUser) throw new Error("Application user missing after registration upsert.");
                await db.execute(sql`
                  insert into agricoop_app."cooperativeAdminApplications"
                    ("userId", "fullName", "cooperativeId", "positionTitle", status)
                  values (
                    ${appUser.id},
                    ${input.name},
                    ${cooperativeId},
                    ${""},
                    ${"awaiting_documents"}
                  )
                `);
              }
            });
        try {
          if (removeAuthUserOnProvisionFailure) {
            await provisionAuthAccount(
              authUserId,
              provisionRegistration,
              async orphanId => {
                const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(orphanId);
                if (deleteError) throw deleteError;
              },
            );
          } else {
            await provisionRegistration();
          }
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          const cleanupFailed = error instanceof RegistrationCleanupError;
          const cause = error instanceof Error ? error.cause : undefined;
          const nestedCause = cause instanceof Error ? cause.cause : undefined;
          const postgresCarrier = [error, cause, nestedCause].find(
            candidate => typeof candidate === "object" && candidate && "code" in candidate,
          ) as { code?: unknown; detail?: unknown; message?: unknown } | undefined;
          console.error("[registration] provisioning_failed", {
            correlationId,
            cleanupFailed,
            errorType: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message : "unknown",
            causeType: cause instanceof Error ? cause.name : typeof cause,
            causeMessage: cause instanceof Error
              ? cause.message
              : typeof error === "object" && error && "causeMessage" in error
                ? String((error as { causeMessage: unknown }).causeMessage)
                : undefined,
            nestedCauseType: nestedCause instanceof Error ? nestedCause.name : typeof nestedCause,
            nestedCauseMessage: nestedCause instanceof Error ? nestedCause.message.slice(0, 400) : undefined,
            postgresErrorCode: String(
              (typeof error === "object" && error && "postgresErrorCode" in error
                ? (error as { postgresErrorCode: unknown }).postgresErrorCode
                : undefined)
              ?? postgresCarrier?.code
              ?? "unknown",
            ),
            postgresDetail: typeof postgresCarrier?.detail === "string" ? postgresCarrier.detail.slice(0, 240) : undefined,
            databasePhase: typeof cause === "object" && cause && "databasePhase" in cause
              ? String((cause as { databasePhase: unknown }).databasePhase)
              : undefined,
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: cleanupFailed
              ? `Registration could not be completed. Contact support before trying again. (ref: ${correlationId})`
              : `Registration setup failed and the incomplete account was removed. Please try again. (ref: ${correlationId})`,
          });
        }
        // Send confirmation after provisioning so a slow/rate-limited SMTP path cannot
        // leave an orphan Auth user without an application profile.
        const { error: confirmEmailError } = await createPublicAuthClient().auth.resend({
          type: "signup",
          email: input.email,
          options: { emailRedirectTo },
        });
        if (confirmEmailError) {
          const errorCode = "code" in confirmEmailError ? String(confirmEmailError.code) : "unknown";
          console.warn("[registration] confirmation_email_deferred", {
            correlationId,
            errorCode,
            message: confirmEmailError.message,
          });
        }
        return { success: true, verificationRequired: true };
      }),
    resendVerification: publicProcedure
      .input(z.object({ email: z.string().trim().email().max(320).transform(value => value.toLowerCase()) }).strict())
      .mutation(async ({ input, ctx }) => {
        try {
          registrationRateLimiter.consume("resend", ctx.req.ip, input.email);
        } catch (error) {
          if (error instanceof RegistrationRateLimitError) {
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: error.message });
          }
          throw error;
        }
        const { error } = await createPublicAuthClient().auth.resend({
          type: "signup",
          email: input.email,
          options: { emailRedirectTo: getEmailVerificationRedirectUrl(process.env.APP_URL) },
        });
        if (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Unable to request a verification email. Please try again later.",
          });
        }
        return { success: true };
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      ctx.res.setHeader("Cache-Control", "no-store");
      return { success: true } as const;
    }),
  }),

  conversations: router({
    mine: protectedProcedure
      .input(z.object({
        kind: z.enum(["messages", "support", "all"]).default("all"),
        archived: z.boolean().optional(),
      }).optional())
      .query(({ ctx, input }) => {
        const kind = input?.kind ?? "all";
        const staffSupportQueue = kind === "support" && (ctx.user.role === "admin" || ctx.user.role === "superadmin");
        return getConversationsForUser(ctx.user.id, {
          kind,
          archived: input?.archived ?? false,
          staffSupportQueue,
        });
      }),
    messages: protectedProcedure.input(z.object({ conversationId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const thread = (await db.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1))[0];
      const seller = thread?.sellerId === null || thread?.sellerId === undefined
        ? undefined
        : (await db.select({ cooperativeId: users.cooperativeId }).from(users).where(eq(users.id, thread.sellerId)).limit(1))[0];
      if (!thread || thread.deletedAt || !canAccessConversation(ctx.user, thread, seller?.cooperativeId ?? null)) throw new TRPCError({ code: "FORBIDDEN", message: "You cannot view this conversation." });
      return getConversationMessages(input.conversationId);
    }),
    create: protectedProcedure.input(z.object({ subject: z.string().min(3).max(180), body: z.string().min(1).max(2000) })).mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const id = await openSupportThread(db, { buyerId: ctx.user.id, subject: input.subject, body: input.body });
      return { success: true, conversationId: id };
    }),
    openForOrder: protectedProcedure
      .input(z.object({ orderId: z.number().int().positive(), body: z.string().min(1).max(2000).optional() }))
      .mutation(async ({ ctx, input }) => {
        const db = await dbOrThrow();
        const [order] = await db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "That order could not be found." });
        if (order.buyerId === null || order.sellerId === null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This order's chat is unavailable because a participant's account was removed." });
        }
        if (ctx.user.id !== order.buyerId && ctx.user.id !== order.sellerId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only the buyer or seller on this order can open its chat." });
        }
        const [existing] = await db.select({ id: conversations.id }).from(conversations)
          .where(and(
            eq(conversations.orderId, input.orderId),
            eq(conversations.buyerId, order.buyerId),
            eq(conversations.sellerId, order.sellerId),
            isNull(conversations.deletedAt),
          ))
          .limit(1);
        if (existing) return { conversationId: existing.id, created: false as const };
        const id = await openSupportThread(db, {
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          orderId: order.id,
          subject: `Order #${order.id}`,
          body: input.body ?? `Chat opened for order #${order.id}.`,
          senderId: ctx.user.id,
        });
        return { conversationId: id, created: true as const };
      }),
    openOfficerOrderThread: protectedProcedure
      .input(z.object({ orderId: z.number().int().positive(), body: z.string().min(1).max(2000).optional() }))
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller"]);
        const db = await dbOrThrow();
        const [order] = await db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "That order could not be found." });
        if (order.sellerId !== seller.id) throw new TRPCError({ code: "FORBIDDEN", message: "Only the seller on this order can open its officer conversation." });
        if (order.cooperativeId === null) throw new TRPCError({ code: "BAD_REQUEST", message: "This order has no cooperative officer to message." });
        // Reuse an existing officer thread for this order regardless of which approved
        // officer started it, so sellers never spawn duplicate officer conversations.
        const [existingThread] = await db.select({ id: conversations.id }).from(conversations)
          .innerJoin(users, eq(users.id, conversations.buyerId))
          .where(and(
            eq(conversations.orderId, order.id),
            eq(conversations.sellerId, seller.id),
            eq(users.role, "admin"),
            eq(users.cooperativeId, order.cooperativeId),
            isNull(conversations.deletedAt),
          ))
          .orderBy(asc(conversations.id))
          .limit(1);
        if (existingThread) return { conversationId: existingThread.id, created: false as const };
        const [officer] = await db.select({ id: users.id }).from(users).where(and(
          eq(users.cooperativeId, order.cooperativeId),
          eq(users.role, "admin"),
          eq(users.approvalStatus, "approved"),
          isNull(users.deletedAt),
        )).orderBy(asc(users.id)).limit(1);
        if (!officer) throw new TRPCError({ code: "NOT_FOUND", message: "No approved officer is assigned to this cooperative yet." });
        const id = await openSupportThread(db, {
          buyerId: officer.id,
          sellerId: seller.id,
          orderId: order.id,
          subject: `Order #${order.id} — officer coordination`,
          body: input.body ?? `Seller opened the officer conversation for order #${order.id}.`,
          senderId: seller.id,
        });
        return { conversationId: id, created: true as const };
      }),
    openForProduct: protectedProcedure
      .input(z.object({ productId: z.number().int().positive(), body: z.string().min(1).max(2000).optional() }))
      .mutation(async ({ ctx, input }) => {
        const buyer = requireOperationalRole(ctx.user, ["buyer", "seller"]);
        const db = await dbOrThrow();
        const [product] = await db.select().from(products).where(eq(products.id, input.productId)).limit(1);
        if (!product || product.sellerId === null) throw new TRPCError({ code: "NOT_FOUND", message: "That listing could not be found." });
        if (product.sellerId === buyer.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot message yourself about your own listing." });
        const id = await openSupportThread(db, {
          buyerId: buyer.id,
          sellerId: product.sellerId,
          productId: product.id,
          subject: `Inquiry: ${product.name}`,
          body: input.body ?? `Hello, I have a question about ${product.name}.`,
        });
        return { conversationId: id };
      }),
    updateInbox: protectedProcedure
      .input(z.object({
        threadIds: z.array(z.number().int().positive()).min(1).max(100),
        action: z.enum(["read", "unread", "pin", "unpin", "archive", "unarchive", "delete", "restore"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await dbOrThrow();
        const now = new Date();
        for (const threadId of input.threadIds) {
          const [thread] = await db.select().from(conversations).where(eq(conversations.id, threadId)).limit(1);
          if (!thread) continue;
          const seller = thread.sellerId == null
            ? undefined
            : (await db.select({ cooperativeId: users.cooperativeId }).from(users).where(eq(users.id, thread.sellerId)).limit(1))[0];
          if (!canAccessConversation(ctx.user, thread, seller?.cooperativeId ?? null)) continue;
          const [existing] = await db.select().from(threadStates).where(and(
            eq(threadStates.userId, ctx.user.id),
            eq(threadStates.channel, "conversation"),
            eq(threadStates.threadId, threadId),
          )).limit(1);
          const patch: Partial<typeof threadStates.$inferInsert> = { updatedAt: now };
          if (input.action === "read") patch.isRead = 1;
          if (input.action === "unread") patch.isRead = 0;
          if (input.action === "pin") patch.pinnedAt = now;
          if (input.action === "unpin") patch.pinnedAt = null;
          if (input.action === "archive") patch.archivedAt = now;
          if (input.action === "unarchive") patch.archivedAt = null;
          if (input.action === "delete") patch.deletedAt = now;
          if (input.action === "restore") { patch.deletedAt = null; patch.archivedAt = null; }
          if (existing) {
            await db.update(threadStates).set(patch).where(eq(threadStates.id, existing.id));
          } else {
            await db.insert(threadStates).values({
              userId: ctx.user.id,
              channel: "conversation",
              threadId,
              isRead: patch.isRead ?? 1,
              pinnedAt: patch.pinnedAt ?? null,
              archivedAt: patch.archivedAt ?? null,
              deletedAt: patch.deletedAt ?? null,
            });
          }
        }
        return { success: true };
      }),
    send: protectedProcedure.input(z.object({ conversationId: z.number().int().positive(), body: z.string().min(1).max(2000) })).mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const thread = (await db.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1))[0];
      const seller = thread?.sellerId === null || thread?.sellerId === undefined
        ? undefined
        : (await db.select({ cooperativeId: users.cooperativeId }).from(users).where(eq(users.id, thread.sellerId)).limit(1))[0];
      if (!thread || thread.deletedAt || !canAccessConversation(ctx.user, thread, seller?.cooperativeId ?? null)) throw new TRPCError({ code: "FORBIDDEN", message: "You cannot reply to this conversation." });
      const [message] = await db.insert(conversationMessages).values({ conversationId: input.conversationId, senderId: ctx.user.id, body: input.body }).returning({ id: conversationMessages.id });
      publishConversationMessage({ conversationId: input.conversationId, messageId: message.id, senderId: ctx.user.id });
      await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, input.conversationId));
      // Mark unread for the other participant (cross-user write via SECURITY DEFINER helper)
      const otherId = ctx.user.id === thread.buyerId ? thread.sellerId : thread.buyerId;
      if (otherId) {
        await db.execute(sql`select agricoop_app.mark_counterparty_thread_unread('conversation', ${input.conversationId}, ${ctx.user.id})`);
      }
      return { success: true };
    }),
  }),

  account: router({
    myProfile: protectedProcedure.query(({ ctx }) => ctx.user),
    updateProfile: protectedProcedure
      .input(accountProfileInputSchema)
      .mutation(async ({ ctx, input }) => {
        const db = await dbOrThrow();
        const patch: Record<string, unknown> = {};
        if (input.name !== undefined) patch.name = input.name;
        if (input.contactNumber !== undefined) patch.contactNumber = input.contactNumber;
        if (input.address !== undefined) patch.address = input.address;
        if (input.profileImageUrl !== undefined) patch.profileImageUrl = input.profileImageUrl;
        if (!Object.keys(patch).length) return { success: true };
        await db.update(users).set(patch).where(eq(users.id, ctx.user.id));
        return { success: true };
      }),
    uploadProfileImage: protectedProcedure
      .input(z.object({
        fileName: z.string().min(1).max(255),
        contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        base64: z.string().min(1).max(Math.ceil(MAX_PROFILE_IMAGE_SIZE_BYTES / 3) * 4),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The selected image file is invalid." });
        }
        const bytes = Buffer.from(input.base64, "base64");
        if (!isProfileImageSizeAllowed(bytes.length)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Profile photos must be 2 MB or less after compression." });
        }
        if (!matchesImageContentTypeSignature(bytes, input.contentType)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Use a JPEG, PNG, or WebP image." });
        }
        const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "profile.jpg";
        const folder = ctx.user.openId || String(ctx.user.id);
        // Path must stay under the caller's auth uid folder (storage policies + authz tests).
        if (!folder || folder.includes("/") || folder.includes("..")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Profile photo path is invalid." });
        }
        const uploaded = await storagePut(
          `${folder}/${Date.now()}-${safeName}`,
          bytes,
          input.contentType,
          { bucket: "avatars", public: true },
        );
        const db = await dbOrThrow();
        await db.update(users).set({ profileImageUrl: uploaded.url }).where(eq(users.id, ctx.user.id));
        return { url: uploaded.url };
      }),
    verificationMine: protectedProcedure.query(async ({ ctx }) => {
      const db = await dbOrThrow();
      const submissions = await db.select({
        id: profileVerificationSubmissions.id,
        status: profileVerificationSubmissions.status,
        submissionNote: profileVerificationSubmissions.submissionNote,
        submittedAt: profileVerificationSubmissions.submittedAt,
        reviewedAt: profileVerificationSubmissions.reviewedAt,
        reviewNote: profileVerificationSubmissions.reviewNote,
      }).from(profileVerificationSubmissions)
        .where(eq(profileVerificationSubmissions.userId, ctx.user.id))
        .orderBy(desc(profileVerificationSubmissions.submittedAt), desc(profileVerificationSubmissions.id));
      return { status: ctx.user.verificationStatus, submissions };
    }),
    requestVerificationUpload: protectedProcedure
      .input(profileVerificationUploadInputSchema)
      .mutation(async ({ ctx, input }) => {
        const applicant = requireOperationalRole(ctx.user, ["buyer", "seller"]);
        if (!canSubmitProfileVerification(applicant)) {
          throw new TRPCError({ code: "CONFLICT", message: "A pending or approved verification cannot be resubmitted." });
        }
        const db = await dbOrThrow();
        const [latest] = await db.select({ status: profileVerificationSubmissions.status })
          .from(profileVerificationSubmissions)
          .where(eq(profileVerificationSubmissions.userId, applicant.id))
          .orderBy(desc(profileVerificationSubmissions.submittedAt), desc(profileVerificationSubmissions.id))
          .limit(1);
        if (latest && latest.status !== "rejected") {
          throw new TRPCError({ code: "CONFLICT", message: "A pending or approved verification cannot be resubmitted." });
        }

        const extension = profileVerificationExtension(input.contentType);
        if (!extension) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a supported verification image." });
        }
        const storagePath = `${PROFILE_VERIFICATION_BUCKET}/${applicant.id}/${crypto.randomUUID()}.${extension}`;
        const signedUpload = await storageCreateSignedUploadUrl(storagePath, PROFILE_VERIFICATION_BUCKET);
        if (signedUpload.path !== storagePath || !isProfileVerificationStorageKey(signedUpload.path, applicant.id)) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Private Storage returned an invalid verification path." });
        }
        return {
          storagePath: signedUpload.path,
          uploadToken: signedUpload.token,
          uploadIntent: createProfileVerificationUploadIntent({
            userId: applicant.id,
            storagePath: signedUpload.path,
            mimeType: input.contentType,
            fileSizeBytes: input.fileSizeBytes,
          }),
        };
      }),
    submitVerification: protectedProcedure
      .input(profileVerificationSubmissionInputSchema)
      .mutation(async ({ ctx, input }) => {
        const applicant = requireOperationalRole(ctx.user, ["buyer", "seller"]);
        if (!canSubmitProfileVerification(applicant)) {
          throw new TRPCError({ code: "CONFLICT", message: "A pending or approved verification cannot be resubmitted." });
        }
        const intent = verifyProfileVerificationUploadIntent(input.uploadIntent, applicant.id);
        if (!intent) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The verification upload authorization is invalid or expired." });
        }

        try {
          const bytes = await storageDownloadPrivateObject(intent.storagePath, PROFILE_VERIFICATION_BUCKET);
          if (bytes.length !== intent.fileSizeBytes || bytes.length > PROFILE_VERIFICATION_MAX_BYTES) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded verification image size does not match its authorization." });
          }
          if (!matchesImageContentTypeSignature(bytes, intent.mimeType)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded verification image does not match its declared format." });
          }

          const db = await dbOrThrow();
          const submissionId = await db.transaction(async tx => {
            const [target] = await tx.select({
              id: users.id,
              cooperativeId: users.cooperativeId,
              verificationStatus: users.verificationStatus,
            }).from(users)
              .where(eq(users.id, applicant.id))
              .for("update")
              .limit(1);
            if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "The applicant profile was not found." });

            const [latest] = await tx.select({
              id: profileVerificationSubmissions.id,
              status: profileVerificationSubmissions.status,
            }).from(profileVerificationSubmissions)
              .where(eq(profileVerificationSubmissions.userId, applicant.id))
              .orderBy(desc(profileVerificationSubmissions.submittedAt), desc(profileVerificationSubmissions.id))
              .limit(1)
              .for("update");
            if (!canSubmitProfileVerification({ role: applicant.role, verificationStatus: target.verificationStatus })
              || (latest && !canSubmitProfileVerification({ role: applicant.role, verificationStatus: latest.status }))) {
              throw new TRPCError({ code: "CONFLICT", message: "A pending or approved verification cannot be resubmitted." });
            }

            await tx.execute(sql`select set_config('agricoop.profile_verification_upload_verified', '1', true)`);
            const [submission] = await tx.insert(profileVerificationSubmissions).values({
              userId: applicant.id,
              storagePath: intent.storagePath,
              mimeType: intent.mimeType,
              fileSizeBytes: bytes.length,
              submissionNote: input.note?.trim() || null,
              status: "pending",
            }).returning({ id: profileVerificationSubmissions.id });
            if (!submission) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Verification submission metadata was not saved." });

            await tx.update(users).set({
              birthdate: new Date(`${input.birthdate}T00:00:00.000Z`),
              phone: input.phone.trim(),
              address: input.address?.trim() || null,
              verificationStatus: "pending",
              verificationNote: input.note?.trim() || null,
              verifiedBy: null,
              verifiedAt: null,
            }).where(eq(users.id, applicant.id));
            await createNotification(tx, {
              userId: applicant.id,
              type: "profile_verification_submitted",
              title: "Verification submitted",
              content: "Your profile verification is waiting for an administrator's review.",
              link: "/dashboard",
              relatedEntityId: submission.id,
              relatedEntityType: "profile_verification_submission",
            });
            return submission.id;
          });
          return { success: true, submissionId, verificationStatus: "pending" as const };
        } catch (error) {
          try {
            const removed = await storageDeleteObject(
              intent.storagePath,
              `${PROFILE_VERIFICATION_BUCKET}/${applicant.id}/`,
              { bucket: PROFILE_VERIFICATION_BUCKET, public: false },
            );
            if (!removed) throw new Error("The uploaded object was outside the applicant's storage scope.");
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "Verification submission failed and the uploaded document could not be safely cleaned up.",
            );
          }
          throw error;
        }
      }),
    verificationQueue: protectedProcedure.query(async ({ ctx }) => {
      const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
      if (actor.role === "admin" && actor.cooperativeId === null) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Assign this Admin to a cooperative before reviewing verification submissions." });
      }
      const db = await dbOrThrow();
      const scope = actor.role === "admin" ? eq(users.cooperativeId, actor.cooperativeId!) : undefined;
      const rows = await db.select({
        submissionId: profileVerificationSubmissions.id,
        userId: users.id,
        name: users.name,
        role: users.role,
        cooperativeId: users.cooperativeId,
        birthdate: users.birthdate,
        phone: users.phone,
        address: users.address,
        submissionNote: profileVerificationSubmissions.submissionNote,
        storagePath: profileVerificationSubmissions.storagePath,
        mimeType: profileVerificationSubmissions.mimeType,
        fileSizeBytes: profileVerificationSubmissions.fileSizeBytes,
        submittedAt: profileVerificationSubmissions.submittedAt,
      }).from(profileVerificationSubmissions)
        .innerJoin(users, eq(profileVerificationSubmissions.userId, users.id))
        .where(scope
          ? and(eq(profileVerificationSubmissions.status, "pending"), scope)
          : eq(profileVerificationSubmissions.status, "pending"))
        .orderBy(asc(profileVerificationSubmissions.submittedAt), asc(profileVerificationSubmissions.id))
        .limit(100);
      return Promise.all(rows.map(async ({ storagePath, userId, ...row }) => {
        const validPath = isProfileVerificationStorageKey(storagePath, userId);
        return {
          ...row,
          userId,
          evidenceUrl: validPath
            ? await storageGetSignedUrl(storagePath, { bucket: PROFILE_VERIFICATION_BUCKET, public: false, expiresIn: 60 })
            : null,
          evidenceUnavailable: !validPath,
        };
      }));
    }),
    reviewVerification: protectedProcedure
      .input(z.object({
        submissionId: z.number().int().positive(),
        decision: z.enum(["approved", "rejected"]),
        note: z.string().trim().max(600).optional(),
      }).strict().superRefine((input, refinement) => {
        if (input.decision === "rejected" && !input.note?.trim()) {
          refinement.addIssue({ code: "custom", path: ["note"], message: "A rejection reason is required." });
        }
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        return db.transaction(async tx => {
          const [target] = await tx.select({
            submissionId: profileVerificationSubmissions.id,
            userId: users.id,
            cooperativeId: users.cooperativeId,
            verificationStatus: profileVerificationSubmissions.status,
          }).from(profileVerificationSubmissions)
            .innerJoin(users, eq(profileVerificationSubmissions.userId, users.id))
            .where(eq(profileVerificationSubmissions.id, input.submissionId))
            .for("update")
            .limit(1);
          if (!target) {
            throw new TRPCError({ code: "NOT_FOUND", message: "The requested verification submission was not found." });
          }
          if (!canManageCooperativeResource(actor, target.cooperativeId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You can only review members from your own cooperative." });
          }
          if (target.verificationStatus !== "pending") {
            throw new TRPCError({ code: "CONFLICT", message: "Only a pending profile verification can be reviewed." });
          }

          const reviewedAt = new Date();
          const reviewNote = input.note?.trim() || null;
          const result = await tx.update(profileVerificationSubmissions).set({
            status: input.decision,
            reviewNote,
            reviewedBy: actor.id,
            reviewedAt,
          }).where(and(
            eq(profileVerificationSubmissions.id, target.submissionId),
            eq(profileVerificationSubmissions.status, "pending"),
          )).returning({ id: profileVerificationSubmissions.id });
          if (result.length !== 1) {
            throw new TRPCError({ code: "CONFLICT", message: "The profile verification changed while it was being reviewed." });
          }
          const userUpdate = await tx.update(users).set({
            verificationStatus: input.decision,
            verificationNote: reviewNote,
            verifiedBy: actor.id,
            verifiedAt: reviewedAt,
          }).where(and(
            eq(users.id, target.userId),
            eq(users.verificationStatus, "pending"),
          )).returning({ id: users.id });
          if (userUpdate.length !== 1) {
            throw new TRPCError({ code: "CONFLICT", message: "The profile verification changed while it was being reviewed." });
          }

          await createNotification(tx, {
            userId: target.userId,
            type: `profile_verification_${input.decision}`,
            title: input.decision === "approved" ? "Profile verification approved" : "Profile verification rejected",
            content: input.decision === "approved"
              ? "Your profile verification has been approved."
              : `Your profile verification was rejected. Reason: ${reviewNote}`,
            link: "/dashboard",
            relatedEntityId: target.submissionId,
            relatedEntityType: "profile_verification_submission",
          });
          return { success: true, verificationStatus: input.decision };
        });
      }),
  }),

  cooperatives: router({
    list: publicProcedure.query(() => getCooperatives()),
    listActive: publicProcedure.query(() => getCooperatives()),
    previewCreate: publicProcedure
      .input(z.object({
        cooperativeId: z.number().int().positive().optional(),
        newCooperativeName: z.string().trim().min(1).max(180).optional(),
        newCooperativeLocation: z.string().trim().min(1).max(180).optional(),
        newCooperativeAddress: z.string().trim().min(1).max(255).optional(),
        confirmSimilarNormalizedName: z.string().trim().min(2).max(180).optional(),
      }).strict())
      .query(async ({ input }) => {
        try {
          const preview = await previewUserCooperativeSelection(await dbOrThrow(), input);
          if (preview.kind === "exact_duplicate" || preview.kind === "similar_matches" || preview.kind === "needs_confirmation") {
            throwIfCooperativeConflict(preview);
          }
          return { ok: true as const, kind: preview.kind };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error instanceof Error ? error.message : "Invalid cooperative selection.",
          });
        }
      }),
    manageList: protectedProcedure.query(async ({ ctx }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const cooperativeScope = adminOverviewCooperativeScope(actor);
        if (cooperativeScope === null) return [];
      const db = await dbOrThrow();
        const rows = await db.select().from(cooperatives)
          .where(cooperativeScope === undefined ? undefined : eq(cooperatives.id, cooperativeScope))
          .orderBy(asc(cooperatives.name));
      const usage = await Promise.all(rows.map(async row => {
        const [sellers] = await db.select({ count: sql<number>`count(*)::int` }).from(users)
          .where(and(eq(users.cooperativeId, row.id), eq(users.role, "seller")));
        const [listings] = await db.select({ count: sql<number>`count(*)::int` }).from(products)
          .where(eq(products.cooperativeId, row.id));
        return {
          ...row,
          sellerCount: Number(sellers?.count ?? 0),
          listingCount: Number(listings?.count ?? 0),
        };
      }));
      return usage;
    }),
    bySlug: publicProcedure
      .input(z.object({ slug: z.string().trim().min(1).max(200) }))
      .query(async ({ input }) => {
        const db = await dbOrThrow();
        const slug = decodeURIComponent(input.slug).trim().toLowerCase();
        const [cooperative] = await db.select().from(cooperatives)
          .where(and(
            eq(cooperatives.normalizedName, slug),
            eq(cooperatives.status, "active"),
            isNull(cooperatives.deletedAt),
          ))
          .limit(1);
        if (!cooperative) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cooperative not found." });
        }
        const candidateProducts = await db
          .select({
            id: products.id,
            name: products.name,
            variety: products.variety,
            category: products.category,
            unit: products.unit,
            priceCents: products.priceCents,
            stockQty: products.stockQty,
            minOrderQty: products.minOrderQty,
            status: products.status,
            verificationStatus: products.verificationStatus,
            visibility: products.visibility,
            deletedAt: products.deletedAt,
            primaryImageUrl: products.primaryImageUrl,
            allowsPickup: products.allowsPickup,
            allowsDelivery: products.allowsDelivery,
            acceptsOnlinePayment: products.acceptsOnlinePayment,
          })
          .from(products)
          .innerJoin(users, eq(products.sellerId, users.id))
          .where(and(
            eq(products.cooperativeId, cooperative.id),
            eq(products.status, "published"),
            eq(products.verificationStatus, "approved"),
            eq(products.visibility, "visible"),
            isNull(products.deletedAt),
            eq(users.approvalStatus, "approved"),
            isNull(users.deletedAt),
          ));
        const reservations = await getOpenOrderReservationQuantities(db, candidateProducts.map(p => p.id));
        const productsForCoop = candidateProducts
          .filter(product => !productPurchaseBlockReason({
            ...product,
            stockQty: availableStockAfterReservations(product.stockQty, reservations.get(product.id) ?? 0),
          }, { approvalStatus: "approved", deletedAt: null }))
          .map(product => ({
            id: product.id,
            name: product.name,
            variety: product.variety,
            category: product.category,
            unit: product.unit,
            priceCents: product.priceCents,
            primaryImageUrl: product.primaryImageUrl,
            allowsPickup: product.allowsPickup,
            allowsDelivery: product.allowsDelivery,
            acceptsOnlinePayment: product.acceptsOnlinePayment,
          }));
        return {
          cooperative: {
            id: cooperative.id,
            name: cooperative.name,
            address: cooperative.address,
            location: cooperative.location,
            description: cooperative.description,
            status: cooperative.status,
            slug: cooperative.normalizedName,
          },
          products: productsForCoop,
        };
      }),
    create: protectedProcedure
      .input(z.object({
        name: z.string().min(3).max(180),
        location: z.string().min(3).max(180),
        address: z.string().min(3).max(255),
        description: z.string().max(600).optional(),
        confirmSimilarNormalizedName: z.string().trim().min(2).max(180).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["superadmin"]);
        const db = await dbOrThrow();
        const preview = await previewUserCooperativeSelection(db, {
          newCooperativeName: input.name,
          newCooperativeLocation: input.location,
          newCooperativeAddress: input.address,
          confirmSimilarNormalizedName: input.confirmSimilarNormalizedName,
        });
        throwIfCooperativeConflict(preview);
        const normalized = normalizeCooperativeName(input.name);
        const location = normalizeCooperativeLocation(input.location);
        const address = normalizeCooperativeAddress(input.address);
        try {
          await db.insert(cooperatives).values({
            name: normalized.displayName,
            normalizedName: normalized.normalizedName,
            location: location.displayLocation,
            normalizedLocation: location.normalizedLocation,
            address,
            description: input.description,
            source: "staff",
            createdBy: actor.id,
          });
        } catch (error) {
          const code = String((error as { code?: string })?.code ?? "");
          if (code === "23505") {
            throw new TRPCError({
              code: "CONFLICT",
              message: formatExactDuplicateConflict({
                id: 0,
                name: normalized.displayName,
                normalizedName: normalized.normalizedName,
                address,
                location: location.displayLocation,
              }),
            });
          }
          throw error;
        }
        return { success: true };
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        name: z.string().min(3).max(180).optional(),
        location: z.string().min(3).max(180).optional(),
        address: z.string().min(3).max(255).optional(),
        description: z.string().max(600).nullable().optional(),
        confirmSimilarNormalizedName: z.string().trim().min(2).max(180).optional(),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        assertCooperativeManagementScope(actor, input.id);
        const db = await dbOrThrow();
        const [existing] = await db.select().from(cooperatives).where(eq(cooperatives.id, input.id)).limit(1);
        if (!existing || existing.deletedAt) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cooperative not found." });
        }
        const nextName = input.name ?? existing.name;
        const nextLocation = input.location ?? existing.location;
        const nextAddress = input.address ?? existing.address;
        if (input.name !== undefined || input.location !== undefined || input.address !== undefined) {
          const preview = await previewUserCooperativeSelection(db, {
            newCooperativeName: nextName,
            newCooperativeLocation: nextLocation,
            newCooperativeAddress: nextAddress,
            confirmSimilarNormalizedName: input.confirmSimilarNormalizedName,
          });
          if (
            (preview.kind === "exact_duplicate" || preview.kind === "similar_matches")
            && !(preview.kind === "exact_duplicate" && preview.match.id === input.id)
            && !(preview.kind === "similar_matches" && preview.matches.every(m => m.id === input.id))
          ) {
            if (preview.kind === "exact_duplicate" && preview.match.id !== input.id) {
              throwIfCooperativeConflict(preview);
            }
            if (preview.kind === "similar_matches") {
              const others = preview.matches.filter(m => m.id !== input.id);
              if (others.length && input.confirmSimilarNormalizedName !== normalizeCooperativeName(nextName).normalizedName) {
                throwIfCooperativeConflict({ kind: "similar_matches", matches: others, message: preview.message });
              }
            }
          }
        }
        const patch: Partial<typeof cooperatives.$inferInsert> = {};
        if (input.name !== undefined) {
          const normalized = normalizeCooperativeName(input.name);
          patch.name = normalized.displayName;
          patch.normalizedName = normalized.normalizedName;
        }
        if (input.location !== undefined) {
          const location = normalizeCooperativeLocation(input.location);
          patch.location = location.displayLocation;
          patch.normalizedLocation = location.normalizedLocation;
        }
        if (input.address !== undefined) patch.address = normalizeCooperativeAddress(input.address);
        if (input.description !== undefined) patch.description = input.description;
        if (!Object.keys(patch).length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Provide at least one cooperative field to update." });
        }
        const updated = await db.update(cooperatives).set(patch).where(eq(cooperatives.id, input.id)).returning({ id: cooperatives.id });
        if (!updated.length) throw new TRPCError({ code: "NOT_FOUND", message: "Cooperative not found." });
        await recordAuditLog(db, {
          actorUserId: actor.id,
          action: "cooperative_updated",
          entityType: "cooperative",
          entityId: input.id,
          cooperativeId: input.id,
          metadata: patch,
        });
        return { success: true };
      }),
    softDelete: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        assertCooperativeManagementScope(actor, input.id);
        const db = await dbOrThrow();
        return db.transaction(async tx => {
          const [row] = await tx.select().from(cooperatives)
            .where(eq(cooperatives.id, input.id))
            .for("update")
            .limit(1);
          if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Cooperative not found." });
          if (row.deletedAt) throw new TRPCError({ code: "CONFLICT", message: "This cooperative is already deleted." });
          const [sellers] = await tx.select({ count: sql<number>`count(*)::int` }).from(users)
            .where(and(eq(users.cooperativeId, input.id), eq(users.role, "seller")));
          const [listings] = await tx.select({ count: sql<number>`count(*)::int` }).from(products)
            .where(eq(products.cooperativeId, input.id));
          const [updated] = await tx.update(cooperatives).set({
            deletedAt: new Date(),
            deletedBy: actor.id,
            status: "inactive",
          }).where(and(eq(cooperatives.id, input.id), isNull(cooperatives.deletedAt)))
            .returning({ id: cooperatives.id });
          if (!updated) throw new TRPCError({ code: "CONFLICT", message: "This cooperative was already deleted." });
          const sellerCount = Number(sellers?.count ?? 0);
          const listingCount = Number(listings?.count ?? 0);
          await recordAuditLog(tx, {
            actorUserId: actor.id,
            action: "cooperative_soft_deleted",
            entityType: "cooperative",
            entityId: input.id,
            cooperativeId: input.id,
            metadata: { sellerCount, listingCount },
          });
          return { success: true, sellerCount, listingCount };
        });
      }),
    restore: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        assertCooperativeManagementScope(actor, input.id);
        const db = await dbOrThrow();
        const [row] = await db.select().from(cooperatives).where(eq(cooperatives.id, input.id)).limit(1);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Cooperative not found." });
        if (!row.deletedAt) throw new TRPCError({ code: "CONFLICT", message: "This cooperative is not deleted." });
        // Race: another active coop with same name+location
        const [clash] = await db.select({ id: cooperatives.id }).from(cooperatives).where(and(
          eq(cooperatives.normalizedName, row.normalizedName),
          eq(cooperatives.normalizedLocation, row.normalizedLocation),
          isNull(cooperatives.deletedAt),
          ne(cooperatives.id, row.id),
        )).limit(1);
        if (clash) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Another active cooperative already uses this name and location.",
          });
        }
        await db.update(cooperatives).set({
          deletedAt: null,
          deletedBy: null,
          status: "active",
        }).where(eq(cooperatives.id, input.id));
        await recordAuditLog(db, {
          actorUserId: actor.id,
          action: "cooperative_restored",
          entityType: "cooperative",
          entityId: input.id,
          cooperativeId: input.id,
        });
        return { success: true };
      }),
    setStatus: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        status: z.enum(["active", "inactive"]),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        assertCooperativeManagementScope(actor, input.id);
        const db = await dbOrThrow();
        const updated = await db.update(cooperatives)
          .set({ status: input.status })
          .where(and(eq(cooperatives.id, input.id), isNull(cooperatives.deletedAt)))
          .returning({ id: cooperatives.id });
        if (!updated.length) throw new TRPCError({ code: "NOT_FOUND", message: "Cooperative not found." });
        await recordAuditLog(db, {
          actorUserId: actor.id,
          action: input.status === "active" ? "cooperative_activated" : "cooperative_deactivated",
          entityType: "cooperative",
          entityId: input.id,
          cooperativeId: input.id,
        });
        return { success: true };
      }),
  }),

  sellers: router({
    getOnlinePayment: protectedProcedure
      .input(z.object({ sellerId: z.number().int().positive() }).optional())
      .query(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["buyer", "seller", "admin", "superadmin"]);
        const empty = {
          sellerId: input?.sellerId ?? actor.id,
          qrImageUrl: null as string | null,
          hasQr: false,
          accountName: null as string | null,
          accountNumber: null as string | null,
          label: null as string | null,
        };
        // Legacy seller profile path: do not read or write users.onlinePayment* columns.
        if (actor.role === "seller" && (input?.sellerId === undefined || input.sellerId === actor.id)) {
          return empty;
        }
        if (actor.role === "seller") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Seller payment details were not found." });
        }
        const db = await dbOrThrow();
        const account = await getActiveOnlineAccount(db);
        if (!account?.qrImagePath) return empty;
        let qrImageUrl: string | null = null;
        try {
          qrImageUrl = account.qrImagePath.startsWith("http")
            ? account.qrImagePath
            : await storageGetSignedUrl(account.qrImagePath, {
              bucket: SYSTEM_PAYMENT_QR_BUCKET,
              public: false,
              expiresIn: 300,
            });
        } catch {
          qrImageUrl = null;
        }
        return {
          sellerId: input?.sellerId ?? actor.id,
          qrImageUrl,
          hasQr: Boolean(account.qrImagePath),
          accountName: account.accountName ?? null,
          accountNumber: account.accountNumber ?? null,
          label: account.label ?? null,
        };
      }),
    uploadOnlinePaymentQr: protectedProcedure
      .input(z.object({
        fileName: z.string().min(1).max(255),
        contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        base64: z.string().min(1).max(Math.ceil(PAYMENT_PROOF_MAX_BYTES / 3) * 4),
      }))
      .mutation(async () => {
        throw new TRPCError({ code: "FORBIDDEN", message: "Online payment is managed by cooperative officers." });
      }),
    saveOnlinePaymentDetails: protectedProcedure
      .input(z.object({
        accountName: z.string().trim().max(150).optional(),
        accountNumber: z.string().trim().max(100).optional(),
        label: z.string().trim().max(150).optional(),
      }).strict())
      .mutation(async () => {
        throw new TRPCError({ code: "FORBIDDEN", message: "Online payment is managed by cooperative officers." });
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
      .input(z.object({
        category: z.string().optional(),
        sort: z.enum(["asc", "desc"]).default("asc"),
      }).nullish())
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
        if (seller.role === "seller" && seller.cooperativeId == null && input.submitForVerification) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Ask an Admin to assign you to a cooperative before publishing listings.",
          });
        }
        const db = await dbOrThrow();
        validateProductImageUrls(input.imageUrls, seller.id);
        const { imageUrls, submitForVerification, ...productValues } = input;
        const verificationStatus = submitForVerification ? "pending" : "draft";
        try {
          return await db.transaction(async tx => {
            const insertResult = await tx.execute(sql`
              insert into agricoop_app.products (
                "sellerId", "cooperativeId", name, category, variety, description, unit,
                "priceCents", "stockQty", "minOrderQty", "qualityGrade", status,
                "verificationStatus", visibility, "primaryImageUrl",
                "allowsPickup", "allowsDelivery", "acceptsOnlinePayment", "onlinePaymentEnabled",
                "fulfillmentType", "prepTimeDays", "capacityNote"
              ) values (
                ${seller.id},
                ${seller.cooperativeId},
                ${productValues.name},
                ${productValues.category},
                ${productValues.variety},
                ${productValues.description ?? null},
                ${productValues.unit},
                ${productValues.priceCents},
                ${productValues.stockQty},
                ${productValues.minOrderQty},
                ${productValues.qualityGrade}::agricoop_app.product_quality_grade,
                ${"published"}::agricoop_app.product_status,
                ${verificationStatus}::agricoop_app.product_verification_status,
                ${"hidden"}::agricoop_app.product_visibility,
                ${imageUrls[0] ?? null},
                ${productValues.allowsPickup},
                ${productValues.allowsDelivery},
                ${false},
                ${productValues.onlinePaymentEnabled},
                ${productValues.fulfillmentType},
                ${productValues.prepTimeDays ?? null},
                ${productValues.capacityNote ?? null}
              )
              returning id
            `);
            const createdRow = (insertResult as unknown as Array<{ id: number }>)[0];
            if (!createdRow?.id) {
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Product creation did not return an ID." });
            }
            if (imageUrls.length) {
              for (let displayOrder = 0; displayOrder < imageUrls.length; displayOrder += 1) {
                await tx.execute(sql`
                  insert into agricoop_app."productImages" ("productId", "imageUrl", "displayOrder")
                  values (${createdRow.id}, ${imageUrls[displayOrder]}, ${displayOrder})
                `);
              }
            }
            return { success: true };
          });
        } catch (error) {
          const postgresCode = typeof error === "object" && error && "code" in error
            ? String((error as { code: unknown }).code)
            : undefined;
          if (postgresCode === "42501") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Your account does not have permission to create listings. Contact an administrator to review database grants.",
            });
          }
          throw error;
        }
      }),
    uploadImage: protectedProcedure
      .input(z.object({
        fileName: z.string().min(1).max(255),
        contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        base64: z.string().min(1).max(Math.ceil(MAX_PRODUCT_IMAGE_SIZE_BYTES / 3) * 4),
      }))
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller", "admin", "superadmin"]);
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The selected image file is invalid." });
        }
        const bytes = Buffer.from(input.base64, "base64");
        if (!isProductImageSizeAllowed(bytes.length)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Product images must be 3 MB or less." });
        }
        if (!matchesImageContentTypeSignature(bytes, input.contentType)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The selected file is not a valid image of the declared type." });
        }
        const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "product-image";
        const uploaded = await storagePut(`products/${seller.id}/${Date.now()}-${safeName}`, bytes, input.contentType);
        return { url: uploaded.url };
      }),
    submit: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller", "admin", "superadmin"]);
        if (seller.role === "seller" && seller.cooperativeId == null) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Ask an Admin to assign you to a cooperative before publishing listings.",
          });
        }
        const db = await dbOrThrow();
        const result = await db.update(products).set({ verificationStatus: "pending", visibility: "hidden", rejectionReason: null }).where(and(eq(products.id, input.id), eq(products.sellerId, seller.id))).returning({ id: products.id });
        if (!result.length) throw new TRPCError({ code: "NOT_FOUND", message: "This listing is unavailable or belongs to another Seller." });
        return { success: true };
      }),
    update: protectedProcedure
        .input(updateProductSchema)
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller", "admin", "superadmin"]);
        const db = await dbOrThrow();
        const { id, imageUrls, primaryImageUrl, ...values } = input;
        assertProductImageUpdateInput(imageUrls, primaryImageUrl);
        return db.transaction(async tx => {
          const [existingProduct] = await tx.select({
            id: products.id,
            cooperativeId: products.cooperativeId,
            primaryImageUrl: products.primaryImageUrl,
            verificationStatus: products.verificationStatus,
            name: products.name,
            category: products.category,
            variety: products.variety,
            description: products.description,
            unit: products.unit,
            priceCents: products.priceCents,
            minOrderQty: products.minOrderQty,
            qualityGrade: products.qualityGrade,
          }).from(products)
            .where(and(eq(products.id, id), eq(products.sellerId, seller.id)))
            .for("update")
            .limit(1);
          if (!existingProduct) throw new TRPCError({ code: "NOT_FOUND", message: "This listing is unavailable or belongs to another seller." });
          let currentImageUrls: string[] = [];
          if (imageUrls !== undefined) {
            const existingImages = await tx.select({ imageUrl: productImages.imageUrl })
              .from(productImages)
              .where(eq(productImages.productId, id));
            currentImageUrls = existingImages.length
              ? existingImages.map(row => row.imageUrl)
              : existingProduct.primaryImageUrl ? [existingProduct.primaryImageUrl] : [];
            validateProductImageUrls(
              imageUrls,
              seller.id,
              [existingProduct.primaryImageUrl, ...existingImages.map(row => row.imageUrl)].filter((url): url is string => url !== null),
            );
          }
          const nextPrimaryImageUrl = imageUrls === undefined ? existingProduct.primaryImageUrl : imageUrls[0] ?? null;
          const reviewState = prepareProductUpdateReviewState(
            existingProduct,
            values,
            currentImageUrls,
            imageUrls ?? currentImageUrls,
            nextPrimaryImageUrl,
          );
          const updateValues = {
            ...(imageUrls === undefined ? values : { ...values, primaryImageUrl: nextPrimaryImageUrl }),
            ...reviewState.moderationUpdate,
            acceptsOnlinePayment: false,
          };
          const result = await tx.update(products).set(updateValues).where(and(eq(products.id, id), eq(products.sellerId, seller.id))).returning({ id: products.id });
          if (!result.length) throw new TRPCError({ code: "NOT_FOUND", message: "This listing is unavailable or belongs to another seller." });
          if (reviewState.reviewRequired) {
            await recordAuditLog(tx, {
              actorUserId: seller.id,
              action: "product.content_revised_for_review",
              entityType: "product",
              entityId: id,
              cooperativeId: existingProduct.cooperativeId,
              metadata: { verificationStatus: "pending", visibility: "hidden" },
            });
          }
          if (imageUrls !== undefined) {
            await tx.delete(productImages).where(eq(productImages.productId, id));
            if (imageUrls.length) {
              await tx.insert(productImages).values(imageUrls.map((imageUrl, displayOrder) => ({
                productId: id,
                imageUrl,
                displayOrder,
              })));
            }
          }
          return { success: true, reviewRequired: reviewState.reviewRequired };
        });
      }),
    archive: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller", "admin", "superadmin"]);
        const db = await dbOrThrow();
        const archived = await db.update(products).set({ status: "archived" }).where(and(eq(products.id, input.id), eq(products.sellerId, seller.id))).returning({ id: products.id });
        if (!archived.length) throw new TRPCError({ code: "NOT_FOUND", message: "This listing is unavailable or belongs to another seller." });
        return { success: true };
      }),
    unarchive: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller", "admin", "superadmin"]);
        const db = await dbOrThrow();
        const restored = await db.update(products).set({ status: "published" }).where(and(
          eq(products.id, input.id),
          eq(products.sellerId, seller.id),
          eq(products.status, "archived"),
          isNull(products.deletedAt),
        )).returning({ id: products.id });
        if (!restored.length) throw new TRPCError({ code: "NOT_FOUND", message: "This listing is unavailable, soft-deleted, or belongs to another seller." });
        return { success: true };
      }),
    softDelete: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller", "admin", "superadmin"]);
        const db = await dbOrThrow();
        const removed = await db.update(products).set({
          status: "archived",
          visibility: "hidden",
          deletedAt: new Date(),
          deletedBy: seller.id,
        }).where(and(
          eq(products.id, input.id),
          eq(products.sellerId, seller.id),
          isNull(products.deletedAt),
        )).returning({ id: products.id });
        if (!removed.length) throw new TRPCError({ code: "NOT_FOUND", message: "This listing is unavailable or belongs to another seller." });
        return { success: true };
      }),
  }),

  quotations: router({
    buyerMine: quotationArchiveProcedures.buyerMine,
    sellerMine: quotationArchiveProcedures.sellerMine,
    counts: quotationArchiveProcedures.counts,
    updateState: quotationArchiveProcedures.updateState,
    request: protectedProcedure
      .input(z.object({ productId: z.number().int().positive(), requestedQty: z.number().int().positive(), buyerNote: z.string().max(600).optional() }))
      .mutation(async ({ ctx, input }) => {
        const buyer = requireOperationalRole(ctx.user, ["buyer", "seller"]);
        const db = await dbOrThrow();
        return db.transaction(async tx => {
          await tx.execute(sql`select set_config('agricoop.quotation_request_scope', 'on', true)`);
          const productRows = Array.from(await tx.execute(sql`
            select * from agricoop_app.quotation_request_lock_product(${input.productId})
          `)) as unknown as Array<typeof products.$inferSelect>;
          const product = productRows[0];
          if (!product || product.sellerId === null) {
            throw new TRPCError({ code: "NOT_FOUND", message: "The selected product is not currently listed." });
          }
          try {
            assertNotSelfTransaction(buyer.id, product.sellerId);
          } catch (error) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to request this quotation." });
          }
          const sellerRows = Array.from(await tx.execute(sql`
            select * from agricoop_app.quotation_request_lock_seller(${product.sellerId})
          `)) as unknown as Array<Pick<typeof users.$inferSelect, "id" | "approvalStatus" | "deletedAt">>;
          const seller = sellerRows[0];
          const reserved = await getOpenOrderReservationQuantities(tx, [product.id]);
          const availableQty = availableStockAfterReservations(
            product.stockQty,
            reserved.get(product.id) ?? 0,
          );
          const purchaseBlockReason = productPurchaseBlockReason({
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
            approvalStatus: seller?.approvalStatus ?? "suspended",
            deletedAt: seller?.deletedAt,
          });
          if (purchaseBlockReason) {
            throw new TRPCError({ code: "NOT_FOUND", message: purchaseBlockReason });
          }
          if (input.requestedQty < product.minOrderQty) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Minimum order is ${product.minOrderQty} ${product.unit}.` });
          }
          if (input.requestedQty > availableQty) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Only ${availableQty} ${product.unit} are currently available.` });
          }
          const [quotation] = await tx.insert(quotations).values({ ...input, buyerId: buyer.id, sellerId: product.sellerId }).returning({ id: quotations.id });
          const conversationId = await openSupportThread(tx, { buyerId: buyer.id, sellerId: product.sellerId, productId: product.id, quotationId: quotation.id, subject: `Quotation request: ${product.name}`, body: input.buyerNote || `I would like a quotation for ${input.requestedQty} ${product.unit} of ${product.name}.` });
          return { success: true, conversationId };
        });
      }),
    respond: protectedProcedure
      .input(quotationResponseInputSchema)
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller"]);
        const db = await dbOrThrow();
        return db.transaction(async tx => {
          const [current] = await tx.select().from(quotations).where(eq(quotations.id, input.quotationId)).limit(1);
          if (!current || current.sellerId !== seller.id || !isQuotationOpen(current.status)) {
            throw new TRPCError({ code: "NOT_FOUND", message: "That quotation cannot be updated." });
          }
          const { quotationId, ...values } = input;
          const result = await tx.update(quotations).set({ ...values, respondedAt: new Date() }).where(and(eq(quotations.id, quotationId), eq(quotations.sellerId, seller.id), eq(quotations.status, "requested"))).returning({ id: quotations.id });
          if (!result.length) throw new TRPCError({ code: "NOT_FOUND", message: "That quotation cannot be updated." });
          await createNotification(tx, {
            userId: current.buyerId,
            type: "quotation_updated",
            title: "Seller responded to your quotation",
            content: "Open your activity workspace to review the quoted price and decide.",
            link: "/activity",
            relatedEntityId: current.id,
            relatedEntityType: "quotation",
          });
          return { success: true };
        });
      }),
    decide: protectedProcedure
      .input(z.object({ quotationId: z.number().int().positive(), status: z.enum(["accepted", "declined"]) }))
      .mutation(async ({ ctx, input }) => {
        const buyer = requireOperationalRole(ctx.user, ["buyer", "seller"]);
        const db = await dbOrThrow();
        return db.transaction(async tx => {
          const [quotation] = await tx.select().from(quotations).where(eq(quotations.id, input.quotationId)).limit(1);
          if (!quotation || !canDecideBuyerQuotation(buyer.id, quotation)) {
            throw new TRPCError({ code: "NOT_FOUND", message: "That quotation is unavailable or no longer awaiting your decision." });
          }
          const result = await tx.update(quotations)
            .set({ status: input.status })
            .where(and(
              eq(quotations.id, input.quotationId),
              eq(quotations.buyerId, buyer.id),
              eq(quotations.status, "responded"),
            ))
            .returning({ id: quotations.id });
          if (!result.length) {
            throw new TRPCError({ code: "NOT_FOUND", message: "That quotation is unavailable or no longer awaiting your decision." });
          }
          await createNotification(tx, {
            userId: quotation.sellerId,
            type: "quotation_updated",
            title: input.status === "accepted" ? "Quotation accepted" : "Quotation declined",
            content: input.status === "accepted"
              ? "A buyer accepted your quotation. They can place the order next."
              : "A buyer declined your quotation.",
            link: "/dashboard",
            relatedEntityId: quotation.id,
            relatedEntityType: "quotation",
          });
          return { success: true };
        });
      }),
  }),

  officerApplications: officerApplicationsRouter,
  orders: router({
    buyerMine: orderArchiveProcedures.buyerMine,
    buyerMineCounts: orderArchiveProcedures.buyerMineCounts,
    updateArchive: orderArchiveProcedures.updateArchive,
    sellerMine: orderArchiveProcedures.sellerMine,
    sellerMineCounts: orderArchiveProcedures.sellerMineCounts,
    sellerUpdateArchive: orderArchiveProcedures.sellerUpdateArchive,
    create: protectedProcedure
      .input(z.object({
        items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().positive() })).min(1),
        buyerNote: z.string().max(600).optional(),
        quotationId: z.number().int().positive().optional(),
        paymentMethod: z.enum(["cash_pickup", "cash_delivery", "online", "gcash"]).default("cash_pickup"),
        fulfillmentMethod: z.enum(["pickup", "delivery"]).optional(),
        paymentOptionId: z.number().int().positive().optional(),
        receiptUploadIntent: z.string().min(1).max(2048).optional(),
        deliveryDetails: z.object({
          recipientName: z.string().trim().min(2).max(120),
          contactNumber: z.string().trim().min(7).max(40),
          province: z.string().trim().min(2).max(80),
          city: z.string().trim().min(2).max(80),
          barangay: z.string().trim().min(2).max(80),
          streetAddress: z.string().trim().min(5).max(300),
          instructions: z.string().trim().max(300).optional(),
        }).strict().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const buyer = requireOperationalRole(ctx.user, ["buyer", "seller"]);
        const paymentMethod = normalizePaymentMethodInput(input.paymentMethod);
        if (!paymentMethod) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a valid payment method." });
        }
        // Online payment is fulfillment-agnostic, so the buyer must pick
        // pickup or delivery explicitly instead of silently defaulting.
        if (isOnlinePaymentMethod(paymentMethod) && !input.fulfillmentMethod) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Choose pickup or delivery for this order." });
        }
        if ((paymentMethod === "cash_delivery" || input.fulfillmentMethod === "delivery") && !input.deliveryDetails) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A complete delivery address is required for delivery orders." });
        }
        const db = await dbOrThrow();
        const productIds = Array.from(new Set(input.items.map(item => item.productId)));
        const createdOrder = await db.transaction(async tx => {
          await tx.execute(sql`select set_config('agricoop.order_create_scope', 'on', true)`);
          const currentProducts = Array.from(await tx.execute(sql`
            select * from agricoop_app.order_create_lock_products(array[${sql.join(productIds.map(id => sql`${id}`), sql`,`)}]::integer[])
          `)) as unknown as Array<typeof products.$inferSelect>;
          if (currentProducts.length !== productIds.length) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "A product in this order could not be found." });
          }
          const reservedByProduct = await getOpenOrderReservationQuantities(tx, productIds);
          const availableProducts = currentProducts.map(product => ({
            ...product,
            stockQty: availableStockAfterReservations(
              product.stockQty,
              reservedByProduct.get(product.id) ?? 0,
            ),
          }));
          const sellerIds = Array.from(new Set(availableProducts.map(product => product.sellerId).filter((id): id is number => id !== null)));
          const currentSellers = sellerIds.length === 0 ? [] : Array.from(await tx.execute(sql`
            select * from agricoop_app.order_create_lock_sellers(array[${sql.join(sellerIds.map(id => sql`${id}`), sql`,`)}]::integer[])
          `)) as unknown as Array<Pick<typeof users.$inferSelect, "id" | "approvalStatus" | "deletedAt">>;
          const sellersById = new Map(currentSellers.map(seller => [seller.id, seller]));
          for (const product of availableProducts) {
            const seller = product.sellerId === null ? undefined : sellersById.get(product.sellerId);
            const purchaseBlockReason = productPurchaseBlockReason({
              name: product.name,
              unit: product.unit,
              status: product.status,
              verificationStatus: product.verificationStatus,
              visibility: product.visibility,
              deletedAt: product.deletedAt,
              stockQty: product.stockQty,
              minOrderQty: product.minOrderQty,
              allowsPickup: product.allowsPickup,
              allowsDelivery: product.allowsDelivery,
            }, {
              approvalStatus: seller?.approvalStatus ?? "suspended",
              deletedAt: seller?.deletedAt,
            });
            if (purchaseBlockReason) {
              throw new TRPCError({ code: "BAD_REQUEST", message: purchaseBlockReason });
            }
          }
          let currentOrder;
          try {
            currentOrder = prepareOrder(availableProducts, input.items);
            assertNotSelfTransaction(buyer.id, currentOrder.sellerId);
          } catch (error) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to prepare this order." });
          }
          const availability = await getSystemPaymentAvailability(tx);
          const listingFlags = currentProducts.map(product => ({
            allowsPickup: product.allowsPickup ?? true,
            allowsDelivery: product.allowsDelivery ?? true,
            acceptsOnlinePayment: false,
            onlinePaymentEnabled: product.onlinePaymentEnabled !== false,
          }));
          let checkoutReceipt: ReturnType<typeof verifyCheckoutReceiptUploadIntent> = null;
          let checkoutReceiptBytes: Buffer | null = null;
          const allowedMethods = methodsForListings(listingFlags, availability);
          if (!allowedMethods.includes(paymentMethod)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `This order cannot use ${formatEnumLabel(paymentMethod)}. Check pickup, delivery, and the cooperative payment settings.`,
            });
          }

          const fulfillmentMethod: FulfillmentMethod | null = input.fulfillmentMethod
            ?? defaultFulfillmentForPayment(paymentMethod, {
              allowsPickup: listingFlags.every(f => f.allowsPickup),
              allowsDelivery: listingFlags.every(f => f.allowsDelivery),
              acceptsOnlinePayment: listingFlags.every(f => f.acceptsOnlinePayment),
            });
          const allowedFulfillment = fulfillmentOptionsForListings(listingFlags);
          if (!fulfillmentMethod || !allowedFulfillment.includes(fulfillmentMethod)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Choose a fulfillment option (pickup or delivery) that every item in this order supports.",
            });
          }
          if (paymentMethod === "cash_pickup" && fulfillmentMethod !== "pickup") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Cash on Pickup requires pickup fulfillment." });
          }
          if (paymentMethod === "cash_delivery" && fulfillmentMethod !== "delivery") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Cash on Delivery requires delivery fulfillment." });
          }

          let selectedPaymentOptionId: number | undefined;
          if (isOnlinePaymentMethod(paymentMethod) && input.paymentOptionId !== undefined) {
            const optionRows = Array.from(await tx.execute(sql`
              select * from agricoop_app.order_create_lock_payment_option(${input.paymentOptionId}::integer)
            `)) as unknown as Array<{
              id: number;
              cooperativeId: number | null;
              paymentMethod: string;
              isActive: boolean;
            }>;
            const selectedOption = optionRows[0];
            if (selectedOption && (selectedOption.paymentMethod === "gcash" || selectedOption.paymentMethod === "online")
              && isGcashCheckoutOption({ ...selectedOption, paymentMethod: "gcash" }, currentOrder.cooperativeId)) {
              selectedPaymentOptionId = selectedOption.id;
            }
          }
          try {
            assertPaymentOptionSelection(
              paymentMethod,
              input.paymentOptionId,
              selectedPaymentOptionId !== undefined || (isOnlinePaymentMethod(paymentMethod) && availability.onlineAccountReady),
            );
          } catch (error) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: error instanceof Error ? error.message : "The selected payment option is unavailable.",
            });
          }

          if (isOnlinePaymentMethod(paymentMethod)) {
            if (!availability.onlineEnabled || !availability.onlineAccountReady) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "Online payment is not available right now." });
            }
            if (!input.receiptUploadIntent) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "Upload your payment receipt before placing an online payment order." });
            }
            checkoutReceipt = verifyCheckoutReceiptUploadIntent(
              input.receiptUploadIntent,
              buyer.id,
              currentOrder.sellerId,
            );
            if (!checkoutReceipt) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "The checkout receipt authorization is invalid or expired. Upload the receipt again." });
            }
            try {
              checkoutReceiptBytes = await storageDownloadPrivateProof(checkoutReceipt.storagePath);
            } catch {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "The payment receipt could not be found in storage. Upload it again, then place the order.",
              });
            }
            if (checkoutReceiptBytes.length !== checkoutReceipt.fileSizeBytes
              || checkoutReceiptBytes.length > PAYMENT_PROOF_MAX_BYTES) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded receipt size does not match its authorization." });
            }
            if (!matchesImageContentTypeSignature(checkoutReceiptBytes, checkoutReceipt.mimeType)) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded receipt does not match its image format." });
            }
          }

          let currentQuotedPrice: number | undefined;
          if (input.quotationId !== undefined) {
            const quotationRows = Array.from(await tx.execute(sql`
              select * from agricoop_app.order_create_lock_quotation(${input.quotationId}::integer)
            `)) as unknown as Array<typeof quotations.$inferSelect>;
            const [quotation] = quotationRows;
            if (!quotation || quotation.sellerId !== currentOrder.sellerId || !canPlaceAcceptedQuotationOrder(buyer.id, quotation, currentOrder.items)) {
              throw new TRPCError({ code: "FORBIDDEN", message: "Only your accepted quotation and its quoted quantity can be used for this order." });
            }
            if (quotation.quotedPriceCents === null) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "An accepted quotation can only be ordered for its product and quoted quantity." });
            }
            currentQuotedPrice = quotation.quotedPriceCents;
          }

          const pricing = priceOrderItems(currentOrder.items, currentOrder.productMap, currentQuotedPrice);
          const initialPaymentStatus = isOnlinePaymentMethod(paymentMethod) ? "awaiting_verification" : "pending";
          const [newOrder] = await tx.insert(orders).values({
            buyerId: buyer.id,
            sellerId: currentOrder.sellerId,
            cooperativeId: currentOrder.cooperativeId,
            orderType: currentOrder.orderType,
            totalCents: pricing.totalCents,
            buyerNote: input.buyerNote,
            paymentMethod,
            fulfillmentMethod,
            paymentStatus: initialPaymentStatus,
            deliveryDetails: fulfillmentMethod === "delivery" ? input.deliveryDetails : null,
          }).returning({ id: orders.id });
          await tx.insert(transactions).values({
            orderId: newOrder.id,
            buyerId: buyer.id,
            sellerId: currentOrder.sellerId,
            amountCents: pricing.totalCents,
            paymentMethod,
            paymentOptionId: selectedPaymentOptionId ?? null,
            status: "payment_coordinated",
          });
          await ensureOrderPaymentRecord(tx, {
            id: newOrder.id,
            buyerId: buyer.id,
            sellerId: currentOrder.sellerId,
            cooperativeId: currentOrder.cooperativeId,
            totalCents: pricing.totalCents,
            paymentMethod,
            paymentStatus: initialPaymentStatus,
            paymentOptionId: selectedPaymentOptionId ?? null,
          }, buyer.id);
          await tx.insert(orderItems).values(pricing.lines.map(item => ({
            orderId: newOrder.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            fulfillmentType: (currentOrder.productMap.get(item.productId) as { fulfillmentType?: string | null } | undefined)?.fulfillmentType ?? "on_hand",
          })));
          await tx.insert(orderEvents).values({
            orderId: newOrder.id,
            actorUserId: buyer.id,
            action: "stock_reserved",
            toStatus: "submitted",
            note: "Stock reserved against open-order availability; on-hand quantity remains unchanged until fulfillment.",
          });
          await tx.insert(orderHistory).values([
            {
              orderId: newOrder.id,
              actorUserId: buyer.id,
              eventType: "order_status",
              fromValue: null,
              toValue: "submitted",
              note: "Order placed.",
            },
            {
              orderId: newOrder.id,
              actorUserId: buyer.id,
              eventType: "payment_status",
              fromValue: null,
              toValue: initialPaymentStatus,
              note: isOnlinePaymentMethod(paymentMethod) ? "Receipt uploaded; awaiting officer verification." : "Awaiting cash payment.",
            },
          ]);

          if (isOnlinePaymentMethod(paymentMethod) && checkoutReceipt && checkoutReceiptBytes) {
            const receiptBytes = checkoutReceiptBytes;
            const fileName = sanitizePaymentProofFileName(checkoutReceipt.originalFileName);
            const canonicalPath = `${PAYMENT_PROOF_BUCKET}/${buyer.id}/${newOrder.id}/${crypto.randomUUID()}-${fileName}`;
            const { error: copyError } = await supabaseAdmin.storage
              .from(PAYMENT_PROOF_BUCKET)
              .upload(canonicalPath, receiptBytes, {
                contentType: checkoutReceipt.mimeType,
                upsert: false,
              });
            if (copyError) {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Could not attach the payment receipt to this order.",
              });
            }

            const [transaction] = await tx.select({ id: transactions.id })
              .from(transactions)
              .where(eq(transactions.orderId, newOrder.id))
              .limit(1);
            await tx.insert(paymentProofs).values({
              orderId: newOrder.id,
              transactionId: transaction?.id ?? null,
              uploadedBy: buyer.id,
              storagePath: canonicalPath,
              originalFileName: fileName,
              mimeType: checkoutReceipt.mimeType,
              fileSizeBytes: receiptBytes.length,
              verificationStatus: "pending",
            });
            await tx.update(transactions)
              .set({ status: "pending" })
              .where(eq(transactions.orderId, newOrder.id));
            await notifyApprovedOfficers(tx, {
              title: "Payment receipt uploaded",
              content: `Order #${newOrder.id} has a receipt awaiting officer verification.`,
              link: `/orders/${newOrder.id}`,
              relatedEntityId: newOrder.id,
            }, currentOrder.cooperativeId);
          } else {
            await notifyApprovedOfficers(tx, {
              title: "Cash order awaiting confirmation",
              content: `Order #${newOrder.id} is awaiting payment confirmation.`,
              link: `/orders/${newOrder.id}`,
              relatedEntityId: newOrder.id,
            }, currentOrder.cooperativeId);
          }
          await createNotification(tx, {
            userId: currentOrder.sellerId,
            type: "order_status_updated",
            title: "New order for fulfillment",
            content: `Order #${newOrder.id} was placed and is waiting for fulfillment. Payment review is handled by a cooperative officer.`,
            link: `/orders/${newOrder.id}`,
            relatedEntityId: newOrder.id,
            relatedEntityType: "order",
          });

          const conversationId = await openSupportThread(tx, {
            buyerId: buyer.id,
            sellerId: currentOrder.sellerId,
            orderId: newOrder.id,
            quotationId: input.quotationId,
            subject: `Order #${newOrder.id} support`,
            body: "Please confirm availability and arrange the selected payment handover.",
          });
          return { orderId: newOrder.id, conversationId };
        });
        return { success: true, ...createdOrder };
      }),
    byId: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["buyer", "seller", "admin", "superadmin"]);
        const detail = await getOrderDetail(input.id);
        if (!detail || !canViewOrder(actor, detail.order)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "This order could not be found." });
        }
        if (actor.role === "admin" && !canAccessOrderForCooperative(actor, detail.order.cooperativeId)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "This order could not be found." });
        }
        const maySeeProof = actor.id === detail.order.buyerId || actor.role === "admin" || actor.role === "superadmin";
        let proofSignedUrl: string | null = null;
        if (maySeeProof && detail.proof?.storagePath && isPaymentProofStorageKey(detail.proof.storagePath, detail.order.buyerId, detail.order.id)) {
          try {
            proofSignedUrl = await storageGetSignedUrl(detail.proof.storagePath, {
              bucket: PAYMENT_PROOF_BUCKET,
              public: false,
              expiresIn: 300,
            });
          } catch {
            proofSignedUrl = null;
          }
        }
        return {
          ...detail,
          proof: detail.proof
            ? {
              ...detail.proof,
              storagePath: maySeeProof ? detail.proof.storagePath : null,
              signedUrl: proofSignedUrl,
              evidenceUrl: proofSignedUrl,
            }
            : null,
        };
      }),
    history: protectedProcedure
      .input(z.object({ orderId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["buyer", "seller", "admin", "superadmin"]);
        const db = await dbOrThrow();
        const [order] = await db.select({
          id: orders.id,
          buyerId: orders.buyerId,
          sellerId: orders.sellerId,
          cooperativeId: orders.cooperativeId,
        }).from(orders).where(eq(orders.id, input.orderId)).limit(1);
        if (!order || !canViewOrder(actor, order)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "This order could not be found." });
        }
        if (actor.role === "admin" && !canAccessOrderForCooperative(actor, order.cooperativeId)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "This order could not be found." });
        }
        return db.select({
          id: orderHistory.id,
          orderId: orderHistory.orderId,
          eventType: orderHistory.eventType,
          fromValue: orderHistory.fromValue,
          toValue: orderHistory.toValue,
          note: orderHistory.note,
          createdAt: orderHistory.createdAt,
          actorName: users.name,
        }).from(orderHistory)
          .leftJoin(users, eq(orderHistory.actorUserId, users.id))
          .where(eq(orderHistory.orderId, input.orderId))
          .orderBy(asc(orderHistory.createdAt), asc(orderHistory.id));
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

            if (orderRow.status === "submitted" && input.status === "confirmed") {
              if (actor.role === "seller") {
                throw new TRPCError({ code: "FORBIDDEN", message: "Orders must be reviewed and approved by a cooperative officer before the seller can confirm fulfillment." });
              }
              const approvalItems = await tx.select({
                productId: orderItems.productId,
                quantity: orderItems.quantity,
                fulfillmentType: orderItems.fulfillmentType,
                stockQty: products.stockQty,
                productFulfillmentType: products.fulfillmentType,
                name: products.name,
              }).from(orderItems)
                .innerJoin(products, eq(orderItems.productId, products.id))
                .where(eq(orderItems.orderId, input.orderId));
              const approvalProductIds = Array.from(new Set(approvalItems.map(item => item.productId)));
              const reservedByProduct = approvalProductIds.length
                ? await getOpenOrderReservationQuantities(tx, approvalProductIds)
                : new Map<number, number>();
              const ownReserved = new Map<number, number>();
              for (const item of approvalItems) {
                ownReserved.set(item.productId, (ownReserved.get(item.productId) ?? 0) + item.quantity);
              }
              const reservedByOthers = new Map<number, number>();
              reservedByProduct.forEach((reserved, productId) => {
                reservedByOthers.set(productId, Math.max(0, reserved - (ownReserved.get(productId) ?? 0)));
              });
              const approvalIssue = evaluateOfficerApproval({
                items: approvalItems.map(item => ({
                  productId: item.productId,
                  quantity: item.quantity,
                  fulfillmentType: item.fulfillmentType ?? item.productFulfillmentType,
                  stockQty: item.stockQty,
                  name: item.name,
                })),
                reservedByOthers,
                sellerConfirmationStatus: orderRow.sellerConfirmationStatus,
              });
              if (approvalIssue) {
                throw new TRPCError({ code: "PRECONDITION_FAILED", message: approvalIssue });
              }
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

              const [transactionRow] = await tx.select().from(transactions)
                .where(eq(transactions.orderId, input.orderId))
                .for("update");
              try {
                assertOrderPaidBeforeComplete(orderRow.paymentStatus);
              } catch (error) {
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message: error instanceof Error ? error.message : "Payment must be verified before the order can be completed.",
                });
              }
              if (!transactionRow || transactionRow.status !== "paid") {
                throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Payment must be verified before the order can be completed." });
              }
              if (transactionRow.amountCents !== completion.totalCents) {
                throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The delivered total differs from the verified payment amount." });
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
                    .where(and(eq(products.id, item.productId), gte(products.stockQty, item.quantity)))
                    .returning({ id: products.id });
                  return result.length > 0;
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
              await tx.insert(orderEvents).values({
                orderId: input.orderId,
                actorUserId: actor.id,
                action: "stock_reservation_released",
                fromStatus: previousStatus,
                toStatus: "completed",
                note: "Open-order stock reservation was consumed by completion; delivered quantities were deducted from on-hand stock.",
              });
              const transactionUpdate = await tx.update(transactions)
                .set({
                  paymentReferenceNote: input.paymentReferenceNote ?? transactionRow.paymentReferenceNote,
                  completedAt,
                })
                .where(and(eq(transactions.id, transactionRow.id), eq(transactions.status, "paid")))
                .returning({ id: transactions.id });
              if (transactionUpdate.length !== 1) {
                throw new TRPCError({ code: "CONFLICT", message: "The order transaction changed while completing the order." });
              }
              await tx.insert(orderEvents).values({
                orderId: input.orderId,
                actorUserId: actor.id,
                action: "status_change",
                fromStatus: previousStatus,
                toStatus: input.status,
                note: input.paymentReferenceNote ?? null,
              });
              await tx.insert(orderHistory).values({
                orderId: input.orderId,
                actorUserId: actor.id,
                eventType: "order_status",
                fromValue: previousStatus,
                toValue: input.status,
                note: input.paymentReferenceNote ?? null,
              });
            } else {
              if (input.status === "cancelled") {
                const [transactionRow] = await tx.select().from(transactions)
                  .where(eq(transactions.orderId, input.orderId))
                  .for("update");
                if (!transactionRow
                  || transactionRow.orderId !== orderRow.id
                  || transactionRow.buyerId !== orderRow.buyerId
                  || transactionRow.sellerId !== orderRow.sellerId
                  || transactionRow.amountCents !== orderRow.totalCents
                  || transactionRow.paymentMethod !== orderRow.paymentMethod) {
                  throw new TRPCError({ code: "CONFLICT", message: "The order transaction is inconsistent and cannot be cancelled." });
                }
                const paymentStatus = orderRow.paymentStatus === "paid" || orderRow.paymentStatus === "verified"
                  ? "verified"
                  : orderRow.paymentStatus === "F2F-pending-confirmation"
                    ? "pending"
                    : orderRow.paymentStatus;
                if (!canCancelOrderPayment(paymentStatus, orderRow.paymentStatus, transactionRow.status)) {
                  throw new TRPCError({
                    code: "PRECONDITION_FAILED",
                    message: "A verified payment must be fully refunded before its order can be cancelled.",
                  });
                }
                await tx.insert(orderEvents).values({
                  orderId: input.orderId,
                  actorUserId: actor.id,
                  action: "stock_reservation_released",
                  fromStatus: previousStatus,
                  toStatus: "cancelled",
                  note: "Cancellation released the open-order stock reservation; payment and transaction records retain their last valid enum states.",
                });
              }
              await tx.update(orders).set({ status: input.status }).where(eq(orders.id, input.orderId));
              if (input.paymentReferenceNote !== undefined) {
                await tx.update(transactions)
                  .set({ paymentReferenceNote: input.paymentReferenceNote })
                  .where(eq(transactions.orderId, orderRow.id));
              }
              await tx.insert(orderEvents).values({
                orderId: input.orderId,
                actorUserId: actor.id,
                action: "status_change",
                fromStatus: previousStatus,
                toStatus: input.status,
                note: input.paymentReferenceNote ?? null,
              });
              await tx.insert(orderHistory).values({
                orderId: input.orderId,
                actorUserId: actor.id,
                eventType: "order_status",
                fromValue: previousStatus,
                toValue: input.status,
                note: input.paymentReferenceNote ?? null,
              });
            }
            if (orderRow.buyerId !== null) await createNotification(tx, {
              userId: orderRow.buyerId,
              type: "order_status_updated",
              title: `Order #${input.orderId} is now ${formatEnumLabel(input.status)}`,
              content: `Your order status changed from ${formatEnumLabel(previousStatus)} to ${formatEnumLabel(input.status)}.`,
              link: `/orders/${input.orderId}`,
              relatedEntityId: input.orderId,
              relatedEntityType: "order",
            });
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
    requestSellerAvailability: protectedProcedure
      .input(z.object({
        orderId: z.number().int().positive(),
        note: z.string().trim().max(600).optional(),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        return db.transaction(async tx => {
          const [order] = await tx.select().from(orders)
            .where(eq(orders.id, input.orderId))
            .for("update")
            .limit(1);
          if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "This order could not be found." });
          if (!canAccessOrderForCooperative(actor, order.cooperativeId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "This officer can only manage orders in their cooperative." });
          }
          if (order.status !== "submitted" && order.status !== "confirmed") {
            throw new TRPCError({ code: "CONFLICT", message: "Seller availability can only be requested while the order is still open." });
          }
          const note = input.note?.trim() || null;
          await tx.update(orders)
            .set({ sellerConfirmationStatus: "pending" })
            .where(eq(orders.id, order.id));
          await tx.insert(orderEvents).values({
            orderId: order.id,
            actorUserId: actor.id,
            action: "availability_requested",
            fromStatus: order.status,
            note,
          });
          await tx.insert(orderHistory).values({
            orderId: order.id,
            actorUserId: actor.id,
            eventType: "order_status",
            fromValue: order.status,
            toValue: order.status,
            note: `Seller availability confirmation requested.${note ? ` ${note}` : ""}`,
          });
          if (order.sellerId !== null) await createNotification(tx, {
            userId: order.sellerId,
            type: "order_status_updated",
            title: `Availability check for order #${order.id}`,
            content: `A cooperative officer asked you to confirm availability.${note ? ` Note: ${note}` : ""}`,
            link: `/orders/${order.id}`,
            relatedEntityId: order.id,
            relatedEntityType: "order",
          });
          return { success: true };
        });
      }),
    respondAvailability: protectedProcedure
      .input(z.object({
        orderId: z.number().int().positive(),
        response: z.enum(["available", "partially_available", "unavailable", "needs_clarification"]),
        note: z.string().trim().max(600).optional(),
        availableQuantity: z.number().int().min(0).optional(),
      }).strict().superRefine((input, context) => {
        if ((input.response === "partially_available" || input.response === "unavailable" || input.response === "needs_clarification") && !input.note) {
          context.addIssue({ code: "custom", path: ["note"], message: "Explain the availability response so the officer can coordinate with the buyer." });
        }
      }))
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.user, ["seller"]);
        const db = await dbOrThrow();
        return db.transaction(async tx => {
          const [order] = await tx.select().from(orders)
            .where(eq(orders.id, input.orderId))
            .for("update")
            .limit(1);
          if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "This order could not be found." });
          if (order.sellerId !== seller.id) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You can only respond to availability requests for your own orders." });
          }
          if (order.status === "completed" || order.status === "cancelled") {
            throw new TRPCError({ code: "CONFLICT", message: "This order is already closed." });
          }
          const note = input.note?.trim() || null;
          await tx.update(orders)
            .set({ sellerConfirmationStatus: input.response })
            .where(eq(orders.id, order.id));
          const detail = [
            `response=${input.response}`,
            input.availableQuantity !== undefined ? `availableQuantity=${input.availableQuantity}` : null,
            note,
          ].filter(Boolean).join(" | ");
          await tx.insert(orderEvents).values({
            orderId: order.id,
            actorUserId: seller.id,
            action: "availability_response",
            fromStatus: order.status,
            note: detail.slice(0, 2000),
          });
          await tx.insert(orderHistory).values({
            orderId: order.id,
            actorUserId: seller.id,
            eventType: "order_status",
            fromValue: order.status,
            toValue: order.status,
            note: `Seller availability response: ${formatEnumLabel(input.response)}.${note ? ` ${note}` : ""}`,
          });
          const officers = order.cooperativeId === null ? [] : await tx.select({ id: users.id }).from(users).where(and(
            eq(users.role, "admin"),
            eq(users.cooperativeId, order.cooperativeId),
            eq(users.approvalStatus, "approved"),
          ));
          for (const officer of officers) {
            await createNotification(tx, {
              userId: officer.id,
              type: "order_status_updated",
              title: `Seller responded on order #${order.id}`,
              content: `Availability: ${formatEnumLabel(input.response)}.${note ? ` ${note}` : ""}`,
              link: `/orders/${order.id}`,
              relatedEntityId: order.id,
              relatedEntityType: "order",
            });
          }
          return { success: true };
        });
      }),
  }),

  systemPayment: router({
    getAvailability: protectedProcedure.query(async ({ ctx }) => {
      requireOperationalRole(ctx.user, ["buyer", "seller", "admin", "superadmin"]);
      const db = await dbOrThrow();
      return getSystemPaymentAvailability(db);
    }),
    getSettings: protectedProcedure.query(async ({ ctx }) => {
      requireOperationalRole(ctx.user, ["superadmin"]);
      const db = await dbOrThrow();
      return ensureSystemPaymentSettings(db);
    }),
    updateSettings: protectedProcedure
      .input(z.object({
        cashPickupEnabled: z.boolean(),
        cashDeliveryEnabled: z.boolean(),
        onlineEnabled: z.boolean(),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["superadmin"]);
        const db = await dbOrThrow();
        await ensureSystemPaymentSettings(db);
        await db.update(systemPaymentSettings).set({
          cashPickupEnabled: input.cashPickupEnabled,
          cashDeliveryEnabled: input.cashDeliveryEnabled,
          onlineEnabled: input.onlineEnabled,
          updatedAt: new Date(),
          updatedBy: actor.id,
        }).where(eq(systemPaymentSettings.id, 1));
        await recordSystemPaymentAudit(db, {
          actorUserId: actor.id,
          actorRole: actor.role,
          action: "settings_updated",
          details: input,
        });
        return { success: true };
      }),
    listAccounts: protectedProcedure.query(async ({ ctx }) => {
      requireOperationalRole(ctx.user, ["superadmin"]);
      const db = await dbOrThrow();
      const accounts = await db.select().from(systemOnlinePaymentAccounts)
        .orderBy(desc(systemOnlinePaymentAccounts.updatedAt), desc(systemOnlinePaymentAccounts.id));
      return Promise.all(accounts.map(async account => {
        let qrImageUrl: string | null = null;
        if (account.qrImagePath) {
          try {
            qrImageUrl = account.qrImagePath.startsWith("http")
              ? account.qrImagePath
              : await storageGetSignedUrl(account.qrImagePath, {
                bucket: SYSTEM_PAYMENT_QR_BUCKET,
                public: false,
                expiresIn: 300,
              });
          } catch {
            qrImageUrl = null;
          }
        }
        return { ...account, qrImageUrl };
      }));
    }),
    createAccount: protectedProcedure
      .input(z.object({
        label: z.string().trim().min(1).max(150),
        accountName: z.string().trim().min(1).max(150),
        accountNumber: z.string().trim().min(1).max(100),
        instructions: z.string().trim().max(2000).optional(),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["superadmin"]);
        const db = await dbOrThrow();
        const [created] = await db.insert(systemOnlinePaymentAccounts).values({
          label: input.label,
          accountName: input.accountName,
          accountNumber: input.accountNumber,
          instructions: input.instructions?.trim() || null,
          isActive: false,
          createdBy: actor.id,
          updatedBy: actor.id,
        }).returning({ id: systemOnlinePaymentAccounts.id });
        if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The payment account was not created." });
        await recordSystemPaymentAudit(db, {
          actorUserId: actor.id,
          actorRole: actor.role,
          action: "account_created",
          details: { accountId: created.id, label: input.label },
        });
        return { success: true, id: created.id };
      }),
    updateAccount: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        label: z.string().trim().min(1).max(150),
        accountName: z.string().trim().min(1).max(150),
        accountNumber: z.string().trim().min(1).max(100),
        instructions: z.string().trim().max(2000).optional(),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["superadmin"]);
        const db = await dbOrThrow();
        const updated = await db.update(systemOnlinePaymentAccounts).set({
          label: input.label,
          accountName: input.accountName,
          accountNumber: input.accountNumber,
          instructions: input.instructions?.trim() || null,
          updatedAt: new Date(),
          updatedBy: actor.id,
        }).where(and(
          eq(systemOnlinePaymentAccounts.id, input.id),
          isNull(systemOnlinePaymentAccounts.archivedAt),
        )).returning({ id: systemOnlinePaymentAccounts.id });
        if (!updated.length) throw new TRPCError({ code: "NOT_FOUND", message: "That payment account is not available." });
        await recordSystemPaymentAudit(db, {
          actorUserId: actor.id,
          actorRole: actor.role,
          action: "account_updated",
          details: { accountId: input.id, label: input.label },
        });
        return { success: true };
      }),
    activateAccount: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["superadmin"]);
        const db = await dbOrThrow();
        await db.transaction(async tx => {
          const [account] = await tx.select({
            id: systemOnlinePaymentAccounts.id,
            archivedAt: systemOnlinePaymentAccounts.archivedAt,
          }).from(systemOnlinePaymentAccounts)
            .where(eq(systemOnlinePaymentAccounts.id, input.id))
            .limit(1);
          if (!account || account.archivedAt) {
            throw new TRPCError({ code: "NOT_FOUND", message: "That payment account is not available." });
          }
          await tx.update(systemOnlinePaymentAccounts).set({
            isActive: false,
            updatedAt: new Date(),
            updatedBy: actor.id,
          }).where(eq(systemOnlinePaymentAccounts.isActive, true));
          const activated = await tx.update(systemOnlinePaymentAccounts).set({
            isActive: true,
            updatedAt: new Date(),
            updatedBy: actor.id,
          }).where(and(
            eq(systemOnlinePaymentAccounts.id, input.id),
            isNull(systemOnlinePaymentAccounts.archivedAt),
          )).returning({ id: systemOnlinePaymentAccounts.id });
          if (!activated.length) throw new TRPCError({ code: "NOT_FOUND", message: "That payment account is not available." });
          await recordSystemPaymentAudit(tx, {
            actorUserId: actor.id,
            actorRole: actor.role,
            action: "account_activated",
            details: { accountId: input.id },
          });
        });
        return { success: true };
      }),
    archiveAccount: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["superadmin"]);
        const db = await dbOrThrow();
        const archived = await db.update(systemOnlinePaymentAccounts).set({
          isActive: false,
          archivedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: actor.id,
        }).where(and(
          eq(systemOnlinePaymentAccounts.id, input.id),
          isNull(systemOnlinePaymentAccounts.archivedAt),
        )).returning({ id: systemOnlinePaymentAccounts.id });
        if (!archived.length) throw new TRPCError({ code: "NOT_FOUND", message: "That payment account is not available." });
        await recordSystemPaymentAudit(db, {
          actorUserId: actor.id,
          actorRole: actor.role,
          action: "account_archived",
          details: { accountId: input.id },
        });
        return { success: true };
      }),
    uploadQr: protectedProcedure
      .input(z.object({
        accountId: z.number().int().positive(),
        fileName: z.string().min(1).max(255),
        contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        base64: z.string().min(1).max(Math.ceil(PAYMENT_PROOF_MAX_BYTES / 3) * 4),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["superadmin"]);
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The selected QR image is invalid." });
        }
        const bytes = Buffer.from(input.base64, "base64");
        if (bytes.length < 1 || bytes.length > PAYMENT_PROOF_MAX_BYTES) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "QR images must be 5 MB or less." });
        }
        if (!matchesImageContentTypeSignature(bytes, input.contentType)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Use a JPEG, PNG, or WebP image for the QR code." });
        }
        const db = await dbOrThrow();
        const [account] = await db.select({ id: systemOnlinePaymentAccounts.id })
          .from(systemOnlinePaymentAccounts)
          .where(and(
            eq(systemOnlinePaymentAccounts.id, input.accountId),
            isNull(systemOnlinePaymentAccounts.archivedAt),
          ))
          .limit(1);
        if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "That payment account is not available." });
        const safeName = sanitizePaymentProofFileName(input.fileName);
        const uploaded = await storagePut(
          `${systemPaymentQrPrefix()}${input.accountId}/${Date.now()}-${safeName}`,
          bytes,
          input.contentType,
          { bucket: SYSTEM_PAYMENT_QR_BUCKET, public: false },
        );
        if (!uploaded.key.startsWith(systemPaymentQrPrefix())) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "QR upload path was invalid." });
        }
        await db.update(systemOnlinePaymentAccounts).set({
          qrImagePath: uploaded.key,
          updatedAt: new Date(),
          updatedBy: actor.id,
        }).where(eq(systemOnlinePaymentAccounts.id, input.accountId));
        await recordSystemPaymentAudit(db, {
          actorUserId: actor.id,
          actorRole: actor.role,
          action: "qr_uploaded",
          details: { accountId: input.accountId },
        });
        const url = await storageGetSignedUrl(uploaded.key, {
          bucket: SYSTEM_PAYMENT_QR_BUCKET,
          public: false,
          expiresIn: 300,
        });
        return { success: true, url };
      }),
    getCheckoutOnlineDetails: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user?.role !== "buyer") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Online payment details are not available." });
      }
      requireOperationalRole(ctx.user, ["buyer"]);
      const db = await dbOrThrow();
      const availability = await getSystemPaymentAvailability(db);
      if (!availability.onlineEnabled || !availability.onlineAccountReady) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Online payment is not available." });
      }
      const account = await getActiveOnlineAccount(db);
      if (!account?.qrImagePath) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Online payment is not available." });
      }
      let qrImageUrl: string;
      try {
        qrImageUrl = account.qrImagePath.startsWith("http")
          ? account.qrImagePath
          : await storageGetSignedUrl(account.qrImagePath, {
            bucket: SYSTEM_PAYMENT_QR_BUCKET,
            public: false,
            expiresIn: 300,
          });
      } catch {
        throw new TRPCError({ code: "NOT_FOUND", message: "Online payment is not available." });
      }
      return {
        qrImageUrl,
        accountName: account.accountName,
        accountNumber: account.accountNumber,
        label: account.label,
        instructions: account.instructions,
      };
    }),
  }),

  payments: router({
    mine: protectedProcedure.query(async ({ ctx }) => {
      const actor = requireOperationalRole(ctx.user, ["buyer", "seller", "admin", "superadmin"]);
      const db = await dbOrThrow();
      if (actor.role === "admin" && actor.cooperativeId === null) return [];
      const scope = actor.role === "buyer"
        ? eq(orders.buyerId, actor.id)
        : actor.role === "seller"
          ? eq(orders.sellerId, actor.id)
          : actor.role === "admin"
            ? eq(orders.cooperativeId, actor.cooperativeId!)
            : undefined;
      const records = await db.select({ transaction: transactions, order: orders })
        .from(transactions)
        .innerJoin(orders, eq(transactions.orderId, orders.id))
        .where(scope);
      if (!records.length) return [];
      const orderIds = records.map(record => record.order.id);
      const proofs = await db.select({
        id: paymentProofs.id,
        orderId: paymentProofs.orderId,
        verificationStatus: paymentProofs.verificationStatus,
        reviewNote: paymentProofs.reviewNote,
        reviewedAt: paymentProofs.reviewedAt,
        createdAt: paymentProofs.createdAt,
      }).from(paymentProofs)
        .where(inArray(paymentProofs.orderId, orderIds))
        .orderBy(desc(paymentProofs.createdAt), desc(paymentProofs.id));
      const latestProofByOrder = new Map<number, typeof proofs[number]>();
      for (const proof of proofs) {
        if (!latestProofByOrder.has(proof.orderId)) latestProofByOrder.set(proof.orderId, proof);
      }
      return records.map(({ transaction, order }) => {
        const proof = latestProofByOrder.get(order.id);
        const status = order.status === "cancelled"
          ? "cancelled"
          : proof?.verificationStatus === "pending"
          ? "awaiting_verification"
          : proof?.verificationStatus === "verified"
            ? "verified"
            : proof?.verificationStatus === "rejected"
              ? "failed"
              : order.paymentStatus;
        return {
          ...transaction,
          status,
          orderStatus: order.status,
          paymentStatus: order.paymentStatus,
          proofStatus: proof?.verificationStatus ?? null,
          reviewNote: proof?.reviewNote ?? null,
          proofReviewedAt: proof?.reviewedAt ?? null,
        };
      });
    }),
    refundQueue: protectedProcedure.query(async ({ ctx }) => {
      const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
      const db = await dbOrThrow();
      const observed = await db.select().from(payments)
        .where(inArray(payments.status, ["verified", "refunded"]))
        .orderBy(desc(payments.createdAt));
      const scoped = observed.filter(payment => canManageRefundRecord(actor, payment));
      if (!scoped.length) return [];
      const events = await db.select().from(paymentEvents)
        .where(inArray(paymentEvents.paymentId, scoped.map(payment => payment.id)))
        .orderBy(asc(paymentEvents.id));
      return scoped.map(payment => {
        try {
          return {
            payment,
            refunds: parseRefundRecords(events.filter(event => event.paymentId === payment.id)),
          };
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Refund history for payment ${payment.id} is inconsistent and requires review.`,
          });
        }
      });
    }),
    reviewQueue: protectedProcedure.query(async ({ ctx }) => {
      const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
      const db = await dbOrThrow();
      if (actor.role === "admin" && actor.cooperativeId === null) {
        return { proofs: [], cashAwaitingReceived: [] };
      }
      const scope = actor.role === "admin"
        ? and(
          eq(paymentProofs.verificationStatus, "pending"),
          eq(orders.cooperativeId, actor.cooperativeId!),
          inArray(orders.paymentMethod, ["gcash", "online"]),
          inArray(orders.status, ["submitted", "confirmed", "ready"]),
          inArray(orders.paymentStatus, ["pending", "awaiting_verification", "failed"]),
        )
        : and(
          eq(paymentProofs.verificationStatus, "pending"),
          inArray(orders.paymentMethod, ["gcash", "online"]),
          inArray(orders.status, ["submitted", "confirmed", "ready"]),
          inArray(orders.paymentStatus, ["pending", "awaiting_verification", "failed"]),
        );
      const pending = await db.select({ proof: paymentProofs, order: orders })
        .from(paymentProofs)
        .innerJoin(orders, eq(paymentProofs.orderId, orders.id))
        .where(scope)
        .orderBy(desc(paymentProofs.createdAt), desc(paymentProofs.id));
      const authorized = pending.filter(({ order }) => canReviewPaymentProof(actor, order));
      const proofs = await Promise.all(authorized.map(async ({ proof, order }) => {
        const [transaction] = await db.select().from(transactions)
          .where(eq(transactions.orderId, order.id))
          .limit(1);
        let evidenceUrl: string | null = null;
        let evidenceUnavailable = !isPaymentProofStorageKey(proof.storagePath, order.buyerId, order.id);
        if (!evidenceUnavailable) {
          try {
            evidenceUrl = await storageGetSignedUrl(
              proof.storagePath,
              { bucket: PAYMENT_PROOF_BUCKET, public: false, expiresIn: 300 },
            );
          } catch {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Payment evidence could not be opened. Verify the private Storage bucket configuration.",
            });
          }
        }
        return { proof, order, transaction: transaction ?? null, evidenceUrl, evidenceUnavailable };
      }));
      const cashScope = actor.role === "admin"
        ? and(
          eq(orders.cooperativeId, actor.cooperativeId!),
          inArray(orders.paymentMethod, ["cash_pickup", "cash_delivery"]),
          eq(orders.status, "ready"),
          inArray(orders.paymentStatus, ["pending", "F2F-pending-confirmation"]),
        )
        : and(
          inArray(orders.paymentMethod, ["cash_pickup", "cash_delivery"]),
          eq(orders.status, "ready"),
          inArray(orders.paymentStatus, ["pending", "F2F-pending-confirmation"]),
        );
      const cashRows = await db.select({
        id: orders.id,
        buyerId: orders.buyerId,
        sellerId: orders.sellerId,
        cooperativeId: orders.cooperativeId,
        totalCents: orders.totalCents,
        paymentMethod: orders.paymentMethod,
        paymentStatus: orders.paymentStatus,
        fulfillmentMethod: orders.fulfillmentMethod,
        status: orders.status,
      }).from(orders).where(cashScope).orderBy(desc(orders.createdAt));
      const cashAwaitingReceived = cashRows.filter(order => canManageCashReceipt(actor, order));
      return { proofs, cashAwaitingReceived };
    }),
    uploadProof: protectedProcedure.input(z.object({
      orderId: z.number().int().positive(),
      fileName: z.string().min(1).max(255),
      contentType: z.enum(PAYMENT_PROOF_CONTENT_TYPES),
    fileSizeBytes: z.number().int().min(1).max(PAYMENT_PROOF_MAX_BYTES),
    })).mutation(async ({ ctx, input }) => {
      const actor = requireOperationalRole(ctx.user, ["buyer", "seller"]);
      const db = await dbOrThrow();
      const fileName = sanitizePaymentProofFileName(input.fileName);
    const upload = await db.transaction(async tx => {
      const [order] = await tx.select().from(orders)
        .where(and(eq(orders.id, input.orderId), eq(orders.buyerId, actor.id)))
        .for("update");
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
      const [latestProof] = await tx.select({
        id: paymentProofs.id,
        verificationStatus: paymentProofs.verificationStatus,
      }).from(paymentProofs)
        .where(eq(paymentProofs.orderId, order.id))
        .orderBy(desc(paymentProofs.createdAt), desc(paymentProofs.id))
        .limit(1)
        .for("update");
      try {
        assertOrderCanAcceptPaymentProof(order, latestProof);
      } catch (error) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: error instanceof Error ? error.message : "This order cannot accept a payment proof.",
        });
      }
      const [transaction] = await tx.select().from(transactions)
        .where(eq(transactions.orderId, order.id))
        .for("update");
      if (!transaction) {
        throw new TRPCError({ code: "CONFLICT", message: "The order has no existing transaction to associate with this payment proof." });
      }
      if (
        transaction.buyerId !== order.buyerId
        || transaction.sellerId !== order.sellerId
        || transaction.amountCents !== order.totalCents
        || transaction.paymentMethod !== order.paymentMethod
      ) {
        throw new TRPCError({ code: "CONFLICT", message: "The order transaction does not match this order." });
      }
      if (!["recorded", "payment_coordinated", "pending", "failed"].includes(transaction.status)) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The order transaction cannot accept another payment proof." });
      }
      const storagePath = `${PAYMENT_PROOF_BUCKET}/${actor.id}/${order.id}/${crypto.randomUUID()}-${fileName}`;
      const signedUpload = await storageCreateSignedUploadUrl(storagePath);
      if (signedUpload.path !== storagePath || !isPaymentProofStorageKey(signedUpload.path, actor.id, order.id)) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Private Storage returned an invalid upload path." });
      }
      return {
        storagePath,
        uploadToken: signedUpload.token,
        uploadIntent: createPaymentProofUploadIntent({
          buyerId: actor.id,
          orderId: order.id,
          storagePath,
          originalFileName: fileName,
          mimeType: input.contentType,
          fileSizeBytes: input.fileSizeBytes,
        }),
      };
    });
    return { success: true, ...upload };
    }),
    finalizeProofUpload: protectedProcedure.input(z.object({
    orderId: z.number().int().positive(),
    uploadIntent: z.string().min(1).max(2048),
    }).strict()).mutation(async ({ ctx, input }) => {
    const buyer = requireOperationalRole(ctx.user, ["buyer", "seller"]);
    const intent = verifyPaymentProofUploadIntent(input.uploadIntent, buyer.id, input.orderId);
    if (!intent) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The payment upload authorization is invalid or expired." });
    }

    let uploadedKey: string | null = intent.storagePath;
    try {
      const bytes = await storageDownloadPrivateProof(intent.storagePath);
      if (bytes.length !== intent.fileSizeBytes || bytes.length > PAYMENT_PROOF_MAX_BYTES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded payment proof size does not match its authorization." });
      }
      if (!matchesImageContentTypeSignature(bytes, intent.mimeType)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded payment proof does not match its image format." });
      }

      const db = await dbOrThrow();
      const result = await db.transaction(async tx => {
        const [order] = await tx.select().from(orders)
          .where(and(eq(orders.id, input.orderId), eq(orders.buyerId, buyer.id)))
          .for("update");
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
        const [latestProof] = await tx.select({
          id: paymentProofs.id,
          verificationStatus: paymentProofs.verificationStatus,
        }).from(paymentProofs)
          .where(eq(paymentProofs.orderId, order.id))
          .orderBy(desc(paymentProofs.createdAt), desc(paymentProofs.id))
          .limit(1)
          .for("update");
        try {
          assertOrderCanAcceptPaymentProof(order, latestProof);
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error instanceof Error ? error.message : "This order cannot accept a payment proof.",
          });
        }
        const [transaction] = await tx.select().from(transactions)
          .where(eq(transactions.orderId, order.id))
          .for("update");
        if (!transaction) {
          throw new TRPCError({ code: "CONFLICT", message: "The order has no existing transaction to associate with this payment proof." });
        }
        if (
          transaction.buyerId !== order.buyerId
          || transaction.sellerId !== order.sellerId
          || transaction.amountCents !== order.totalCents
          || transaction.paymentMethod !== order.paymentMethod
        ) {
          throw new TRPCError({ code: "CONFLICT", message: "The order transaction does not match this order." });
        }
        if (!["recorded", "payment_coordinated", "pending", "failed"].includes(transaction.status)) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The order transaction cannot accept another payment proof." });
        }

        // The paymentProofs.id identity/sequence generates the primary key.
        const [proof] = await tx.insert(paymentProofs).values({
          orderId: order.id,
          transactionId: transaction.id,
          uploadedBy: buyer.id,
          storagePath: intent.storagePath,
          originalFileName: intent.originalFileName,
          mimeType: intent.mimeType,
          fileSizeBytes: bytes.length,
          verificationStatus: "pending",
        }).returning({ id: paymentProofs.id });
        if (!proof) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Payment proof metadata was not saved." });

        const transactionUpdate = await tx.update(transactions)
          .set({ status: "pending" })
          .where(and(
            eq(transactions.id, transaction.id),
            inArray(transactions.status, ["recorded", "payment_coordinated", "pending", "failed"]),
          ))
          .returning({ id: transactions.id });
        if (transactionUpdate.length !== 1) {
          throw new TRPCError({ code: "CONFLICT", message: "The order transaction changed while proof was being submitted." });
        }
        const orderUpdate = await tx.update(orders)
          .set({ paymentStatus: "awaiting_verification" })
          .where(and(
            eq(orders.id, order.id),
            inArray(orders.paymentStatus, ["pending", "failed"]),
          ))
          .returning({ id: orders.id });
        if (orderUpdate.length !== 1) {
          throw new TRPCError({ code: "CONFLICT", message: "The order payment state changed while proof was being submitted." });
        }
        await tx.insert(orderEvents).values({
          orderId: order.id,
          actorUserId: buyer.id,
          action: "payment_proof_submitted",
          fromStatus: latestProof?.verificationStatus ?? null,
          toStatus: "pending",
        });
        await createNotification(tx, {
          userId: buyer.id,
          type: "payment_proof_submitted",
          title: "Payment proof submitted",
          content: `Your payment proof for order #${order.id} is awaiting verification.`,
          link: "/dashboard",
          relatedEntityId: order.id,
          relatedEntityType: "order",
        });
        return { success: true, proofId: proof.id };
      });
      uploadedKey = null;
      return result;
    } catch (error) {
      if (uploadedKey) {
        try {
          await storageDeleteObject(
            uploadedKey,
            `${PAYMENT_PROOF_BUCKET}/${buyer.id}/${input.orderId}/`,
            { bucket: PAYMENT_PROOF_BUCKET, public: false },
          );
        } catch (cleanupError) {
          console.error("[payment-proof] Private upload cleanup failed.", cleanupError instanceof Error ? cleanupError.message : "unknown error");
        }
      }
      throw error;
    } }),
    uploadCheckoutReceipt: protectedProcedure.input(z.object({
      sellerId: z.number().int().positive(),
      fileName: z.string().min(1).max(255),
      contentType: z.enum(PAYMENT_PROOF_CONTENT_TYPES),
      fileSizeBytes: z.number().int().min(1).max(PAYMENT_PROOF_MAX_BYTES),
    })).mutation(async ({ ctx, input }) => {
      const buyer = requireOperationalRole(ctx.user, ["buyer", "seller"]);
      try {
        assertNotSelfTransaction(buyer.id, input.sellerId);
      } catch (error) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: error instanceof Error ? error.message : "You cannot upload a receipt for your own listing.",
        });
      }
      const fileName = sanitizePaymentProofFileName(input.fileName);
      const storagePath = `${PAYMENT_PROOF_BUCKET}/${buyer.id}/checkout/${crypto.randomUUID()}-${fileName}`;
      const signedUpload = await storageCreateSignedUploadUrl(storagePath);
      if (signedUpload.path !== storagePath || !isCheckoutReceiptStorageKey(signedUpload.path, buyer.id)) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Private Storage returned an invalid upload path." });
      }
      return {
        storagePath,
        uploadToken: signedUpload.token,
        uploadIntent: createCheckoutReceiptUploadIntent({
          buyerId: buyer.id,
          sellerId: input.sellerId,
          storagePath,
          originalFileName: fileName,
          mimeType: input.contentType,
          fileSizeBytes: input.fileSizeBytes,
        }),
      };
    }),
    finalizeCheckoutReceipt: protectedProcedure.input(z.object({
      sellerId: z.number().int().positive(),
      uploadIntent: z.string().min(1).max(2048),
    }).strict()).mutation(async ({ ctx, input }) => {
      const buyer = requireOperationalRole(ctx.user, ["buyer", "seller"]);
      const intent = verifyCheckoutReceiptUploadIntent(input.uploadIntent, buyer.id, input.sellerId);
      if (!intent) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The checkout receipt upload authorization is invalid or expired." });
      }
      const bytes = await storageDownloadPrivateProof(intent.storagePath);
      if (bytes.length !== intent.fileSizeBytes || bytes.length > PAYMENT_PROOF_MAX_BYTES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded receipt size does not match its authorization." });
      }
      if (!matchesImageContentTypeSignature(bytes, intent.mimeType)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded receipt does not match its image format." });
      }
      return { receiptUploadIntent: input.uploadIntent };
    }),
    reviewProof: protectedProcedure.input(z.object({
      proofId: z.number().int().positive(),
      decision: z.enum(["verified", "rejected"]),
      reviewNote: z.string().trim().max(600).optional(),
    }).strict().superRefine((input, context) => {
      if (input.decision === "rejected" && !input.reviewNote) {
        context.addIssue({ code: "custom", path: ["reviewNote"], message: "A review note is required when rejecting payment proof." });
      }
    })).mutation(async ({ ctx, input }) => {
      const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
      const db = await dbOrThrow();
      await db.transaction(async tx => {
        const [observedProof] = await tx.select({ orderId: paymentProofs.orderId })
          .from(paymentProofs)
          .where(eq(paymentProofs.id, input.proofId))
          .limit(1);
        if (!observedProof) throw new TRPCError({ code: "NOT_FOUND", message: "Payment proof not found." });
        const [order] = await tx.select().from(orders)
          .where(eq(orders.id, observedProof.orderId))
          .for("update");
        const [proof] = await tx.select().from(paymentProofs)
          .where(eq(paymentProofs.id, input.proofId))
          .for("update");
        const [transaction] = await tx.select().from(transactions)
          .where(eq(transactions.orderId, observedProof.orderId))
          .for("update");
        const mayReview = canReviewOrderPaymentProof(actor, order ?? { sellerId: -1, cooperativeId: null }, actor.cooperativeId)
          || (order ? canReviewPaymentProof(actor, order) : false);
        if (!order || !proof || !mayReview) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
        }
        if (proof.uploadedBy !== order.buyerId
          || !isOnlinePaymentMethod(order.paymentMethod)
          || !isPaymentProofStorageKey(proof.storagePath, order.buyerId, order.id)) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This payment proof is not linked to an eligible buyer order." });
        }
        if (!transaction || (proof.transactionId !== null && proof.transactionId !== transaction.id)) {
          throw new TRPCError({ code: "CONFLICT", message: "The payment proof does not match an existing order transaction." });
        }
        if (
          transaction.buyerId !== order.buyerId
          || transaction.sellerId !== order.sellerId
          || transaction.amountCents !== order.totalCents
          || transaction.paymentMethod !== order.paymentMethod
        ) {
          throw new TRPCError({ code: "CONFLICT", message: "The order transaction does not match the order." });
        }
        try {
          assertPaymentProofReadyForReview(order, proof);
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error instanceof Error ? error.message : "This payment proof is not eligible for review.",
          });
        }

        const reviewedAt = new Date();
        const proofUpdate = await tx.update(paymentProofs).set({
          verificationStatus: input.decision,
          reviewNote: input.reviewNote?.trim() || null,
          reviewedBy: actor.id,
          reviewedAt,
          updatedAt: reviewedAt,
        }).where(and(
          eq(paymentProofs.id, proof.id),
          eq(paymentProofs.verificationStatus, "pending"),
        )).returning({ id: paymentProofs.id });
        if (proofUpdate.length !== 1) {
          throw new TRPCError({ code: "CONFLICT", message: "This payment proof has already been reviewed." });
        }

        const nextPaymentStatus = input.decision === "verified" ? "paid" : "failed";
        const orderUpdate = await tx.update(orders)
          .set({ paymentStatus: nextPaymentStatus })
          .where(and(eq(orders.id, order.id), inArray(orders.paymentStatus, ["pending", "awaiting_verification", "failed"])))
          .returning({ id: orders.id });
        if (orderUpdate.length !== 1) {
          throw new TRPCError({ code: "CONFLICT", message: "The order payment state changed while the proof was being reviewed." });
        }
        const transactionUpdate = await tx.update(transactions)
          .set({ status: nextPaymentStatus })
          .where(and(eq(transactions.id, transaction.id), inArray(transactions.status, ["pending", "payment_coordinated", "recorded", "failed"])))
          .returning({ id: transactions.id });
        if (transactionUpdate.length !== 1) {
          throw new TRPCError({ code: "CONFLICT", message: "The order transaction changed while payment was being reviewed." });
        }
        const paymentRecord = await ensureOrderPaymentRecord(tx, {
          id: order.id,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          cooperativeId: order.cooperativeId,
          totalCents: order.totalCents,
          paymentMethod: order.paymentMethod,
          paymentStatus: input.decision === "verified" ? "paid" : "failed",
          paymentOptionId: transaction.paymentOptionId,
        }, actor.id);
        if (paymentRecord) {
          const paymentStatus = input.decision === "verified" ? "verified" : "failed";
          await tx.update(payments)
            .set({
              status: paymentStatus,
              paidAt: input.decision === "verified" ? reviewedAt : paymentRecord.paidAt,
              verifiedAt: input.decision === "verified" ? reviewedAt : null,
              verifiedByUserId: input.decision === "verified" ? actor.id : null,
            })
            .where(eq(payments.id, paymentRecord.id));
          await tx.insert(paymentEvents).values({
            paymentId: paymentRecord.id,
            actorUserId: actor.id,
            eventType: input.decision === "verified" ? "payment_proof_verified" : "payment_proof_rejected",
            fromStatus: paymentRecord.status,
            toStatus: paymentStatus,
            reason: input.reviewNote?.trim() || null,
          });
        }
        await tx.insert(orderEvents).values({
          orderId: order.id,
          actorUserId: actor.id,
          action: input.decision === "verified" ? "payment_proof_verified" : "payment_proof_rejected",
          fromStatus: "pending",
          toStatus: input.decision,
          note: input.reviewNote?.trim() || null,
        });
        await tx.insert(orderHistory).values({
          orderId: order.id,
          actorUserId: actor.id,
          eventType: "payment_status",
          fromValue: "awaiting_verification",
          toValue: nextPaymentStatus,
          note: input.reviewNote?.trim() || (input.decision === "verified" ? "Payment verified." : "Payment receipt rejected."),
        });
        if (order.buyerId !== null) await createNotification(tx, {
          userId: order.buyerId,
          type: input.decision === "verified" ? "payment_proof_verified" : "payment_proof_rejected",
          title: input.decision === "verified" ? "Payment verified" : "Payment proof needs resubmission",
          content: input.decision === "verified"
            ? `Your payment for order #${order.id} has been verified.`
            : `Your payment proof for order #${order.id} was rejected. Review the note and submit a new proof.`,
          link: `/orders/${order.id}`,
          relatedEntityId: order.id,
          relatedEntityType: "order",
        });
        if (input.decision === "verified" && order.sellerId !== null) {
          await createNotification(tx, {
            userId: order.sellerId,
            type: "order_status_updated",
            title: "Payment confirmed",
            content: `Payment for order #${order.id} is confirmed. Continue fulfillment.`,
            link: `/orders/${order.id}`,
            relatedEntityId: order.id,
            relatedEntityType: "order",
          });
        }
      });
      return { success: true };
    }),
    recordRefund: protectedProcedure.input(z.object({
      paymentId: z.number().int().positive(),
      refundId: z.string().uuid(),
      amountCents: z.number().int().positive(),
      reason: z.string().trim().min(1).max(600),
    }).strict()).mutation(async ({ ctx, input }) => {
      const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
      const db = await dbOrThrow();
      const [observedPayment] = await db.select().from(payments)
        .where(eq(payments.id, input.paymentId))
        .limit(1);
      if (!observedPayment || !canManageRefundRecord(actor, observedPayment)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot manage refunds for this payment." });
      }
      let resultingStatus: RefundState = "recorded";
      await db.transaction(async tx => {
        const [order] = await tx.select().from(orders)
          .where(eq(orders.id, observedPayment.orderId))
          .for("update");
        const [payment] = await tx.select().from(payments)
          .where(eq(payments.id, input.paymentId))
          .for("update");
        const [transaction] = await tx.select().from(transactions)
          .where(eq(transactions.orderId, observedPayment.orderId))
          .for("update");
        if (!order || !payment || !canManageRefundRecord(actor, payment)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You cannot manage refunds for this payment." });
        }
        if (!transaction || !isPaymentOrderConsistent(payment, order) || !isPaymentTransactionConsistent(payment, transaction)) {
          throw new TRPCError({ code: "CONFLICT", message: "The payment does not match its order and cannot be refunded." });
        }
        const events = await tx.select().from(paymentEvents)
          .where(eq(paymentEvents.paymentId, payment.id))
          .orderBy(asc(paymentEvents.id));
        let refunds;
        try {
          refunds = parseRefundRecords(events);
        } catch {
          throw new TRPCError({ code: "CONFLICT", message: "Refund history is inconsistent and requires review." });
        }
        let result;
        try {
          result = createRefundRecord(refunds, input, payment.amountCents);
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error instanceof Error ? error.message : "The refund request is invalid.",
          });
        }
        if (!result.created) {
          resultingStatus = result.record.status;
          return;
        }
        if (payment.status !== "verified" || order.paymentStatus !== "paid") {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only a verified, paid order can accept a refund request." });
        }
        if (transaction.status !== "paid") {
          if (transaction.status === "failed") {
            throw new TRPCError({ code: "CONFLICT", message: "The order transaction is not in a refundable state." });
          }
          const transactionUpdate = await tx.update(transactions)
            .set({ status: "paid", completedAt: payment.paidAt ?? new Date() })
            .where(and(eq(transactions.id, transaction.id), eq(transactions.status, transaction.status)))
            .returning({ id: transactions.id });
          if (transactionUpdate.length !== 1) {
            throw new TRPCError({ code: "CONFLICT", message: "The order transaction changed while recording the refund." });
          }
        }
        const totalReserved = reservedRefundAmountCents(refunds) + result.record.amountCents;
        if (!Number.isSafeInteger(totalReserved) || totalReserved > payment.amountCents) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Total refunds cannot exceed the verified payment amount." });
        }
        await tx.insert(paymentEvents).values({
          paymentId: payment.id,
          actorUserId: actor.id,
          eventType: "refund_recorded",
          fromStatus: null,
          toStatus: "recorded",
          reason: result.record.reason,
          metadata: JSON.stringify({
            refundId: result.record.refundId,
            amountCents: result.record.amountCents,
            status: result.record.status,
          }),
        });
        resultingStatus = result.record.status;
      });
      return { success: true, refundId: input.refundId, status: resultingStatus };
    }),
    updateRefundStatus: protectedProcedure.input(z.object({
      paymentId: z.number().int().positive(),
      refundId: z.string().uuid(),
      status: z.enum(["pending", "completed", "cancelled"]),
      confirmationReference: z.string().trim().min(1).max(160).optional(),
    }).strict().superRefine((input, context) => {
      if (input.status === "completed" && !input.confirmationReference) {
        context.addIssue({
          code: "custom",
          path: ["confirmationReference"],
          message: "A confirmation reference is required before completing a refund.",
        });
      }
    })).mutation(async ({ ctx, input }) => {
      const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
      const db = await dbOrThrow();
      const [observedPayment] = await db.select().from(payments)
        .where(eq(payments.id, input.paymentId))
        .limit(1);
      if (!observedPayment || !canManageRefundRecord(actor, observedPayment)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot manage refunds for this payment." });
      }
      await db.transaction(async tx => {
        const [order] = await tx.select().from(orders)
          .where(eq(orders.id, observedPayment.orderId))
          .for("update");
        const [payment] = await tx.select().from(payments)
          .where(eq(payments.id, input.paymentId))
          .for("update");
        const [transaction] = await tx.select().from(transactions)
          .where(eq(transactions.orderId, observedPayment.orderId))
          .for("update");
        if (!order || !payment || !canManageRefundRecord(actor, payment)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You cannot manage refunds for this payment." });
        }
        if (!transaction || !isPaymentOrderConsistent(payment, order) || !isPaymentTransactionConsistent(payment, transaction)) {
          throw new TRPCError({ code: "CONFLICT", message: "The payment does not match its order and cannot be updated." });
        }
        const events = await tx.select().from(paymentEvents)
          .where(eq(paymentEvents.paymentId, payment.id))
          .orderBy(asc(paymentEvents.id));
        let refunds;
        try {
          refunds = parseRefundRecords(events);
        } catch {
          throw new TRPCError({ code: "CONFLICT", message: "Refund history is inconsistent and requires review." });
        }
        const current = refunds.find(refund => refund.refundId === input.refundId);
        if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Refund record not found." });
        let transition: ReturnType<typeof transitionRefundRecord>;
        try {
          transition = transitionRefundRecord(refunds, input.refundId, input.status, input.confirmationReference);
        } catch (error) {
          throw new TRPCError({
            code: "CONFLICT",
            message: error instanceof Error ? error.message : "The refund transition is invalid.",
          });
        }
        if (!transition.changed) return;
        if (payment.status !== "verified" || order.paymentStatus !== "paid") {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The payment is no longer in a refundable state." });
        }
        if (transaction.status !== "paid") {
          throw new TRPCError({ code: "CONFLICT", message: "The order transaction is not in a refundable state." });
        }
        const updatedRefunds = refunds.map(refund => refund.refundId === input.refundId ? transition.record : refund);
        const completedAmount = completedRefundAmountCents(updatedRefunds);
        if (completedAmount > payment.amountCents) {
          throw new TRPCError({ code: "CONFLICT", message: "Completed refunds cannot exceed the verified payment amount." });
        }
        if (input.status === "completed" && completedAmount === payment.amountCents) {
          const paymentUpdate = await tx.update(payments)
            .set({ status: "refunded" })
            .where(and(eq(payments.id, payment.id), eq(payments.status, "verified")))
            .returning({ id: payments.id });
          const orderUpdate = await tx.update(orders)
            .set({ paymentStatus: "refunded" })
            .where(and(eq(orders.id, order.id), eq(orders.paymentStatus, "paid")))
            .returning({ id: orders.id });
          if (paymentUpdate.length !== 1 || orderUpdate.length !== 1) {
            throw new TRPCError({ code: "CONFLICT", message: "Payment state changed while completing the refund." });
          }
        }
        await tx.insert(paymentEvents).values({
          paymentId: payment.id,
          actorUserId: actor.id,
          eventType: "refund_status_changed",
          fromStatus: current.status,
          toStatus: transition.record.status,
          reason: transition.record.confirmationReference ?? null,
          metadata: JSON.stringify({
            refundId: transition.record.refundId,
            amountCents: transition.record.amountCents,
            status: transition.record.status,
            ...(transition.record.confirmationReference
              ? { confirmationReference: transition.record.confirmationReference }
              : {}),
          }),
        });
      });
      return { success: true, status: input.status as RefundState };
    }),
    recordCashReceipt: protectedProcedure
      .input(z.object({ orderId: z.number().int().positive(), note: z.string().trim().max(600).optional() }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        await db.transaction(async tx => {
          const [order] = await tx.select().from(orders)
            .where(eq(orders.id, input.orderId))
            .for("update");
          const [transaction] = await tx.select().from(transactions)
            .where(eq(transactions.orderId, input.orderId))
            .for("update");
          if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
          const payment = {
            buyerId: order.buyerId,
            sellerId: order.sellerId,
            cooperativeId: order.cooperativeId,
            orderId: order.id,
            amountCents: order.totalCents,
            paymentMethod: order.paymentMethod ?? "",
            status: order.paymentStatus === "paid" || order.paymentStatus === "verified"
              ? "verified"
              : order.paymentStatus === "failed" || order.paymentStatus === "expired" || order.paymentStatus === "refunded"
                ? order.paymentStatus
                : "pending",
          };
          if (!transaction || !canManageCashReceipt(actor, payment)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You cannot record a cash receipt for this payment." });
          }
          if (!canRecordCashReceipt(actor, payment, order, transaction)) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Cash receipt requires a matching pending cash payment for a ready order." });
          }
          const receivedAt = new Date();
          const orderUpdate = await tx.update(orders)
            .set({ paymentStatus: "paid" })
            .where(and(eq(orders.id, order.id), inArray(orders.paymentStatus, ["pending", "F2F-pending-confirmation"])))
            .returning({ id: orders.id });
          if (orderUpdate.length !== 1) {
            throw new TRPCError({ code: "CONFLICT", message: "Order payment state changed while cash receipt was being recorded." });
          }
          const transactionUpdate = await tx.update(transactions).set({
            status: "paid",
            paymentReferenceNote: input.note?.trim() || transaction.paymentReferenceNote,
            completedAt: receivedAt,
          }).where(and(
            eq(transactions.id, transaction.id),
            inArray(transactions.status, ["recorded", "payment_coordinated", "pending"]),
          )).returning({ id: transactions.id });
          if (transactionUpdate.length !== 1) {
            throw new TRPCError({ code: "CONFLICT", message: "Order transaction changed while cash receipt was being recorded." });
          }
          const paymentRecord = await ensureOrderPaymentRecord(tx, {
            id: order.id,
            buyerId: order.buyerId,
            sellerId: order.sellerId,
            cooperativeId: order.cooperativeId,
            totalCents: order.totalCents,
            paymentMethod: order.paymentMethod,
            paymentStatus: "pending",
            paymentOptionId: transaction.paymentOptionId,
          }, actor.id);
          if (paymentRecord) {
            await tx.update(payments)
              .set({ status: "verified", paidAt: receivedAt, verifiedAt: receivedAt, verifiedByUserId: actor.id })
              .where(and(eq(payments.id, paymentRecord.id), inArray(payments.status, ["pending", "awaiting_verification"])));
            await tx.insert(paymentEvents).values({
              paymentId: paymentRecord.id,
              actorUserId: actor.id,
              eventType: "cash_payment_received",
              fromStatus: paymentRecord.status,
              toStatus: "verified",
              reason: input.note?.trim() || null,
            });
          }
          await tx.insert(orderEvents).values({
            orderId: order.id,
            actorUserId: actor.id,
            action: "cash_payment_received",
            fromStatus: order.paymentStatus,
            toStatus: "paid",
            note: input.note?.trim() || null,
          });
          if (order.buyerId !== null) await createNotification(tx, {
            userId: order.buyerId,
            type: "cash_payment_received",
            title: "Cash payment recorded",
            content: `Cash payment for order #${order.id} has been recorded.`,
            link: "/dashboard",
            relatedEntityId: order.id,
            relatedEntityType: "order",
          });
        });
        return { success: true };
      }),
  }),

  cooperativeAssociations: router({
    activeCooperatives: protectedProcedure.query(async ({ ctx }) => {
      const requestBlock = cooperativeAssociationRequestBlock(ctx.user);
      if (requestBlock) {
        throw new TRPCError(requestBlock);
      }
      const db = await dbOrThrow();
      return db.select({ id: cooperatives.id, name: cooperatives.name })
        .from(cooperatives)
        .where(and(eq(cooperatives.status, "active"), isNull(cooperatives.deletedAt)))
        .orderBy(asc(cooperatives.name));
    }),
    mine: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "seller") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only Sellers can view cooperative association requests." });
      }
      const db = await dbOrThrow();
      return db.select({ request: cooperativeAssociationRequests, cooperativeName: cooperatives.name })
        .from(cooperativeAssociationRequests)
        .innerJoin(cooperatives, eq(cooperativeAssociationRequests.cooperativeId, cooperatives.id))
        .where(eq(cooperativeAssociationRequests.sellerId, ctx.user.id))
        .orderBy(desc(cooperativeAssociationRequests.createdAt));
    }),
    request: protectedProcedure
      .input(z.object({
        cooperativeId: z.number().int().positive(),
        message: z.string().trim().min(1).max(600),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        const db = await dbOrThrow();
        return db.transaction(async tx => {
          const [seller] = await tx.select({
            id: users.id,
            role: users.role,
            approvalStatus: users.approvalStatus,
            cooperativeId: users.cooperativeId,
          }).from(users)
            .where(eq(users.id, ctx.user.id))
            .for("update")
            .limit(1);
          if (!seller || !canRequestCooperativeAssociation(seller)) {
            const requestBlock = cooperativeAssociationRequestBlock(
              seller ?? { role: ctx.user.role, approvalStatus: ctx.user.approvalStatus, cooperativeId: ctx.user.cooperativeId },
              input.cooperativeId,
            );
            throw new TRPCError(requestBlock ?? {
              code: "FORBIDDEN",
              message: "This account cannot request a cooperative association.",
            });
          }
          const sameCooperativeBlock = cooperativeAssociationRequestBlock(seller, input.cooperativeId);
          if (sameCooperativeBlock) {
            throw new TRPCError(sameCooperativeBlock);
          }
          const [cooperative] = await tx.select({ id: cooperatives.id })
            .from(cooperatives)
            .where(and(
              eq(cooperatives.id, input.cooperativeId),
              eq(cooperatives.status, "active"),
              isNull(cooperatives.deletedAt),
            ))
            .for("share")
            .limit(1);
          if (!cooperative) throw new TRPCError({ code: "NOT_FOUND", message: "This cooperative is not available for association requests." });
          const [pendingRequest] = await tx.select({ id: cooperativeAssociationRequests.id })
            .from(cooperativeAssociationRequests)
            .where(and(
              eq(cooperativeAssociationRequests.sellerId, seller.id),
              eq(cooperativeAssociationRequests.status, "pending"),
            ))
            .limit(1);
          const pendingBlock = cooperativeAssociationRequestBlock(seller, input.cooperativeId, Boolean(pendingRequest));
          if (pendingBlock) throw new TRPCError(pendingBlock);
          const [created] = await tx.insert(cooperativeAssociationRequests).values({
            sellerId: seller.id,
            cooperativeId: cooperative.id,
            message: input.message,
          }).returning({ id: cooperativeAssociationRequests.id });
          if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The association request was not saved." });
          await recordAuditLog(tx, {
            actorUserId: seller.id,
            action: "cooperative_association_requested",
            entityType: "cooperative_association_request",
            entityId: created.id,
            cooperativeId: cooperative.id,
          });
          const admins = await tx.select({ id: users.id }).from(users).where(and(
            eq(users.role, "admin"),
            eq(users.cooperativeId, cooperative.id),
            eq(users.approvalStatus, "approved"),
          ));
          for (const admin of admins) {
            await createNotification(tx, {
              userId: admin.id,
              type: "cooperative_association_request",
              title: "Seller cooperative request",
              content: "A Seller submitted a cooperative association request for review.",
              link: "/dashboard",
              relatedEntityId: created.id,
              relatedEntityType: "cooperative_association_request",
            });
          }
          return { success: true, requestId: created.id };
        });
      }),
  }),

  cooperativeAdmin: router({
    associationRequests: protectedProcedure.query(async ({ ctx }) => {
      const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
      const db = await dbOrThrow();
      const conditions = [eq(cooperativeAssociationRequests.status, "pending")];
      if (actor.role === "admin" && actor.cooperativeId !== null) {
        conditions.push(eq(cooperativeAssociationRequests.cooperativeId, actor.cooperativeId));
      }
      return db.select({
        request: cooperativeAssociationRequests,
        sellerName: users.name,
        sellerEmail: users.email,
        cooperativeName: cooperatives.name,
      }).from(cooperativeAssociationRequests)
        .leftJoin(users, eq(cooperativeAssociationRequests.sellerId, users.id))
        .innerJoin(cooperatives, eq(cooperativeAssociationRequests.cooperativeId, cooperatives.id))
        .where(and(...conditions))
        .orderBy(asc(cooperativeAssociationRequests.createdAt));
    }),
    reviewAssociationRequest: protectedProcedure
      .input(z.object({
        requestId: z.number().int().positive(),
        decision: z.enum(["approved", "rejected"]),
        reviewNote: z.string().trim().min(1).max(600),
        moveExistingListings: z.boolean().default(false),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        return db.transaction(async tx => {
          const [request] = await tx.select().from(cooperativeAssociationRequests)
            .where(eq(cooperativeAssociationRequests.id, input.requestId))
            .for("update")
            .limit(1);
          if (!request || request.status !== "pending") {
            throw new TRPCError({ code: "CONFLICT", message: "This association request is no longer pending." });
          }
          if (!canReviewCooperativeAssociation(actor, request.cooperativeId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You cannot review requests for another cooperative." });
          }
          const [cooperative] = await tx.select({
            name: cooperatives.name,
          }).from(cooperatives)
            .where(eq(cooperatives.id, request.cooperativeId))
            .for("share")
            .limit(1);
          if (!cooperative) throw new TRPCError({ code: "CONFLICT", message: "The requested cooperative is no longer available." });
          if (input.decision === "approved") {
            await tx.execute(sql`
              select agricoop_app.approve_cooperative_association_request(
                ${request.id},
                ${input.reviewNote},
                ${input.moveExistingListings}
              )
            `);
          } else {
            await tx.execute(sql`
              select agricoop_app.reject_cooperative_association_request(
                ${request.id},
                ${input.reviewNote}
              )
            `);
          }
          await recordAuditLog(tx, {
            actorUserId: actor.id,
            action: `cooperative_association_${input.decision}`,
            entityType: "cooperative_association_request",
            entityId: request.id,
            cooperativeId: request.cooperativeId,
            metadata: {
              moveExistingListings: input.decision === "approved" && input.moveExistingListings,
              reviewNote: input.reviewNote,
            },
          });
          await createNotification(tx, {
            userId: request.sellerId,
            type: `cooperative_association_${input.decision}`,
            title: input.decision === "approved" ? "Cooperative association approved" : "Cooperative association declined",
            content: input.decision === "approved"
              ? `You have been assigned to ${cooperative.name}.${input.moveExistingListings ? " Your existing listings were also moved to this cooperative." : ""} Admin note: ${input.reviewNote} A separate account approval step may remain.`
              : `Your request to join ${cooperative.name} was declined.${input.reviewNote ? ` Admin note: ${input.reviewNote}` : ""}`,
            link: "/dashboard",
            relatedEntityId: request.id,
            relatedEntityType: "cooperative_association_request",
          });
          return { success: true };
        });
      }),
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
        const partySelect = {
          id: users.id,
          name: users.name,
          email: users.email,
          contactNumber: users.contactNumber,
          phone: users.phone,
          address: users.address,
        } as const;
        type PartyRow = { id: number; name: string | null; email: string | null; contactNumber: string | null; phone: string | null; address: string | null };
        const seller = orderDetail.order.sellerId === null
          ? ([] as PartyRow[])
          : await db.select(partySelect).from(users).where(eq(users.id, orderDetail.order.sellerId)).limit(1) as PartyRow[];
        const buyer = orderDetail.order.buyerId === null
          ? ([] as PartyRow[])
          : await db.select(partySelect).from(users).where(eq(users.id, orderDetail.order.buyerId)).limit(1) as PartyRow[];
        return {
          order: orderDetail.order,
          buyer: buyer[0],
          seller: seller[0],
          payment: orderDetail.payment,
          items: orderDetail.items,
          events: orderDetail.events,
        };
      }),
    updateMemberStatus: protectedProcedure
      .input(z.object({ userId: z.number().int().positive(), approvalStatus: z.enum(["approved", "suspended"]) }))
      .mutation(async ({ ctx, input }) => {
        const cooperativeAdmin = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const cooperativeId = cooperativeAdmin.cooperativeId;
        if (cooperativeId === null) throw new TRPCError({ code: "BAD_REQUEST", message: "Assign this officer to a cooperative before validating members." });
        const db = await dbOrThrow();
        return db.transaction(async tx => {
          const [target] = await tx.select({
            id: users.id,
            role: users.role,
            approvalStatus: users.approvalStatus,
            cooperativeId: users.cooperativeId,
          }).from(users)
            .where(eq(users.id, input.userId))
            .for("update")
            .limit(1);
          if (!target || target.id === cooperativeAdmin.id
            || (target.role !== "buyer" && target.role !== "seller")
            || target.cooperativeId !== cooperativeId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You can only manage Buyer or Seller accounts assigned to your cooperative." });
          }
          const result = await tx.update(users)
            .set({ approvalStatus: input.approvalStatus })
            .where(and(
              eq(users.id, target.id),
              eq(users.cooperativeId, cooperativeId),
              inArray(users.role, ["buyer", "seller"]),
            ))
            .returning({ id: users.id });
          if (!result.length) throw new TRPCError({ code: "CONFLICT", message: "This account changed while it was being updated." });
          await recordAuditLog(tx, {
            actorUserId: cooperativeAdmin.id,
            action: "member_approval_status_updated",
            entityType: "user",
            entityId: target.id,
            cooperativeId,
            metadata: { from: target.approvalStatus, to: input.approvalStatus },
          });
          await createNotification(tx, {
            userId: target.id,
            type: "account_approval_status",
            title: "Account status updated",
            content: `Your account has been ${formatEnumLabel(input.approvalStatus)}.`,
            link: "/dashboard",
          });
          return { success: true };
        });
      }),
    openSellerOrderThread: protectedProcedure
      .input(z.object({ orderId: z.number().int().positive(), body: z.string().min(1).max(2000).optional() }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        const [order] = await db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "That order could not be found." });
        if (!canAccessOrderForCooperative(actor, order.cooperativeId)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "This officer can only message sellers on orders in their cooperative." });
        }
        if (order.sellerId === null) throw new TRPCError({ code: "BAD_REQUEST", message: "This order has no seller to message." });
        const [existing] = await db.select({ id: conversations.id }).from(conversations)
          .where(and(
            eq(conversations.orderId, order.id),
            eq(conversations.buyerId, actor.id),
            eq(conversations.sellerId, order.sellerId),
            isNull(conversations.deletedAt),
          ))
          .limit(1);
        if (existing) return { conversationId: existing.id, created: false as const };
        const id = await openSupportThread(db, {
          buyerId: actor.id,
          sellerId: order.sellerId,
          orderId: order.id,
          subject: `Order #${order.id} — cooperative coordination`,
          body: input.body ?? `Officer opened the order conversation for order #${order.id}.`,
          senderId: actor.id,
        });
        return { conversationId: id, created: true as const };
      }),
    orderThreadStates: protectedProcedure.query(async ({ ctx }) => {
      const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
      const db = await dbOrThrow();
      return db.select({
        orderId: threadStates.threadId,
        archivedAt: threadStates.archivedAt,
        deletedAt: threadStates.deletedAt,
      }).from(threadStates).where(and(
        eq(threadStates.userId, actor.id),
        eq(threadStates.channel, "order"),
      ));
    }),
    updateOrderState: protectedProcedure
      .input(z.object({
        orderIds: z.array(z.number().int().positive()).min(1).max(100),
        action: z.enum(["archive", "unarchive", "delete", "restore"]),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        const orderRows = await db.select({
          id: orders.id,
          status: orders.status,
          cooperativeId: orders.cooperativeId,
        }).from(orders).where(inArray(orders.id, input.orderIds));
        if (orderRows.length !== input.orderIds.length) {
          throw new TRPCError({ code: "NOT_FOUND", message: "One or more orders could not be found." });
        }
        for (const order of orderRows) {
          if (!canAccessOrderForCooperative(actor, order.cooperativeId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "This officer can only manage orders in their cooperative." });
          }
          if ((input.action === "archive" || input.action === "delete")
            && order.status !== "completed" && order.status !== "cancelled") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Order #${order.id} is ${formatEnumLabel(order.status)}; only completed or cancelled orders can be removed from the list.`,
            });
          }
        }
        for (const order of orderRows) {
          await upsertPerUserThreadState({
            userId: actor.id,
            channel: "order",
            threadId: order.id,
            action: input.action,
          });
        }
        return { success: true, count: orderRows.length };
      }),
    setFulfillmentClassification: protectedProcedure
      .input(z.object({
        productId: z.number().int().positive(),
        fulfillmentType: z.enum(FULFILLMENT_TYPES).optional(),
        prepTimeDays: z.number().int().min(1).max(90).nullable().optional(),
        capacityNote: z.string().trim().max(300).nullable().optional(),
        category: z.string().trim().min(1).max(80).optional(),
        onlinePaymentEnabled: z.boolean().optional(),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        return db.transaction(async tx => {
          const [product] = await tx.select({
            id: products.id,
            sellerId: products.sellerId,
            cooperativeId: products.cooperativeId,
            fulfillmentType: products.fulfillmentType,
            prepTimeDays: products.prepTimeDays,
            capacityNote: products.capacityNote,
            category: products.category,
            onlinePaymentEnabled: products.onlinePaymentEnabled,
          }).from(products).where(eq(products.id, input.productId)).for("update").limit(1);
          if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });
          if (!canManageCooperativeResource(actor, product.cooperativeId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You cannot classify a product outside your cooperative." });
          }
          const nextFulfillmentType = input.fulfillmentType ?? product.fulfillmentType ?? "on_hand";
          const nextPrepTimeDays = input.prepTimeDays !== undefined ? input.prepTimeDays : product.prepTimeDays;
          const nextCapacityNote = input.capacityNote !== undefined ? (input.capacityNote?.trim() || null) : product.capacityNote;
          const nextCategory = input.category !== undefined ? input.category.trim() : product.category;
          const nextOnlinePaymentEnabled = input.onlinePaymentEnabled ?? product.onlinePaymentEnabled ?? true;
          const changed = product.fulfillmentType !== nextFulfillmentType
            || (product.prepTimeDays ?? null) !== (nextPrepTimeDays ?? null)
            || (product.capacityNote ?? null) !== (nextCapacityNote ?? null)
            || product.category !== nextCategory
            || (product.onlinePaymentEnabled ?? true) !== nextOnlinePaymentEnabled;
          if (changed) {
            await tx.update(products).set({
              fulfillmentType: nextFulfillmentType,
              prepTimeDays: nextPrepTimeDays ?? null,
              capacityNote: nextCapacityNote ?? null,
              category: nextCategory,
              onlinePaymentEnabled: nextOnlinePaymentEnabled,
            }).where(eq(products.id, product.id));
            await recordAuditLog(tx, {
              actorUserId: actor.id,
              action: "product_fulfillment_classified",
              entityType: "product",
              entityId: product.id,
              cooperativeId: product.cooperativeId,
              metadata: {
                from: product.fulfillmentType,
                to: nextFulfillmentType,
                prepTimeDays: nextPrepTimeDays ?? null,
                category: { from: product.category, to: nextCategory },
              },
            });
            if (product.fulfillmentType !== nextFulfillmentType && product.sellerId !== null) {
              await createNotification(tx, {
                userId: product.sellerId,
                type: "product_fulfillment_classified",
                title: "Listing fulfillment updated",
                content: `A cooperative officer set this listing to ${nextFulfillmentType === "order_based" ? "Order-Based (prepared after order)" : "On-Hand (ready stock)"}.`,
                link: "/dashboard",
                relatedEntityId: product.id,
                relatedEntityType: "product",
              });
            }
          }
          return { success: true, changed };
        });
      }),
  }),

  admin: router({
    createAccount: adminAccountsRouter.createAccount,
    overview: protectedProcedure.query(({ ctx }) => {
      const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
      return getAdminOverview(adminOverviewCooperativeScope(actor));
    }),
    reviewProduct: protectedProcedure.input(z.object({
      productId: z.number().int().positive(),
      decision: z.enum(["approved", "rejected"]),
      rejectionReason: z.string().trim().max(600).optional(),
    }).strict().superRefine((input, refinement) => {
      if (input.decision === "rejected" && !input.rejectionReason) {
        refinement.addIssue({ code: "custom", path: ["rejectionReason"], message: "A rejection reason is required." });
      }
    })).mutation(async ({ ctx, input }) => {
      const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
      const db = await dbOrThrow();
      return db.transaction(async tx => {
        const [target] = await tx.select({
          id: products.id,
          sellerId: products.sellerId,
          cooperativeId: products.cooperativeId,
          verificationStatus: products.verificationStatus,
        }).from(products)
          .where(eq(products.id, input.productId))
          .for("update")
          .limit(1);
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });
        if (!canManageCooperativeResource(actor, target.cooperativeId)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You cannot review a product outside your cooperative." });
        }
        let review;
        try {
          review = prepareProductReview(target.verificationStatus, input.decision, input.rejectionReason);
        } catch (error) {
          throw new TRPCError({
            code: "CONFLICT",
            message: error instanceof Error ? error.message : "The product cannot be reviewed.",
          });
        }
        const scope = actor.role === "superadmin"
          ? eq(products.id, input.productId)
          : and(eq(products.id, input.productId), eq(products.cooperativeId, actor.cooperativeId!));
        const result = await tx.update(products)
          .set(review)
          .where(and(scope, eq(products.verificationStatus, "pending")))
          .returning({ id: products.id });
        if (!result.length) {
          throw new TRPCError({ code: "CONFLICT", message: "The product changed while it was being reviewed." });
        }
        await recordAuditLog(tx, {
          actorUserId: actor.id,
          action: `product_${input.decision}`,
          entityType: "product",
          entityId: target.id,
          cooperativeId: target.cooperativeId,
          metadata: input.decision === "rejected" ? { rejectionReason: review.rejectionReason } : undefined,
        });
        if (target.sellerId !== null) await createNotification(tx, {
          userId: target.sellerId,
          type: `product_${input.decision}`,
          title: input.decision === "approved" ? "Product listing approved" : "Product listing needs changes",
          content: input.decision === "approved"
            ? "Your product listing is approved and visible to marketplace buyers."
            : `Your product listing was rejected. Reason: ${review.rejectionReason}`,
          link: "/dashboard",
          relatedEntityId: target.id,
          relatedEntityType: "product",
        });
        return { success: true };
      });
    }),
    deleteListing: protectedProcedure
      .input(z.object({ productId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        const [target] = await db.select({
          id: products.id,
          cooperativeId: products.cooperativeId,
          deletedAt: products.deletedAt,
        }).from(products).where(eq(products.id, input.productId)).limit(1);
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });
        if (!canManageCooperativeResource(actor, target.cooperativeId)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You cannot delete a listing outside your cooperative." });
        }
        if (target.deletedAt) {
          return { success: true, alreadyDeleted: true };
        }
        const scope = actor.role === "superadmin"
          ? and(eq(products.id, input.productId), isNull(products.deletedAt))
          : and(eq(products.id, input.productId), eq(products.cooperativeId, actor.cooperativeId!), isNull(products.deletedAt));
        const result = await db.update(products)
          .set({
            status: "archived",
            visibility: "hidden",
            deletedAt: new Date(),
            deletedBy: actor.id,
          })
          .where(scope)
          .returning({ id: products.id });
        if (!result.length) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });
        return { success: true, alreadyDeleted: false };
      }),
    hideListing: protectedProcedure
      .input(z.object({ productId: z.number().int().positive() }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        const [target] = await db.select({
          id: products.id,
          cooperativeId: products.cooperativeId,
          deletedAt: products.deletedAt,
          visibility: products.visibility,
        }).from(products).where(eq(products.id, input.productId)).limit(1);
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });
        if (!canManageCooperativeResource(actor, target.cooperativeId)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You cannot hide a listing outside your cooperative." });
        }
        if (target.deletedAt) {
          throw new TRPCError({ code: "CONFLICT", message: "A deleted listing cannot be changed." });
        }
        if (target.visibility === "hidden") return { success: true, alreadyHidden: true };
        const scope = actor.role === "superadmin"
          ? and(eq(products.id, input.productId), isNull(products.deletedAt))
          : and(eq(products.id, input.productId), eq(products.cooperativeId, actor.cooperativeId!), isNull(products.deletedAt));
        const result = await db.update(products)
          .set({ visibility: "hidden" })
          .where(scope)
          .returning({ id: products.id });
        if (!result.length) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });
        await recordAuditLog(db, {
          actorUserId: actor.id,
          action: "product_hidden",
          entityType: "product",
          entityId: target.id,
          cooperativeId: target.cooperativeId,
        });
        return { success: true, alreadyHidden: false };
      }),
    updateUser: protectedProcedure
      .input(z.object({ userId: z.number().int().positive(), role: z.enum(APP_ROLES), approvalStatus: z.enum(["approved", "pending", "suspended"]), cooperativeId: z.number().int().positive().nullable() }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        if (actor.role === "admin" && !actor.cooperativeId) throw new TRPCError({ code: "FORBIDDEN", message: "Assign this officer to a cooperative before managing users." });
        return db.transaction(async tx => {
          const [target] = await tx.select({
            id: users.id,
            openId: users.openId,
            role: users.role,
            approvalStatus: users.approvalStatus,
            cooperativeId: users.cooperativeId,
          }).from(users)
            .where(eq(users.id, input.userId))
            .for("update")
            .limit(1);
          if (!target || actor.id === target.id
            || !canUpdateCooperativeUser(actor, target.cooperativeId, input.cooperativeId, input.role, target.role)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You cannot manage this user or change their cooperative assignment." });
          }
          if (!target.openId) {
            throw new TRPCError({ code: "NOT_FOUND", message: "That user account could not be found." });
          }
          const scope = actor.role === "superadmin"
            ? eq(users.id, input.userId)
            : and(eq(users.id, input.userId), eq(users.cooperativeId, actor.cooperativeId!));
          const result = await tx.update(users)
            .set({ role: input.role, approvalStatus: input.approvalStatus, cooperativeId: input.cooperativeId })
            .where(scope)
            .returning({ id: users.id });
          if (!result.length) {
            throw new TRPCError({ code: "CONFLICT", message: "This account changed while it was being updated." });
          }
          try {
            await syncProfileRoleToApplicationRole(target.openId, input.role, tx);
          } catch {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "The application role was updated, but the canonical profile role could not be synced. Retry or use role reconciliation.",
            });
          }
          await recordAuditLog(tx, {
            actorUserId: actor.id,
            action: "user_access_updated",
            entityType: "user",
            entityId: target.id,
            cooperativeId: input.cooperativeId,
            metadata: {
              before: { role: target.role, approvalStatus: target.approvalStatus, cooperativeId: target.cooperativeId },
              after: { role: input.role, approvalStatus: input.approvalStatus, cooperativeId: input.cooperativeId },
            },
          });
          await createNotification(tx, {
            userId: target.id,
            type: "account_access_updated",
            title: "Account access updated",
            content: "An administrator updated your account role, approval status, or cooperative assignment.",
            link: "/dashboard",
          });
          return { success: true };
        });
      }),
    userDeletePreview: protectedProcedure
      .input(z.object({ userId: z.number().int().positive() }).strict())
      .query(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        const [target] = await db.select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          cooperativeId: users.cooperativeId,
          deletedAt: users.deletedAt,
        }).from(users).where(eq(users.id, input.userId)).limit(1);
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
        if (!canSoftDeleteTargetUser(actor, target)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You cannot delete this user." });
        }
        const [listingCount] = await db.select({ count: sql<number>`count(*)::int` }).from(products)
          .where(and(eq(products.sellerId, target.id), isNull(products.deletedAt)));
        const [openOrderCount] = await db.select({ count: sql<number>`count(*)::int` }).from(orders)
          .where(and(
            or(eq(orders.buyerId, target.id), eq(orders.sellerId, target.id)),
            inArray(orders.status, ["submitted", "confirmed", "ready", "processing", "shipped"]),
          ));
        return {
          ...target,
          listingCount: Number(listingCount?.count ?? 0),
          openOrderCount: Number(openOrderCount?.count ?? 0),
        };
      }),
    deleteUser: protectedProcedure
      .input(z.object({
        userId: z.number().int().positive(),
        confirm: z.literal(true),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        const result = await db.transaction(async tx => {
          const [target] = await tx.select({
            id: users.id,
            openId: users.openId,
            loginMethod: users.loginMethod,
            role: users.role,
            cooperativeId: users.cooperativeId,
          }).from(users).where(eq(users.id, input.userId)).for("update").limit(1);
          if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
          if (!canSoftDeleteTargetUser(actor, target)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You cannot delete this user." });
          }
          if (actor.role === "admin" && actor.cooperativeId !== target.cooperativeId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You can only delete users in your cooperative." });
          }

          const [listingCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(products)
            .where(and(eq(products.sellerId, target.id), isNull(products.deletedAt)));
          const [openOrderCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(orders)
            .where(and(
              or(eq(orders.buyerId, target.id), eq(orders.sellerId, target.id)),
              inArray(orders.status, ["submitted", "confirmed", "ready", "processing", "shipped"]),
            ));

          // agricoop_app.purge_user_account performs every personal-data delete,
          // listing detach, profile removal, and the users-row delete atomically
          // under security-definer privileges, and returns private document paths
          // for post-commit storage cleanup.
          const purgeRows = Array.from(await tx.execute(sql`
            select agricoop_app.purge_user_account(${input.userId}, ${actor.id}) as result
          `)) as unknown as Array<{ result: { coopDocumentPaths: string[]; verificationPaths: string[] } }>;
          const purgeResult = purgeRows[0]?.result ?? { coopDocumentPaths: [], verificationPaths: [] };

          await recordAuditLog(tx, {
            actorUserId: actor.id,
            action: "user_deleted",
            entityType: "user",
            entityId: target.id,
            cooperativeId: target.cooperativeId,
            metadata: {
              targetRole: target.role,
              permanent: true,
              listingCount: Number(listingCount?.count ?? 0),
              openOrderCount: Number(openOrderCount?.count ?? 0),
            },
          });

          return {
            openId: target.openId,
            loginMethod: target.loginMethod,
            coopDocPaths: purgeResult.coopDocumentPaths ?? [],
            verificationPaths: purgeResult.verificationPaths ?? [],
            listingCount: Number(listingCount?.count ?? 0),
            openOrderCount: Number(openOrderCount?.count ?? 0),
          };
        });

        // Post-commit cleanup: private document objects and the Auth account.
        const storageErrors: string[] = [];
        const removeWithRetry = async (bucket: string, paths: string[]) => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const { error } = await supabaseAdmin.storage.from(bucket).remove(paths);
            if (!error) return null;
            if (attempt === 2) return error.message;
            await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
          }
          return "storage remove failed";
        };
        if (result.coopDocPaths.length) {
          const failure = await removeWithRetry(COOP_ADMIN_APPLICATION_BUCKET, result.coopDocPaths);
          if (failure) storageErrors.push(`coop-documents: ${failure}`);
        }
        if (result.verificationPaths.length) {
          const failure = await removeWithRetry(PROFILE_VERIFICATION_BUCKET, result.verificationPaths);
          if (failure) storageErrors.push(`verification-documents: ${failure}`);
        }
        if (result.openId && result.loginMethod !== "demo") {
          // GoTrue admin deletes occasionally hit transient gateway timeouts;
          // retry briefly so the Auth account does not outlive the app account.
          let authError: { message: string } | null = null;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const outcome = await supabaseAdmin.auth.admin.deleteUser(result.openId);
            if (!outcome.error) { authError = null; break; }
            authError = outcome.error;
            if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
          }
          if (authError) storageErrors.push(`auth-account: ${authError.message}`);
        }
        if (storageErrors.length) {
          console.error("[admin.deleteUser] post-commit cleanup incomplete", {
            userId: input.userId,
            errors: storageErrors,
          });
        }
        return {
          success: true,
          cleanupWarnings: storageErrors.length,
          listingCount: result.listingCount,
          openOrderCount: result.openOrderCount,
        };
      }),
    listRoleConflicts: protectedProcedure.query(async ({ ctx }) => {
      requireOperationalRole(ctx.user, ["superadmin"]);
      const db = await dbOrThrow();
      const rows = await db.execute(sql`
        select u.id as "userId", u.email, u.role as "applicationRole", r.role_name as "profileRole", u."openId"
        from agricoop_app.users u
        join public.profiles p on p.user_id::text = u."openId"
        join public.roles r on r.role_id = p.role_id
        where (r.role_name = 'buyer' and u.role <> 'buyer')
           or (r.role_name = 'seller' and u.role <> 'seller')
           or (r.role_name = 'coop_officer' and u.role <> 'admin')
           or (r.role_name = 'system_admin' and u.role <> 'superadmin')
        order by u.id
      `);
      return Array.from(rows as unknown as Array<Record<string, unknown>>).map(row => ({
        userId: Number(row.userId),
        email: String(row.email ?? ""),
        applicationRole: String(row.applicationRole),
        profileRole: String(row.profileRole),
        openId: String(row.openId ?? ""),
      }));
    }),
    reconcileRole: protectedProcedure
      .input(z.object({
        userId: z.number().int().positive(),
        // Prefer application role (operational source of truth) unless explicitly overriding.
        prefer: z.enum(["application", "profile"]).default("application"),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        requireOperationalRole(ctx.user, ["superadmin"]);
        const db = await dbOrThrow();
        return db.transaction(async tx => {
          const [target] = await tx.select({
            id: users.id,
            openId: users.openId,
            role: users.role,
            email: users.email,
          }).from(users).where(eq(users.id, input.userId)).limit(1);
          if (!target?.openId) throw new TRPCError({ code: "NOT_FOUND", message: "That user account could not be found." });
          const [profile] = await tx.select({
            roleId: profiles.roleId,
            roleName: roles.roleName,
          }).from(profiles)
            .leftJoin(roles, eq(profiles.roleId, roles.roleId))
            .where(eq(profiles.userId, target.openId))
            .limit(1);
          if (!profile?.roleName) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Canonical profile role is missing for this user." });
          }
          if (input.prefer === "application") {
            await syncProfileRoleToApplicationRole(target.openId, target.role, tx);
          } else {
            const mapped = profile.roleName === "buyer" ? "buyer"
              : profile.roleName === "seller" ? "seller"
              : profile.roleName === "coop_officer" ? "admin"
              : profile.roleName === "system_admin" ? "superadmin"
              : null;
            if (!mapped) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported canonical role for reconciliation." });
            }
            await tx.update(users).set({ role: mapped }).where(eq(users.id, target.id));
          }
          await recordAuditLog(tx, {
            actorUserId: ctx.user.id,
            action: "user_role_reconciled",
            entityType: "user",
            entityId: target.id,
            metadata: { prefer: input.prefer, email: target.email, applicationRole: target.role, profileRole: profile.roleName },
          });
          return { success: true };
        });
      }),
  }),

  adminPayment: router({
    listOptions: protectedProcedure.query(async ({ ctx }) => {
      const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
      const db = await dbOrThrow();
      if (actor.role === "admin" && actor.cooperativeId === null) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Assign this Admin to a cooperative before managing payment options." });
      }
      const options = actor.role === "superadmin"
        ? await db.select().from(paymentOptions).orderBy(asc(paymentOptions.displayName))
        : await db.select().from(paymentOptions)
          .where(eq(paymentOptions.cooperativeId, actor.cooperativeId!))
          .orderBy(asc(paymentOptions.displayName));
      return Promise.all(options.map(async ({ qrImagePath, ...option }) => ({
        ...option,
        methodName: option.displayName,
        qrImageUrl: qrImagePath ? (await storageGet(qrImagePath)).url : null,
      })));
    }),
    checkoutOptions: protectedProcedure
      .input(z.object({
        cooperativeId: z.number().int().positive().nullable(),
        productIds: z.array(z.number().int().positive()).min(1).max(50)
          .refine(ids => new Set(ids).size === ids.length, "Product IDs must be unique."),
      }))
      .query(async ({ ctx, input }) => {
        requireOperationalRole(ctx.user, ["buyer", "seller"]);
        const db = await dbOrThrow();
        const basketProducts = await db.select({
          id: products.id,
          cooperativeId: products.cooperativeId,
          status: products.status,
          verificationStatus: products.verificationStatus,
          visibility: products.visibility,
          sellerApprovalStatus: users.approvalStatus,
        }).from(products)
          .innerJoin(users, eq(products.sellerId, users.id))
          .where(inArray(products.id, input.productIds));
        if (basketProducts.length !== input.productIds.length
          || basketProducts.some(product =>
            product.cooperativeId !== input.cooperativeId
            || product.status !== "published"
            || product.verificationStatus !== "approved"
            || product.visibility !== "visible"
            || !isSellerApproved(product.sellerApprovalStatus)
          )) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payment options are unavailable for this checkout basket.",
          });
        }
        const scope = input.cooperativeId === null
          ? isNull(paymentOptions.cooperativeId)
          : eq(paymentOptions.cooperativeId, input.cooperativeId);
        return db.select({
          id: paymentOptions.id,
          cooperativeId: paymentOptions.cooperativeId,
          methodName: paymentOptions.displayName,
          accountName: paymentOptions.accountName,
          accountNumber: paymentOptions.accountNumber,
          qrImagePath: paymentOptions.qrImagePath,
          instructions: paymentOptions.instructions,
        }).from(paymentOptions)
          .where(and(eq(paymentOptions.isActive, true), eq(paymentOptions.paymentMethod, "gcash"), scope))
          .orderBy(asc(paymentOptions.displayName))
          .then(options => Promise.all(options.map(async ({ qrImagePath, ...option }) => ({
            ...option,
            qrImageUrl: qrImagePath ? (await storageGet(qrImagePath)).url : null,
          }))));
      }),
    uploadQrImage: protectedProcedure
      .input(z.object({
        cooperativeId: z.number().int().positive().nullable().optional(),
        fileName: z.string().min(1).max(255),
        contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        base64: z.string().min(1).max(Math.ceil(MAX_PRODUCT_IMAGE_SIZE_BYTES / 3) * 4),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin"]);
        const db = await dbOrThrow();
        const cooperativeId = getPaymentOptionCooperativeId(actor.role, actor.cooperativeId, input.cooperativeId);
        if (cooperativeId !== null) {
          const [cooperative] = await db.select({ id: cooperatives.id })
            .from(cooperatives)
            .where(eq(cooperatives.id, cooperativeId))
            .limit(1);
          if (!cooperative) throw new TRPCError({ code: "NOT_FOUND", message: "The selected cooperative was not found." });
        }
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The selected QR image file is invalid." });
        }
        const bytes = Buffer.from(input.base64, "base64");
        if (!isProductImageSizeAllowed(bytes.length)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "QR images must be 3 MB or less." });
        }
        if (!matchesImageContentTypeSignature(bytes, input.contentType)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The selected file is not a valid image of the declared type." });
        }
        const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "payment-qr";
        const uploaded = await storagePut(
          `${getPaymentQrStoragePrefix(cooperativeId)}${actor.id}/${crypto.randomUUID()}-${safeName}`,
          bytes,
          input.contentType,
        );
        return { url: uploaded.url, path: uploaded.key };
      }),
    createOption: protectedProcedure
      .input(z.object({
        cooperativeId: z.number().int().positive().nullable().optional(),
        methodName: z.string().trim().min(1).max(150),
        accountName: z.string().trim().max(150).optional(),
        accountNumber: z.string().max(100).optional(),
        qrImageUrl: z.string().url().max(1000).refine(value => value.startsWith("https://")).nullable().optional(),
        instructions: z.string().max(5000).optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin"]);
        const db = await dbOrThrow();
        if (actor.role === "admin" && actor.cooperativeId === null) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Assign this Admin to a cooperative before managing payment options." });
        }
        const cooperativeId = getPaymentOptionCooperativeId(actor.role, actor.cooperativeId, input.cooperativeId);
        const qrImagePath = input.qrImageUrl
          ? storageKeyFromPublicUrlWithinPrefix(input.qrImageUrl, getPaymentQrStoragePrefix(cooperativeId))
          : null;
        if (input.qrImageUrl && !qrImagePath) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "QR images must be uploaded to the authorized AgriCoop Storage location." });
        }
        await db.insert(paymentOptions).values({
          cooperativeId,
          paymentMethod: "gcash",
          displayName: input.methodName,
          accountName: input.accountName?.trim() || null,
          accountNumber: input.accountNumber?.trim() || null,
          qrImagePath,
          instructions: input.instructions?.trim() || null,
          isActive: input.isActive ?? true,
          createdBy: actor.id,
        });
        return { success: true };
      }),
    updateOption: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        methodName: z.string().trim().min(1).max(150),
        accountName: z.string().trim().max(150).nullable(),
        accountNumber: z.string().max(100).nullable(),
        qrImageUrl: z.string().url().max(1000).refine(value => value.startsWith("https://")).nullable(),
        instructions: z.string().max(5000).nullable(),
        isActive: z.boolean(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin"]);
        const db = await dbOrThrow();
        if (actor.role === "admin" && actor.cooperativeId === null) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Assign this Admin to a cooperative before managing payment options." });
        }
        let previousPath: string | null = null;
        let cooperativeId: number | null = null;
        await db.transaction(async tx => {
          const scope = actor.role === "superadmin"
            ? eq(paymentOptions.id, input.id)
            : and(eq(paymentOptions.id, input.id), eq(paymentOptions.cooperativeId, actor.cooperativeId!));
          const [previous] = await tx.select().from(paymentOptions)
            .where(scope)
            .limit(1)
            .for("update");
          if (!previous) throw new TRPCError({ code: "NOT_FOUND", message: "Payment option was not found." });
          cooperativeId = previous.cooperativeId;
          previousPath = previous.qrImagePath;
          const nextPath = input.qrImageUrl
            ? storageKeyFromPublicUrlWithinPrefix(input.qrImageUrl, getPaymentQrStoragePrefix(previous.cooperativeId))
            : null;
          if (input.qrImageUrl && !nextPath) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Replacement QR images must be uploaded to the authorized AgriCoop Storage location." });
          }
          const [linkedTransaction] = await tx.select({ id: transactions.id })
            .from(transactions)
            .where(eq(transactions.paymentOptionId, input.id))
            .limit(1);
          const nextDetails = {
            paymentMethod: "gcash",
            displayName: input.methodName,
            accountName: input.accountName?.trim() || null,
            accountNumber: input.accountNumber?.trim() || null,
            qrImagePath: nextPath,
            instructions: input.instructions?.trim() || null,
          };
          if (linkedTransaction && paymentOptionDetailsChanged(previous, nextDetails)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "This payment option is referenced by an order. Deactivate it and create a new option to preserve payment history.",
            });
          }
          const updated = await tx.update(paymentOptions).set({
            ...nextDetails,
            isActive: input.isActive,
            updatedAt: new Date(),
          }).where(scope).returning({ id: paymentOptions.id });
          if (!updated.length) throw new TRPCError({ code: "NOT_FOUND", message: "Payment option was not found." });
          previousPath = previous.qrImagePath === nextPath ? null : previous.qrImagePath;
        });
        let cleanupWarning = false;
        if (previousPath) {
          try {
            const removed = await storageDeleteObject(
              previousPath,
              getPaymentQrStoragePrefix(cooperativeId),
            );
            cleanupWarning = !removed;
          } catch {
            cleanupWarning = true;
            console.error("[payment-options] Previous QR image cleanup failed.");
          }
        }
        return { success: true, cleanupWarning };
      }),
    deleteOption: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin"]);
        const db = await dbOrThrow();
        if (actor.role === "admin" && actor.cooperativeId === null) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Assign this Admin to a cooperative before managing payment options." });
        }
        let targetPath: string | null = null;
        let cooperativeId: number | null = null;
        await db.transaction(async tx => {
          const scope = actor.role === "superadmin"
            ? eq(paymentOptions.id, input.id)
            : and(eq(paymentOptions.id, input.id), eq(paymentOptions.cooperativeId, actor.cooperativeId!));
          const [target] = await tx.select().from(paymentOptions)
            .where(scope)
            .limit(1)
            .for("update");
          if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Payment option was not found." });
          const [linkedTransaction] = await tx.select({ id: transactions.id })
            .from(transactions)
            .where(eq(transactions.paymentOptionId, input.id))
            .limit(1);
          if (linkedTransaction) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "This payment option is referenced by an order and cannot be deleted. Deactivate it instead.",
            });
          }
          const [deleted] = await tx.delete(paymentOptions).where(scope).returning({ id: paymentOptions.id });
          if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Payment option was not found." });
          targetPath = target.qrImagePath;
          cooperativeId = target.cooperativeId;
        });
        let cleanupWarning = false;
        if (targetPath) {
          try {
            const removed = await storageDeleteObject(
              targetPath,
              getPaymentQrStoragePrefix(cooperativeId),
            );
            cleanupWarning = !removed;
          } catch {
            cleanupWarning = true;
            console.error("[payment-options] Deleted option QR image cleanup failed.");
          }
        }
        return { success: true, cleanupWarning };
      }),
  }),

  notifications: router({
    pendingCounts: protectedProcedure.query(({ ctx }) => {
      requireOperationalRole(ctx.user, ["buyer", "seller", "admin", "superadmin"]);
      return getPendingActivityCounts(ctx.user);
    }),
    mine: protectedProcedure.query(async ({ ctx }) => {
      const db = await dbOrThrow();
      return db.select().from(notifications)
        .where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.deletedAt)))
        .orderBy(desc(notifications.createdAt))
        .limit(200);
    }),
    markRead: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      await db.update(notifications).set({ isRead: 1 }).where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.user.id)));
      return { success: true };
    }),
    markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
      const db = await dbOrThrow();
      await db.update(notifications).set({ isRead: 1 })
        .where(and(eq(notifications.userId, ctx.user.id), eq(notifications.isRead, 0), isNull(notifications.deletedAt)));
      return { success: true };
    }),
    setRead: protectedProcedure
      .input(z.object({
        ids: z.array(z.number().int().positive()).min(1).max(100),
        isRead: z.union([z.literal(0), z.literal(1)]),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        const db = await dbOrThrow();
        await db.update(notifications).set({ isRead: input.isRead })
          .where(and(eq(notifications.userId, ctx.user.id), inArray(notifications.id, input.ids), isNull(notifications.deletedAt)));
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) }).strict())
      .mutation(async ({ ctx, input }) => {
        const db = await dbOrThrow();
        await db.update(notifications).set({ deletedAt: new Date() })
          .where(and(eq(notifications.userId, ctx.user.id), inArray(notifications.id, input.ids), isNull(notifications.deletedAt)));
        return { success: true };
      }),
  }),

  auditLogs: router({
    list: protectedProcedure
      .input(z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
        action: z.string().trim().min(1).max(100).optional(),
        entityType: z.string().trim().min(1).max(50).optional(),
        cooperativeId: z.number().int().positive().optional(),
      }).strict().optional())
      .query(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        const limit = input?.limit ?? 50;
        const offset = input?.offset ?? 0;
        const conditions = [];
        if (actor.role === "admin") {
          if (actor.cooperativeId === null) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Assign this Admin to a cooperative before viewing audit logs." });
          }
          conditions.push(eq(auditLogs.cooperativeId, actor.cooperativeId));
        } else if (input?.cooperativeId !== undefined) {
          conditions.push(eq(auditLogs.cooperativeId, input.cooperativeId));
        }
        if (input?.action) conditions.push(eq(auditLogs.action, input.action));
        if (input?.entityType) conditions.push(eq(auditLogs.entityType, input.entityType));
        const where = conditions.length ? and(...conditions) : undefined;
        const rows = await db.select({
          id: auditLogs.id,
          actorUserId: auditLogs.actorUserId,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          cooperativeId: auditLogs.cooperativeId,
          metadata: auditLogs.metadata,
          createdAt: auditLogs.createdAt,
          actorName: users.name,
        }).from(auditLogs)
          .leftJoin(users, eq(auditLogs.actorUserId, users.id))
          .where(where)
          .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
          .limit(limit)
          .offset(offset);
        return { items: rows, limit, offset };
      }),
  }),

  support: router({
    createTicket: protectedProcedure.input(z.object({
      subject: z.string().min(3).max(255),
      category: z.string().min(1),
      description: z.string().min(1),
      priority: z.enum(["low", "medium", "high"]).default("medium"),
      cooperativeId: z.number().int().positive().nullable().optional(),
    }).strict()).mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const activeCooperativeIds = new Set<number>();
      if (input.cooperativeId !== undefined && input.cooperativeId !== null) {
        const activeCooperative = await db.select({ id: cooperatives.id })
          .from(cooperatives)
          .where(and(eq(cooperatives.id, input.cooperativeId), eq(cooperatives.status, "active")))
          .limit(1);
        if (activeCooperative[0]) activeCooperativeIds.add(activeCooperative[0].id);
      }
      let assignedCooperativeId: number | null;
      try {
        assignedCooperativeId = resolveSupportTicketCooperativeId(
          ctx.user.cooperativeId,
          input.cooperativeId,
          activeCooperativeIds,
        );
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "The selected support queue is unavailable.",
        });
      }
      return db.transaction(async tx => {
        const [ticket] = await tx.insert(supportTickets).values({
          subject: input.subject,
          category: input.category,
          description: input.description,
          priority: input.priority,
          userId: ctx.user.id,
          cooperativeId: assignedCooperativeId,
        }).returning({ id: supportTickets.id });
        if (!ticket) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The support ticket was not saved." });
        await tx.insert(supportTicketMessages).values({
          ticketId: ticket.id,
          senderId: ctx.user.id,
          body: input.description,
        });
        await recordAuditLog(tx, {
          actorUserId: ctx.user.id,
          action: "support_ticket_created",
          entityType: "support_ticket",
          entityId: ticket.id,
          cooperativeId: assignedCooperativeId,
          metadata: { category: input.category, priority: input.priority },
        });
        const recipients = assignedCooperativeId === null
          ? await tx.select({ id: users.id }).from(users)
            .where(and(eq(users.role, "superadmin"), eq(users.approvalStatus, "approved")))
          : await tx.select({ id: users.id }).from(users).where(and(
            eq(users.role, "admin"),
            eq(users.cooperativeId, assignedCooperativeId),
            eq(users.approvalStatus, "approved"),
          ));
        for (const recipient of recipients) {
          await createNotification(tx, {
            userId: recipient.id,
            type: "support_ticket_created",
            title: "New support ticket",
            content: "A member opened a support ticket in your scope.",
            link: "/support-tickets",
            relatedEntityId: ticket.id,
            relatedEntityType: "support_ticket",
          });
        }
        return { success: true, ticketId: ticket.id };
      });
    }),
    myTickets: protectedProcedure
      .input(z.object({ archived: z.boolean().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const db = await dbOrThrow();
        const archived = input?.archived ?? false;
        const rows = await db.select({
          ticket: supportTickets,
          stateIsRead: threadStates.isRead,
          statePinnedAt: threadStates.pinnedAt,
          stateArchivedAt: threadStates.archivedAt,
        }).from(supportTickets)
          .leftJoin(threadStates, and(
            eq(threadStates.userId, ctx.user.id),
            eq(threadStates.channel, "ticket"),
            eq(threadStates.threadId, supportTickets.id),
          ))
          .where(and(
            eq(supportTickets.userId, ctx.user.id),
            archived ? sql`${threadStates.archivedAt} is not null` : and(isNull(threadStates.archivedAt), isNull(threadStates.deletedAt)),
          ))
          .orderBy(desc(threadStates.pinnedAt), desc(supportTickets.createdAt));
        return rows.map(row => ({
          ...row.ticket,
          inbox: {
            isRead: row.stateIsRead === null ? 1 : row.stateIsRead,
            pinnedAt: row.statePinnedAt,
            archivedAt: row.stateArchivedAt,
          },
        }));
      }),
    listAll: protectedProcedure
      .input(z.object({ archived: z.boolean().optional() }).optional())
      .query(async ({ ctx, input }) => {
      const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
      const db = await dbOrThrow();
      const archived = input?.archived ?? false;
      const rows = await db.select({
        ticket: supportTickets,
        userName: users.name,
        stateIsRead: threadStates.isRead,
        statePinnedAt: threadStates.pinnedAt,
        stateArchivedAt: threadStates.archivedAt,
      }).from(supportTickets)
        .innerJoin(users, eq(supportTickets.userId, users.id))
        .leftJoin(threadStates, and(
          eq(threadStates.userId, ctx.user.id),
          eq(threadStates.channel, "ticket"),
          eq(threadStates.threadId, supportTickets.id),
        ))
        .where(and(
          archived ? sql`${threadStates.archivedAt} is not null` : and(isNull(threadStates.archivedAt), isNull(threadStates.deletedAt)),
          actor.role === "superadmin" ? undefined : eq(supportTickets.cooperativeId, actor.cooperativeId!),
        ))
        .orderBy(desc(threadStates.pinnedAt), desc(supportTickets.createdAt));
      const assignedIds = Array.from(new Set(rows.flatMap(({ ticket }) => ticket.assignedToUserId === null ? [] : [ticket.assignedToUserId])));
      const assignees = assignedIds.length
        ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, assignedIds))
        : [];
      const assigneeNames = new Map(assignees.map(assignee => [assignee.id, assignee.name]));
      return rows.map(({ ticket, userName, stateIsRead, statePinnedAt, stateArchivedAt }) => ({
        ticket,
        userName,
        assignedToName: ticket.assignedToUserId === null ? null : assigneeNames.get(ticket.assignedToUserId) ?? null,
        inbox: {
          isRead: stateIsRead === null ? 1 : stateIsRead,
          pinnedAt: statePinnedAt,
          archivedAt: stateArchivedAt,
        },
      }));
    }),
    bulkUpdate: protectedProcedure
      .input(z.object({
        ticketIds: z.array(z.number().int().positive()).min(1).max(100),
        action: z.enum(["read", "unread", "pin", "unpin", "archive", "unarchive", "delete", "restore"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await dbOrThrow();
        const now = new Date();
        for (const ticketId of input.ticketIds) {
          const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1);
          if (!ticket) continue;
          const isOwner = ticket.userId === ctx.user.id;
          const isStaff = ctx.user.role === "admin" || ctx.user.role === "superadmin";
          if (!isOwner && !isStaff) continue;
          if (isStaff && !isOwner && !canAccessSupportTicket(ctx.user, ticket)) continue;
          // Per-user inbox state — never mutates another participant's view.
          const [existing] = await db.select().from(threadStates).where(and(
            eq(threadStates.userId, ctx.user.id),
            eq(threadStates.channel, "ticket"),
            eq(threadStates.threadId, ticketId),
          )).limit(1);
          const patch: Partial<typeof threadStates.$inferInsert> = { updatedAt: now };
          if (input.action === "read") patch.isRead = 1;
          if (input.action === "unread") patch.isRead = 0;
          if (input.action === "pin") patch.pinnedAt = now;
          if (input.action === "unpin") patch.pinnedAt = null;
          if (input.action === "archive") patch.archivedAt = now;
          if (input.action === "unarchive") patch.archivedAt = null;
          if (input.action === "delete") patch.deletedAt = now;
          if (input.action === "restore") { patch.deletedAt = null; patch.archivedAt = null; }
          if (existing) await db.update(threadStates).set(patch).where(eq(threadStates.id, existing.id));
          else {
            await db.insert(threadStates).values({
              userId: ctx.user.id,
              channel: "ticket",
              threadId: ticketId,
              isRead: patch.isRead ?? 1,
              pinnedAt: patch.pinnedAt ?? null,
              archivedAt: patch.archivedAt ?? null,
              deletedAt: patch.deletedAt ?? null,
            });
          }
        }
        return { success: true };
      }),
    assignableUsers: protectedProcedure
      .input(z.object({ ticketId: z.number().int().positive() }).strict())
      .query(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        const [ticket] = await db.select({
          userId: supportTickets.userId,
          cooperativeId: supportTickets.cooperativeId,
        }).from(supportTickets)
          .where(eq(supportTickets.id, input.ticketId))
          .limit(1);
        if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "Support ticket not found." });
        if (!canAccessSupportTicket(actor, ticket)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You cannot assign this support ticket." });
        }
        const staffScope = ticket.cooperativeId === null
          ? eq(users.role, "superadmin")
          : actor.role === "superadmin"
            ? or(
              eq(users.role, "superadmin"),
              and(eq(users.role, "admin"), eq(users.cooperativeId, ticket.cooperativeId)),
            )
            : and(eq(users.role, "admin"), eq(users.cooperativeId, actor.cooperativeId!));
        return db.select({
          id: users.id,
          name: users.name,
          role: users.role,
          cooperativeId: users.cooperativeId,
        }).from(users)
          .where(and(eq(users.approvalStatus, "approved"), staffScope))
          .orderBy(asc(users.name));
      }),
    assign: protectedProcedure
      .input(z.object({
        ticketId: z.number().int().positive(),
        assignedToUserId: z.number().int().positive().nullable(),
      }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        return db.transaction(async tx => {
          const [ticket] = await tx.select({
            id: supportTickets.id,
            userId: supportTickets.userId,
            cooperativeId: supportTickets.cooperativeId,
            assignedToUserId: supportTickets.assignedToUserId,
          }).from(supportTickets)
            .where(eq(supportTickets.id, input.ticketId))
            .for("update")
            .limit(1);
          if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "Support ticket not found." });
          if (!canAccessSupportTicket(actor, ticket)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You cannot assign this support ticket." });
          }
          const target = input.assignedToUserId === null
            ? null
            : (await tx.select({
              id: users.id,
              role: users.role,
              cooperativeId: users.cooperativeId,
              approvalStatus: users.approvalStatus,
            }).from(users)
              .where(eq(users.id, input.assignedToUserId))
              .limit(1)
              .for("update"))[0] ?? null;
          if (input.assignedToUserId !== null && !target) {
            throw new TRPCError({ code: "NOT_FOUND", message: "The selected support assignee is unavailable." });
          }
          if (!canAssignSupportTicket(actor, ticket, target)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "The selected support assignee is outside this ticket's authorized scope." });
          }
          if (ticket.assignedToUserId === input.assignedToUserId) return { success: true };
          await tx.update(supportTickets)
            .set({ assignedToUserId: input.assignedToUserId, updatedAt: new Date() })
            .where(eq(supportTickets.id, ticket.id));
          await recordAuditLog(tx, {
            actorUserId: actor.id,
            action: "support_ticket_assigned",
            entityType: "support_ticket",
            entityId: ticket.id,
            cooperativeId: ticket.cooperativeId,
            metadata: { from: ticket.assignedToUserId, to: input.assignedToUserId },
          });
          if (input.assignedToUserId !== null) {
            await createNotification(tx, {
              userId: input.assignedToUserId,
              type: "support_ticket_assigned",
              title: "Support ticket assigned",
              content: "A support ticket has been assigned to you.",
              link: "/support-tickets",
              relatedEntityId: ticket.id,
              relatedEntityType: "support_ticket",
            });
          }
          return { success: true };
        });
      }),
    messages: protectedProcedure
      .input(z.object({ ticketId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const actor = ctx.user;
        if (actor.role === "admin" || actor.role === "superadmin") {
          requireOperationalRole(actor, ["admin", "superadmin"]);
        }
        const db = await dbOrThrow();
        const [ticket] = await db.select({
          id: supportTickets.id,
          userId: supportTickets.userId,
          cooperativeId: supportTickets.cooperativeId,
        }).from(supportTickets).where(eq(supportTickets.id, input.ticketId)).limit(1);
        if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "Support ticket not found." });
        if (!canAccessSupportTicket(actor, ticket)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You cannot access this support ticket." });
        }
        return db.select({
          message: supportTicketMessages,
          senderName: users.name,
        }).from(supportTicketMessages)
          .innerJoin(users, eq(supportTicketMessages.senderId, users.id))
          .where(eq(supportTicketMessages.ticketId, ticket.id))
          .orderBy(asc(supportTicketMessages.createdAt), asc(supportTicketMessages.id));
      }),
    reply: protectedProcedure
      .input(z.object({ ticketId: z.number().int().positive(), body: z.string().trim().min(1).max(2000) }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = ctx.user;
        if (actor.role === "admin" || actor.role === "superadmin") {
          requireOperationalRole(actor, ["admin", "superadmin"]);
        }
        const db = await dbOrThrow();
        return db.transaction(async tx => {
          const [ticket] = await tx.select({
            id: supportTickets.id,
            userId: supportTickets.userId,
            cooperativeId: supportTickets.cooperativeId,
            status: supportTickets.status,
          }).from(supportTickets)
            .where(eq(supportTickets.id, input.ticketId))
            .for("update")
            .limit(1);
          if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "Support ticket not found." });
          if (!canAccessSupportTicket(actor, ticket)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You cannot reply to this support ticket." });
          }
          const currentStatus = supportTicketStatusSchema.safeParse(ticket.status);
          if (!currentStatus.success) throw new TRPCError({ code: "CONFLICT", message: "This ticket has an unsupported status and cannot be changed." });
          const nextStatus = supportTicketStatusAfterReply(currentStatus.data, actor.role);
          if (!nextStatus) throw new TRPCError({ code: "CONFLICT", message: "This support ticket is closed." });
          await tx.insert(supportTicketMessages).values({
            ticketId: ticket.id,
            senderId: actor.id,
            body: input.body,
          });
          if (nextStatus !== ticket.status) {
            await tx.update(supportTickets).set({ status: nextStatus, updatedAt: new Date() }).where(eq(supportTickets.id, ticket.id));
          }
          await recordAuditLog(tx, {
            actorUserId: actor.id,
            action: "support_ticket_reply_sent",
            entityType: "support_ticket",
            entityId: ticket.id,
            cooperativeId: ticket.cooperativeId,
          });
          if (actor.role === "admin" || actor.role === "superadmin") {
            await createNotification(tx, {
              userId: ticket.userId,
              type: "support_ticket_reply",
              title: "Support replied to your ticket",
              content: "An AgriCoop administrator replied to your support ticket.",
              link: "/support-tickets",
              relatedEntityId: ticket.id,
              relatedEntityType: "support_ticket",
            });
          } else {
            const recipients = ticket.cooperativeId === null
              ? await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "superadmin"), eq(users.approvalStatus, "approved")))
              : await tx.select({ id: users.id }).from(users).where(and(
                eq(users.role, "admin"),
                eq(users.cooperativeId, ticket.cooperativeId),
                eq(users.approvalStatus, "approved"),
              ));
            for (const recipient of recipients) {
              await createNotification(tx, {
                userId: recipient.id,
                type: "support_ticket_reply",
                title: "New support ticket reply",
                content: "A member replied to a support ticket in your scope.",
                link: "/support-tickets",
                relatedEntityId: ticket.id,
                relatedEntityType: "support_ticket",
              });
            }
          }
          return { success: true, status: nextStatus };
        });
      }),
    updateStatus: protectedProcedure
      .input(z.object({
        ticketId: z.number().int().positive(),
        status: supportTicketStatusSchema,
      }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
        const db = await dbOrThrow();
        return db.transaction(async tx => {
          const [ticket] = await tx.select({
            id: supportTickets.id,
            userId: supportTickets.userId,
            cooperativeId: supportTickets.cooperativeId,
            status: supportTickets.status,
          }).from(supportTickets)
            .where(eq(supportTickets.id, input.ticketId))
            .for("update")
            .limit(1);
          if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "Support ticket not found." });
          if (!canAccessSupportTicket(actor, ticket)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You cannot update this support ticket." });
          }
          const currentStatus = supportTicketStatusSchema.safeParse(ticket.status);
          if (!currentStatus.success) throw new TRPCError({ code: "CONFLICT", message: "This ticket has an unsupported status and cannot be changed." });
          if (!canTransitionSupportTicketStatus(currentStatus.data, input.status)) {
            throw new TRPCError({ code: "CONFLICT", message: `Cannot change a ${formatEnumLabel(currentStatus.data)} ticket to ${formatEnumLabel(input.status)}.` });
          }
          const updated = await tx.update(supportTickets)
            .set({ status: input.status, updatedAt: new Date() })
            .where(and(eq(supportTickets.id, ticket.id), eq(supportTickets.status, currentStatus.data)))
            .returning({ id: supportTickets.id });
          if (updated.length !== 1) {
            throw new TRPCError({ code: "CONFLICT", message: "This ticket changed while its status was being updated." });
          }
          await recordAuditLog(tx, {
            actorUserId: actor.id,
            action: "support_ticket_status_updated",
            entityType: "support_ticket",
            entityId: ticket.id,
            cooperativeId: ticket.cooperativeId,
            metadata: { from: currentStatus.data, to: input.status },
          });
          await createNotification(tx, {
            userId: ticket.userId,
            type: "support_ticket_status",
            title: "Support ticket updated",
            content: `Your support ticket is now ${formatEnumLabel(input.status)}.`,
            link: "/support-tickets",
            relatedEntityId: ticket.id,
            relatedEntityType: "support_ticket",
          });
          return { success: true };
        });
      }),
  }),
});

export type AppRouter = typeof appRouter;
