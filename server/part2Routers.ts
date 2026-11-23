import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  cooperativeAdminApplications,
  cooperatives,
  orders,
  quotations,
  roles,
  threadStates,
  users,
} from "../drizzle/pg-schema";
import {
  COOP_ADMIN_APPLICATION_BUCKET,
  COOP_ADMIN_APPLICATION_CONTENT_TYPES,
  COOP_ADMIN_APPLICATION_MAX_BYTES,
} from "../shared/coopAdminApplication";
import { canCreateManagedAccountRole, requireOperationalRole } from "./authz";
import { supabaseAdmin } from "./clients";
import {
  coopAdminApplicationExtension,
  createCoopAdminApplicationUploadIntent,
  isCoopAdminApplicationStorageKey,
  verifyCoopAdminApplicationUploadIntent,
} from "./coopAdminApplication";
import {
  countBuyerOrderInboxStates,
  countQuotationInboxStates,
  countSellerOrderInboxStates,
  getBuyerOrders,
  getBuyerQuotations,
  getDb,
  getSellerOrders,
  getSellerQuotations,
  syncProfileRoleToApplicationRole,
  upsertUser,
  withRequestDatabaseScope,
} from "./db";
import { assertBuyerOwnsOrders } from "./orderArchive";
import { normalizeCooperativeName } from "./cooperativeNames";
import { isDuplicateSignupError, RegistrationRateLimitError, registrationRateLimiter } from "./registration";
import { resolveUserCooperativeSelection, type ResolveUserCooperativeResult } from "./userCooperatives";
import { formatExactDuplicateConflict, formatSimilarMatchesConflict } from "../shared/cooperativeConflicts";
import { protectedProcedure, router } from "./_core/trpc";
import { storageCreateSignedUploadUrl, storageGetSignedUrl } from "./storage";
import { randomUUID } from "node:crypto";

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
  return db;
}

function throwIfCooperativeResolveConflict(
  resolved: ResolveUserCooperativeResult | { kind: "ok_to_create"; normalizedName: string },
) {
  if (resolved.kind === "exact_duplicate") {
    throw new TRPCError({ code: "CONFLICT", message: formatExactDuplicateConflict(resolved.match) });
  }
  if (resolved.kind === "similar_matches") {
    throw new TRPCError({ code: "CONFLICT", message: formatSimilarMatchesConflict(resolved.matches) });
  }
  if (resolved.kind === "needs_confirmation") {
    throw new TRPCError({ code: "CONFLICT", message: formatSimilarMatchesConflict([resolved.suggestion]) });
  }
}

async function recordAuditLog(
  db: Awaited<ReturnType<typeof dbOrThrow>>,
  input: {
    actorUserId: number;
    action: string;
    entityType: string;
    entityId?: number | null;
    cooperativeId?: number | null;
    metadata?: Record<string, unknown>;
  },
) {
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

async function createNotification(
  db: Awaited<ReturnType<typeof dbOrThrow>>,
  input: {
    userId: number;
    type: string;
    title: string;
    content: string;
    link?: string;
    relatedEntityId?: number;
    relatedEntityType?: string;
  },
) {
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

export const officerApplicationsRouter = router({
  mine: protectedProcedure.query(async ({ ctx }) => {
    const actor = requireOperationalRole(ctx.user, ["buyer", "seller", "admin", "superadmin"]);
    const db = await dbOrThrow();
    const rows = await db
      .select({
        application: cooperativeAdminApplications,
        cooperativeName: cooperatives.name,
      })
      .from(cooperativeAdminApplications)
      .innerJoin(cooperatives, eq(cooperativeAdminApplications.cooperativeId, cooperatives.id))
      .where(eq(cooperativeAdminApplications.userId, actor.id))
      .orderBy(desc(cooperativeAdminApplications.updatedAt), desc(cooperativeAdminApplications.id))
      .limit(5);
    return rows[0] ?? null;
  }),

  createUploadIntent: protectedProcedure
    .input(z.object({
      kind: z.enum(["id", "proof"]),
      contentType: z.enum(COOP_ADMIN_APPLICATION_CONTENT_TYPES),
      fileSizeBytes: z.number().int().min(1).max(COOP_ADMIN_APPLICATION_MAX_BYTES),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      const actor = requireOperationalRole(ctx.user, ["buyer"]);
      if (actor.requestedRole !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only Cooperative Admin applicants can upload these documents." });
      }
      if (!actor.openId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Your account identity is incomplete." });
      }
      const openId = actor.openId;
      const extension = coopAdminApplicationExtension(input.contentType);
      if (!extension) throw new TRPCError({ code: "BAD_REQUEST", message: "Use a JPEG, PNG, WebP, or PDF file." });
      // Object key is user-id prefixed inside the private bucket (matches storage RLS).
      const storagePath = `${openId}/${randomUUID()}.${extension}`;
      const signedUpload = await storageCreateSignedUploadUrl(storagePath, COOP_ADMIN_APPLICATION_BUCKET);
      if (signedUpload.path !== storagePath || !isCoopAdminApplicationStorageKey(signedUpload.path, openId)) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Upload path could not be prepared." });
      }
      return {
        storagePath: signedUpload.path,
        uploadToken: signedUpload.token,
        uploadIntent: createCoopAdminApplicationUploadIntent({
          userId: actor.id,
          openId,
          storagePath: signedUpload.path,
          mimeType: input.contentType,
          fileSizeBytes: input.fileSizeBytes,
        }),
      };
    }),

  submit: protectedProcedure
    .input(z.object({
      fullName: z.string().trim().min(2).max(180),
      positionTitle: z.string().trim().min(2).max(180),
      contactNumber: z.string().trim().min(7).max(40),
      idType: z.enum(["national_id", "drivers_license", "passport", "postal_id", "umid", "voters_id", "other"]),
      idNumber: z.string().trim().min(3).max(60),
      consentAccepted: z.literal(true),
      cooperativeId: z.number().int().positive().optional(),
      newCooperativeName: z.string().trim().min(3).max(180).optional(),
      newCooperativeLocation: z.string().trim().min(3).max(180).optional(),
      newCooperativeAddress: z.string().trim().min(3).max(255).optional(),
      confirmSimilarNormalizedName: z.string().trim().min(2).max(180).optional(),
      idDocumentPath: z.string().min(1).max(1000),
      proofDocumentPath: z.string().min(1).max(1000).optional(),
      idUploadIntent: z.string().min(1),
      proofUploadIntent: z.string().min(1).optional(),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      const actor = requireOperationalRole(ctx.user, ["buyer"]);
      if (actor.requestedRole !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "This account is not a Cooperative Admin applicant." });
      }
      if (!actor.openId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Your account identity is incomplete." });
      }
      const openId = actor.openId;
      const rateLimitKey = actor.email ?? openId;
      const idIntent = verifyCoopAdminApplicationUploadIntent(input.idUploadIntent, actor.id, openId);
      const proofIntent = input.proofUploadIntent
        ? verifyCoopAdminApplicationUploadIntent(input.proofUploadIntent, actor.id, openId)
        : null;
      const proofPathOk = !input.proofDocumentPath || (proofIntent && proofIntent.storagePath === input.proofDocumentPath);
      const proofIntentOk = !input.proofUploadIntent || (proofIntent && proofIntent.storagePath === input.proofDocumentPath);
      if (!idIntent || idIntent.storagePath !== input.idDocumentPath
        || !proofPathOk || !proofIntentOk) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Upload intents expired or do not match the files." });
      }

      const db = await dbOrThrow();
      return db.transaction(async tx => {
        let cooperativeId = input.cooperativeId ?? null;
        if (!cooperativeId && input.newCooperativeName) {
          const resolved = await resolveUserCooperativeSelection(tx as any, {
            newCooperativeName: input.newCooperativeName,
            newCooperativeLocation: input.newCooperativeLocation,
            newCooperativeAddress: input.newCooperativeAddress,
            confirmSimilarNormalizedName: input.confirmSimilarNormalizedName,
            rateLimitEmail: rateLimitKey,
            consumeRateLimit: () => {
              try {
                registrationRateLimiter.consume("create_cooperative", undefined, rateLimitKey);
              } catch (error) {
                if (error instanceof RegistrationRateLimitError) {
                  throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: error.message });
                }
                throw error;
              }
            },
          });
          throwIfCooperativeResolveConflict(resolved);
          if (resolved.kind !== "existing" && resolved.kind !== "created") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid cooperative selection." });
          }
          cooperativeId = resolved.cooperativeId;
        }
        if (!cooperativeId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Select or add a cooperative." });
        }
        const [coopRow] = await tx.select({ id: cooperatives.id, status: cooperatives.status })
          .from(cooperatives)
          .where(eq(cooperatives.id, cooperativeId))
          .limit(1);
        if (!coopRow || coopRow.status !== "active") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Select an active cooperative." });
        }

        const existingRows = await tx.select().from(cooperativeAdminApplications)
          .where(and(
            eq(cooperativeAdminApplications.userId, actor.id),
            inArray(cooperativeAdminApplications.status, ["awaiting_documents", "pending", "rejected"]),
          ))
          .orderBy(desc(cooperativeAdminApplications.id));
        const existing = existingRows.find(row => row.status === "pending")
          ?? existingRows.find(row => row.status === "awaiting_documents")
          ?? existingRows[0];
        if (existing?.status === "pending") {
          throw new TRPCError({ code: "CONFLICT", message: "This application is already under review. You cannot change it until a decision is made." });
        }

        let applicationId: number;
        if (existing) {
          const updated = await tx.update(cooperativeAdminApplications).set({
            fullName: input.fullName,
            positionTitle: input.positionTitle,
            contactNumber: input.contactNumber,
            idType: input.idType,
            idNumber: input.idNumber,
            consentAcceptedAt: new Date(),
            cooperativeId,
            idDocumentPath: input.idDocumentPath,
            proofDocumentPath: input.proofDocumentPath ?? null,
            status: "pending",
            rejectionReason: null,
            reviewedBy: null,
            reviewedAt: null,
            updatedAt: new Date(),
          }).where(eq(cooperativeAdminApplications.id, existing.id))
            .returning({ id: cooperativeAdminApplications.id });
          applicationId = updated[0]!.id;
        } else {
          const [created] = await tx.insert(cooperativeAdminApplications).values({
            userId: actor.id,
            fullName: input.fullName,
            positionTitle: input.positionTitle,
            contactNumber: input.contactNumber,
            idType: input.idType,
            idNumber: input.idNumber,
            consentAcceptedAt: new Date(),
            cooperativeId,
            idDocumentPath: input.idDocumentPath,
            proofDocumentPath: input.proofDocumentPath ?? null,
            status: "pending",
          }).returning({ id: cooperativeAdminApplications.id });
          applicationId = created!.id;
        }

        const superadmins = await tx.select({ id: users.id }).from(users).where(and(
          eq(users.role, "superadmin"),
          eq(users.approvalStatus, "approved"),
        ));
        for (const admin of superadmins) {
          await createNotification(tx as any, {
            userId: admin.id,
            type: "cooperative_admin_application_submitted",
            title: "Cooperative Admin application submitted",
            content: `${input.fullName} submitted documents for Cooperative Admin review.`,
            link: "/dashboard?tab=applications",
            relatedEntityId: applicationId,
            relatedEntityType: "cooperative_admin_application",
          });
        }
        await createNotification(tx as any, {
          userId: actor.id,
          type: "cooperative_admin_application_submitted",
          title: "Application submitted",
          content: "Your application is waiting for approval. We will contact you once it is reviewed.",
          link: "/applications/cooperative-admin",
          relatedEntityId: applicationId,
          relatedEntityType: "cooperative_admin_application",
        });
        return { success: true, status: "pending" as const };
      });
    }),

  pendingList: protectedProcedure.query(async ({ ctx }) => {
    requireOperationalRole(ctx.user, ["superadmin"]);
    const db = await dbOrThrow();
    return db
      .select({
        id: cooperativeAdminApplications.id,
        fullName: cooperativeAdminApplications.fullName,
        positionTitle: cooperativeAdminApplications.positionTitle,
        contactNumber: cooperativeAdminApplications.contactNumber,
        idType: cooperativeAdminApplications.idType,
        status: cooperativeAdminApplications.status,
        userId: cooperativeAdminApplications.userId,
        email: users.email,
        cooperativeId: cooperativeAdminApplications.cooperativeId,
        cooperativeName: cooperatives.name,
        createdAt: cooperativeAdminApplications.createdAt,
        updatedAt: cooperativeAdminApplications.updatedAt,
        hasProofDocument: sql<boolean>`${cooperativeAdminApplications.proofDocumentPath} is not null`,
      })
      .from(cooperativeAdminApplications)
      .innerJoin(users, eq(cooperativeAdminApplications.userId, users.id))
      .innerJoin(cooperatives, eq(cooperativeAdminApplications.cooperativeId, cooperatives.id))
      .where(eq(cooperativeAdminApplications.status, "pending"))
      .orderBy(desc(cooperativeAdminApplications.updatedAt));
  }),

  documentUrl: protectedProcedure
    .input(z.object({
      applicationId: z.number().int().positive(),
      kind: z.enum(["id", "proof"]),
    }).strict())
    .query(async ({ ctx, input }) => {
      const actor = requireOperationalRole(ctx.user, ["buyer", "superadmin"]);
      const db = await dbOrThrow();
      const [row] = await db.select({
        application: cooperativeAdminApplications,
        openId: users.openId,
      }).from(cooperativeAdminApplications)
        .innerJoin(users, eq(cooperativeAdminApplications.userId, users.id))
        .where(eq(cooperativeAdminApplications.id, input.applicationId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found." });
      if (actor.role !== "superadmin" && row.application.userId !== actor.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot view these documents." });
      }
      const path = input.kind === "id" ? row.application.idDocumentPath : row.application.proofDocumentPath;
      if (!path || !isCoopAdminApplicationStorageKey(path, row.openId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document is not available." });
      }
      const url = await storageGetSignedUrl(path, {
        bucket: COOP_ADMIN_APPLICATION_BUCKET,
        public: false,
        expiresIn: 300,
      });
      return { url };
    }),

  review: protectedProcedure
    .input(z.object({
      applicationId: z.number().int().positive(),
      decision: z.enum(["approved", "rejected"]),
      rejectionReason: z.string().trim().min(3).max(600).optional(),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      const actor = requireOperationalRole(ctx.user, ["superadmin"]);
      if (input.decision === "rejected" && !input.rejectionReason?.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A rejection reason is required." });
      }
      const db = await dbOrThrow();
      return db.transaction(async tx => {
        const [row] = await tx.select().from(cooperativeAdminApplications)
          .where(eq(cooperativeAdminApplications.id, input.applicationId))
          .for("update")
          .limit(1);
        if (!row || row.status !== "pending") {
          throw new TRPCError({ code: "NOT_FOUND", message: "That application is not awaiting review." });
        }
        if (row.userId === actor.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You cannot review your own application." });
        }
        const [target] = await tx.select({
          id: users.id,
          openId: users.openId,
        }).from(users).where(eq(users.id, row.userId)).limit(1);
        if (!target?.openId) throw new TRPCError({ code: "NOT_FOUND", message: "Applicant account missing." });

        await tx.update(cooperativeAdminApplications).set({
          status: input.decision,
          rejectionReason: input.decision === "rejected" ? input.rejectionReason!.trim() : null,
          reviewedBy: actor.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(cooperativeAdminApplications.id, row.id));

        if (input.decision === "approved") {
          await tx.update(users).set({
            role: "admin",
            approvalStatus: "approved",
            cooperativeId: row.cooperativeId,
            requestedRole: null,
            updatedAt: new Date(),
          }).where(eq(users.id, target.id));
          try {
            await syncProfileRoleToApplicationRole(target.openId, "admin", tx);
          } catch {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Role updated but profile sync failed. Retry from role reconciliation.",
            });
          }
        }

        // write_audit_log allowlist: reuse user_access_updated with application metadata.
        await recordAuditLog(tx as any, {
          actorUserId: actor.id,
          action: "user_access_updated",
          entityType: "cooperative_admin_application",
          entityId: row.id,
          cooperativeId: row.cooperativeId,
          metadata: {
            applicantUserId: row.userId,
            decision: input.decision,
            rejectionReason: input.rejectionReason ?? null,
          },
        });

        await createNotification(tx as any, {
          userId: row.userId,
          type: input.decision === "approved"
            ? "cooperative_admin_application_approved"
            : "cooperative_admin_application_rejected",
          title: input.decision === "approved"
            ? "Cooperative Admin application approved"
            : "Cooperative Admin application needs changes",
          content: input.decision === "approved"
            ? "Your Cooperative Admin (Officer Admin) access is now active."
            : `Your application was rejected. Reason: ${input.rejectionReason}`,
          link: input.decision === "approved" ? "/dashboard" : "/applications/cooperative-admin",
          relatedEntityId: row.id,
          relatedEntityType: "cooperative_admin_application",
        });

        return { success: true };
      });
    }),
});

export const adminAccountsRouter = router({
  createAccount: protectedProcedure
    .input(z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().trim().email().max(320).transform(v => v.toLowerCase()),
      role: z.enum(["buyer", "seller", "admin"]),
      cooperativeId: z.number().int().positive().optional(),
      newCooperativeName: z.string().trim().min(3).max(180).optional(),
      newCooperativeLocation: z.string().trim().min(3).max(180).optional(),
      newCooperativeAddress: z.string().trim().min(3).max(255).optional(),
      confirmSimilarNormalizedName: z.string().trim().min(2).max(180).optional(),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      const actor = requireOperationalRole(ctx.user, ["admin", "superadmin"]);
      if (!canCreateManagedAccountRole(actor.role, input.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: input.role === "admin"
            ? "Only SuperAdmin can create Officer Admin accounts."
            : "You cannot create that account role.",
        });
      }
      const needsCoop = input.role === "seller" || input.role === "admin";
      if (needsCoop && !input.cooperativeId && !input.newCooperativeName) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Seller and Officer Admin accounts require a cooperative." });
      }

      const redirectTo = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/auth`;
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: input.email,
        email_confirm: true,
        user_metadata: { name: input.name, invited_by: actor.id },
      });
      if (error) {
        if (isDuplicateSignupError(error)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "An account with this email already exists.",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unable to create the account. Try again later.",
        });
      }
      const authUser = data.user;
      if (!authUser) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unable to create the account." });
      }

      try {
        await withRequestDatabaseScope(authUser.id, async () => {
          const db = await dbOrThrow();
          let cooperativeId: number | null = null;
          // Must use the request-scoped tx — a second pool checkout deadlocks under max=1.
          await upsertUser({
            openId: authUser.id,
            email: input.email,
            name: input.name,
            role: input.role === "admin" ? "admin" : input.role,
            approvalStatus: input.role === "seller" ? "pending" : "approved",
            cooperativeId: null,
            loginMethod: "supabase",
          } as any, db, input.role === "admin" ? undefined : { intent: input.role });

          // Admin role upsert bypasses public registration plan — write explicitly.
          if (input.role === "admin") {
            await db.execute(sql`
              update agricoop_app.users
              set role = 'admin'::agricoop_app.user_role,
                  "approvalStatus" = 'approved'::agricoop_app.user_approval_status
              where "openId" = ${authUser.id}
            `);
          }

          if (needsCoop) {
            const resolved = await resolveUserCooperativeSelection(db, {
              cooperativeId: input.cooperativeId,
              newCooperativeName: input.newCooperativeName,
              newCooperativeLocation: input.newCooperativeLocation,
              newCooperativeAddress: input.newCooperativeAddress,
              confirmSimilarNormalizedName: input.confirmSimilarNormalizedName,
              rateLimitEmail: input.email,
              consumeRateLimit: () => {
                registrationRateLimiter.consume("create_cooperative", undefined, input.email);
              },
            });
            throwIfCooperativeResolveConflict(resolved);
            if (resolved.kind !== "existing" && resolved.kind !== "created") {
              throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid cooperative selection." });
            }
            cooperativeId = resolved.cooperativeId;
            await db.execute(sql`
              update agricoop_app.users
              set "cooperativeId" = ${cooperativeId}
              where "openId" = ${authUser.id}
            `);
          }

          const publicRoleName = input.role === "admin" ? "coop_officer"
            : input.role === "seller" ? "seller" : "buyer";
          const publicRoles = await db.select({ roleId: roles.roleId, roleName: roles.roleName })
            .from(roles)
            .where(eq(roles.roleName, publicRoleName))
            .limit(2);
          if (publicRoles.length !== 1) throw new Error("Canonical role missing or ambiguous.");
          // Match auth.register: explicit columns only (no ON CONFLICT UPDATE grants needed).
          await db.execute(sql`
            insert into public.profiles (user_id, full_name, email, role_id)
            values (
              ${authUser.id}::uuid,
              ${input.name},
              ${input.email},
              ${publicRoles[0].roleId}
            )
          `);

          const [appUser] = await db.select({ id: users.id }).from(users)
            .where(eq(users.openId, authUser.id)).limit(1);
          if (appUser) {
            await recordAuditLog(db, {
              actorUserId: actor.id,
              action: "user_access_updated",
              entityType: "user",
              entityId: appUser.id,
              cooperativeId,
              metadata: {
                createdByAdmin: true,
                after: { role: input.role, email: input.email, cooperativeId },
              },
            });
          }
        });
      } catch (error) {
        await supabaseAdmin.auth.admin.deleteUser(authUser.id).catch(() => undefined);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Account provisioning failed.",
        });
      }

      // generateLink can hang when Auth/SMTP is degraded — never block provisioning success on it.
      let inviteLink: string | null = null;
      try {
        const linkResult = await Promise.race([
          supabaseAdmin.auth.admin.generateLink({
            type: "recovery",
            email: input.email,
            options: { redirectTo },
          }),
          new Promise<{ data: null; error: { message: string } }>((resolve) =>
            setTimeout(() => resolve({ data: null, error: { message: "invite_link_timeout" } }), 5000),
          ),
        ]);
        const actionLink = linkResult.data && "properties" in linkResult.data
          ? linkResult.data.properties?.action_link
          : null;
        if (!linkResult.error && actionLink) inviteLink = actionLink;
      } catch {
        inviteLink = null;
      }

      // Never log inviteLink. Return it when available so Add account works without SMTP.
      return {
        success: true,
        inviteLink,
      };
    }),
});

export const orderArchiveRouterExtras = {
  buyerMineArchivedCapable: true as const,
};

export async function upsertPerUserThreadState(args: {
  userId: number;
  channel: "conversation" | "ticket" | "support" | "order" | "seller_order" | "quotation";
  threadId: number;
  action: "archive" | "unarchive" | "delete" | "restore";
}) {
  const db = await dbOrThrow();
  const now = new Date();
  const [existing] = await db.select().from(threadStates).where(and(
    eq(threadStates.userId, args.userId),
    eq(threadStates.channel, args.channel),
    eq(threadStates.threadId, args.threadId),
  )).limit(1);
  const patch: {
    archivedAt?: Date | null;
    deletedAt?: Date | null;
    updatedAt: Date;
  } = { updatedAt: now };
  if (args.action === "archive") patch.archivedAt = now;
  if (args.action === "unarchive") patch.archivedAt = null;
  if (args.action === "delete") patch.deletedAt = now;
  if (args.action === "restore") {
    patch.deletedAt = null;
    patch.archivedAt = null;
  }
  if (existing) {
    await db.update(threadStates).set(patch).where(eq(threadStates.id, existing.id));
  } else {
    await db.insert(threadStates).values({
      userId: args.userId,
      channel: args.channel,
      threadId: args.threadId,
      archivedAt: patch.archivedAt ?? null,
      deletedAt: patch.deletedAt ?? null,
    });
  }
}

export const orderArchiveProcedures = {
  buyerMine: protectedProcedure
    .input(z.object({ archived: z.boolean().optional(), deleted: z.boolean().optional() }).optional())
    .query(({ ctx, input }) => {
      requireOperationalRole(ctx.user, ["buyer", "seller"]);
      return getBuyerOrders(ctx.user.id, {
        archived: input?.archived ?? false,
        deleted: input?.deleted ?? false,
      });
    }),
  buyerMineCounts: protectedProcedure.query(({ ctx }) => {
    requireOperationalRole(ctx.user, ["buyer", "seller"]);
    return countBuyerOrderInboxStates(ctx.user.id);
  }),
  updateArchive: protectedProcedure
    .input(z.object({
      orderIds: z.array(z.number().int().positive()).min(1).max(100),
      action: z.enum(["archive", "unarchive", "delete", "restore"]),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      requireOperationalRole(ctx.user, ["buyer", "seller"]);
      const db = await dbOrThrow();
      const owned = await db.select({ id: orders.id }).from(orders).where(and(
        eq(orders.buyerId, ctx.user.id),
        inArray(orders.id, input.orderIds),
      ));
      assertBuyerOwnsOrders(input.orderIds, owned);
      for (const order of owned) {
        await upsertPerUserThreadState({
          userId: ctx.user.id,
          channel: "order",
          threadId: order.id,
          action: input.action,
        });
      }
      return { success: true, count: owned.length };
    }),
  sellerMine: protectedProcedure
    .input(z.object({ archived: z.boolean().optional(), deleted: z.boolean().optional() }).optional())
    .query(({ ctx, input }) => {
      requireOperationalRole(ctx.user, ["seller"]);
      return getSellerOrders(ctx.user.id, {
        archived: input?.archived ?? false,
        deleted: input?.deleted ?? false,
      });
    }),
  sellerMineCounts: protectedProcedure.query(({ ctx }) => {
    requireOperationalRole(ctx.user, ["seller"]);
    return countSellerOrderInboxStates(ctx.user.id);
  }),
  sellerUpdateArchive: protectedProcedure
    .input(z.object({
      orderIds: z.array(z.number().int().positive()).min(1).max(100),
      action: z.enum(["archive", "unarchive", "delete", "restore"]),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      requireOperationalRole(ctx.user, ["seller"]);
      const db = await dbOrThrow();
      const owned = await db.select({ id: orders.id }).from(orders).where(and(
        eq(orders.sellerId, ctx.user.id),
        inArray(orders.id, input.orderIds),
      ));
      if (owned.length !== input.orderIds.length) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only change your own fulfillment queue." });
      }
      for (const order of owned) {
        await upsertPerUserThreadState({
          userId: ctx.user.id,
          channel: "seller_order",
          threadId: order.id,
          action: input.action,
        });
      }
      return { success: true, count: owned.length };
    }),
};

export const quotationArchiveProcedures = {
  buyerMine: protectedProcedure
    .input(z.object({ archived: z.boolean().optional(), deleted: z.boolean().optional() }).optional())
    .query(({ ctx, input }) => {
      requireOperationalRole(ctx.user, ["buyer", "seller"]);
      return getBuyerQuotations(ctx.user.id, {
        archived: input?.archived ?? false,
        deleted: input?.deleted ?? false,
      });
    }),
  sellerMine: protectedProcedure
    .input(z.object({ archived: z.boolean().optional(), deleted: z.boolean().optional() }).optional())
    .query(({ ctx, input }) => {
      requireOperationalRole(ctx.user, ["seller"]);
      return getSellerQuotations(ctx.user.id, {
        archived: input?.archived ?? false,
        deleted: input?.deleted ?? false,
      });
    }),
  counts: protectedProcedure
    .input(z.object({ side: z.enum(["buyer", "seller"]) }))
    .query(({ ctx, input }) => {
      requireOperationalRole(ctx.user, input.side === "buyer" ? ["buyer", "seller"] : ["seller"]);
      return countQuotationInboxStates(ctx.user.id, input.side);
    }),
  updateState: protectedProcedure
    .input(z.object({
      quotationIds: z.array(z.number().int().positive()).min(1).max(100),
      action: z.enum(["archive", "unarchive", "delete", "restore"]),
      side: z.enum(["buyer", "seller"]),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      requireOperationalRole(ctx.user, input.side === "buyer" ? ["buyer", "seller"] : ["seller"]);
      const db = await dbOrThrow();
      const owned = await db.select({ id: quotations.id }).from(quotations).where(and(
        input.side === "buyer" ? eq(quotations.buyerId, ctx.user.id) : eq(quotations.sellerId, ctx.user.id),
        inArray(quotations.id, input.quotationIds),
      ));
      if (owned.length !== input.quotationIds.length) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only change your own quotation requests." });
      }
      for (const row of owned) {
        await upsertPerUserThreadState({
          userId: ctx.user.id,
          channel: "quotation",
          threadId: row.id,
          action: input.action,
        });
      }
      return { success: true, count: owned.length };
    }),
};
