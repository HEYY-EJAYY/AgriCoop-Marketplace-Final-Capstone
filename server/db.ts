import { AsyncLocalStorage } from "node:async_hooks";
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  cooperativeAssociationRequests,
  cooperatives,
  conversationMessages,
  conversations,
  type InsertUser,
  orderEvents,
  orderHistory,
  orderItems,
  orders,
  paymentProofs,
  paymentEvents,
  paymentOptions,
  payments,
  profiles,
  productImages,
  products,
  quotations,
  roles,
  supportTicketMessages,
  supportTickets,
  threadStates,
  transactions,
  users,
} from "../drizzle/pg-schema";
import { availableStockAfterReservations, productPurchaseBlockReason } from "./marketplaceRules";
import { getSystemPaymentAvailability } from "./systemPayment";
import {
  RegistrationRateLimitError,
  registrationRateLimiter,
  requestedRoleFromAuthMetadata,
} from "./registration";
import {
  applicationRoleToPublicRoleName,
  matchesPublicRegistrationIdentity,
  resolveAuthIdentityMapping,
  resolvePublicRegistrationIdentity,
  resolveRegistrationIntent,
  type RegistrationIntent,
} from "./authIdentity";

function createDb(url: string | undefined) {
  if (!url) return null;
  const client = postgres(url, {
    connect_timeout: 10,
    idle_timeout: 20,
    // Serverless: one connection per isolate; rely on Supabase pooler for concurrency.
    max: 1,
    prepare: false,
  });
  return drizzle(client, { schema: {
    cooperativeAssociationRequests,
    cooperatives,
    conversationMessages,
    conversations,
    orderEvents,
    orderItems,
    orders,
    paymentProofs,
    paymentEvents,
    paymentOptions,
    payments,
    profiles,
    productImages,
    products,
    quotations,
    roles,
    supportTicketMessages,
    supportTickets,
    transactions,
    users,
  } });
}

const _db = createDb(process.env.DATABASE_URL);
type RootDb = NonNullable<typeof _db>;
type RootTransaction = Parameters<Parameters<RootDb["transaction"]>[0]>[0];
const requestDatabase = new AsyncLocalStorage<RootTransaction>();
let _seedDb: RootDb | null | undefined;

export function buildRequestDatabaseClaims(authUserId: string | null) {
  const role = authUserId ? "authenticated" : "anon";
  const claims = JSON.stringify(authUserId
    ? { aud: "authenticated", role, sub: authUserId }
    : { role: "anon" });
  return { role, claims, subject: authUserId ?? "" };
}

type RequestScopeExecutor = {
  execute: (query: SQL) => Promise<unknown>;
};

async function inDatabasePhase<T>(phase: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    const error = new Error(`Request database operation failed during ${phase}.`);
    Object.assign(error, { cause, databasePhase: phase });
    throw error;
  }
}

export async function applyRequestDatabaseSettings(
  tx: RequestScopeExecutor,
  authUserId: string | null,
) {
  const { role, claims, subject } = buildRequestDatabaseClaims(authUserId);
  // set_config('role', ...) alone does not change privilege checks. Column-level
  // GRANTs for authenticated/anon only apply after SET LOCAL ROLE. Without it,
  // registration INSERT fails with "permission denied for table users" while
  // marketplace SELECTs still work under the login role's broader grants.
  const localRole = role === "authenticated" ? "authenticated" : "anon";
  await inDatabasePhase("request_role_switch", () =>
    tx.execute(sql`select set_config('role', ${role}, true)`));
  await inDatabasePhase("request_set_local_role", () =>
    tx.execute(sql.raw(`set local role ${localRole}`)));
  await inDatabasePhase("request_search_path", () =>
    tx.execute(sql`select set_config('search_path', 'public, agricoop_app', true)`));
  await inDatabasePhase("request_jwt_claims", () =>
    tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`));
  await inDatabasePhase("request_jwt_subject", () =>
    tx.execute(sql`select set_config('request.jwt.claim.sub', ${subject}, true)`));
}

export async function getAdminDb() {
  _seedDb ??= createDb(process.env.SEED_DATABASE_URL);
  return _seedDb;
}

/** Lightweight connectivity probe without request-scoped RLS GUC setup. */
export async function pingDatabase() {
  if (!_db) throw new Error("DATABASE_URL is required for application database access.");
  await _db.execute(sql`select 1`);
}

export async function getDb(): Promise<RootTransaction> {
  const db = requestDatabase.getStore();
  if (!db) throw new Error("A request-scoped PostgreSQL transaction is required.");
  return db;
}

export async function withRequestDatabaseScope<T>(
  authUserId: string | null,
  callback: () => Promise<T>,
): Promise<T> {
  if (!_db) throw new Error("DATABASE_URL is required for application database access.");
  return _db.transaction(async tx => {
    await applyRequestDatabaseSettings(tx, authUserId);
    return requestDatabase.run(tx, callback);
  });
}

export function buildUserUpsertPlan(
  user: InsertUser,
  options?: { intent?: RegistrationIntent },
) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const intent = options?.intent
    ?? (user.role === "seller"
      ? "seller"
      : user.requestedRole === "admin"
        ? "cooperative_admin"
        : "buyer");
  const resolved = resolveRegistrationIntent(intent);
  if (
    user.role !== resolved.applicationRole
    || user.approvalStatus !== resolved.approvalStatus
    || (resolved.requestedRole && user.requestedRole !== resolved.requestedRole)
    || (!resolved.requestedRole && user.requestedRole)
  ) {
    throw new Error("User upsert requires a verified public registration identity.");
  }
  // RLS agricoop_auth_users_self_insert requires cooperativeId IS NULL on INSERT.
  // Cooperative is linked afterward via GUC-gated UPDATE (BLOCK 23).
  if (user.cooperativeId != null) {
    throw new Error("Registration must insert users with cooperativeId null; assign afterward.");
  }

  const now = new Date();
  const values: InsertUser = {
    openId: user.openId,
    role: resolved.applicationRole,
    approvalStatus: resolved.approvalStatus,
    cooperativeId: null,
    requestedRole: resolved.requestedRole ?? null,
    lastSignedIn: now,
  };
  const updateSet: Partial<InsertUser> = { lastSignedIn: now };
  if (user.name !== undefined) values.name = updateSet.name = user.name ?? null;
  if (user.email !== undefined) values.email = updateSet.email = user.email ?? null;
  if (user.loginMethod !== undefined) values.loginMethod = updateSet.loginMethod = user.loginMethod ?? null;
  if (user.profileImageUrl !== undefined) values.profileImageUrl = updateSet.profileImageUrl = user.profileImageUrl ?? null;
  if (user.birthdate !== undefined) values.birthdate = updateSet.birthdate = user.birthdate ?? null;
  if (user.phone !== undefined) values.phone = updateSet.phone = user.phone ?? null;
  if (user.address !== undefined) values.address = updateSet.address = user.address ?? null;
  const identity = {
    publicRoleName: resolved.publicRoleNameForProfile,
    applicationRole: resolved.applicationRole as "buyer" | "seller",
    approvalStatus: resolved.approvalStatus as "approved" | "pending",
    registrationChoice: intent === "cooperative_admin" ? "coop_admin" as const
      : intent === "seller" ? "seller" as const
      : "buyer" as const,
  };
  return { values, updateSet, identity, intent };
}

export async function upsertUser(
  user: InsertUser,
  executor?: RootDb | RootTransaction,
  options?: { intent?: RegistrationIntent },
): Promise<void> {
  const db = executor ?? await getDb();
  const plan = buildUserUpsertPlan(user, options);
  // Explicit column list only: Drizzle's full-table insert lists every users column
  // (including onlinePayment* as DEFAULT). BLOCK 17 revoked authenticated INSERT on
  // those payment columns, so the expanded insert raises 42501 and registration fails.
  const rows = await db.execute(sql`
    insert into agricoop_app.users (
      "openId", name, email, "loginMethod", role, "requestedRole", "approvalStatus", "cooperativeId", "lastSignedIn"
    ) values (
      ${plan.values.openId},
      ${plan.values.name ?? null},
      ${plan.values.email ?? null},
      ${plan.values.loginMethod ?? null},
      ${plan.values.role}::agricoop_app.user_role,
      ${plan.values.requestedRole
        ? sql`${plan.values.requestedRole}::agricoop_app.user_role`
        : sql`null`},
      ${plan.values.approvalStatus}::agricoop_app.user_approval_status,
      ${plan.values.cooperativeId ?? null},
      ${(plan.values.lastSignedIn instanceof Date
        ? plan.values.lastSignedIn
        : new Date(plan.values.lastSignedIn ?? Date.now())).toISOString()}::timestamp
    )
    on conflict ("openId") do update set
      name = coalesce(excluded.name, agricoop_app.users.name),
      email = coalesce(excluded.email, agricoop_app.users.email),
      "loginMethod" = coalesce(excluded."loginMethod", agricoop_app.users."loginMethod"),
      "lastSignedIn" = excluded."lastSignedIn"
    returning role, "approvalStatus", "cooperativeId", "requestedRole"
  `);
  const persisted = (rows as unknown as Array<{
    role: "buyer" | "seller" | "admin" | "superadmin";
    approvalStatus: "approved" | "pending" | "suspended";
    cooperativeId: number | null;
    requestedRole: "buyer" | "seller" | "admin" | "superadmin" | null;
  }>)[0];
  if (!persisted || !matchesPublicRegistrationIdentity(persisted, plan.identity)) {
    throw new Error("Existing application role or approval status conflicts with the canonical public role.");
  }
}

export function legacyPaymentStatusFromOrder(paymentStatus: string | null | undefined) {
  if (paymentStatus === "cancelled") return "cancelled" as const;
  if (paymentStatus === "refunded") return "refunded" as const;
  if (paymentStatus === "failed") return "failed" as const;
  return "pending" as const;
}

export async function ensureOrderPaymentRecord(
  db: any,
  order: {
    id: number;
    buyerId: number;
    sellerId: number;
    cooperativeId: number | null;
    totalCents: number;
    paymentMethod?: string | null;
    paymentStatus?: string | null;
    paymentOptionId?: number | null;
  },
  actorUserId: number,
) {
  if (!db) return null;
  const [existing] = await db.select().from(payments).where(eq(payments.orderId, order.id)).limit(1);
  if (existing) return existing;

  const paymentMethod = order.paymentMethod ?? "f2f";
  const status = legacyPaymentStatusFromOrder(order.paymentStatus);
  const [paymentRow] = await db.insert(payments).values({
    orderId: order.id,
    buyerId: order.buyerId,
    sellerId: order.sellerId,
    cooperativeId: order.cooperativeId,
    amountCents: order.totalCents,
    paymentMethod,
    paymentOptionId: order.paymentOptionId ?? null,
    status,
  }).returning({ id: payments.id });

  await db.insert(paymentEvents).values({
    paymentId: paymentRow.id,
    actorUserId,
    eventType: "created",
    fromStatus: null,
    toStatus: status,
    reason: "order_created",
    metadata: JSON.stringify({ orderId: order.id, paymentMethod, amountCents: order.totalCents }),
  });

  return db.select().from(payments).where(eq(payments.id, paymentRow.id)).limit(1).then((rows: any[]) => rows[0]);
}

async function loadAuthIdentityRecords(authUserId: string) {
  const db = await getDb();
  const applicationUsers = await inDatabasePhase("application_user_lookup", () =>
    db.select({
      id: users.id,
      openId: users.openId,
      name: users.name,
      email: users.email,
      role: users.role,
      requestedRole: users.requestedRole,
      approvalStatus: users.approvalStatus,
      verificationStatus: users.verificationStatus,
      cooperativeId: users.cooperativeId,
      contactNumber: users.contactNumber,
      birthdate: users.birthdate,
      phone: users.phone,
      address: users.address,
      profileImageUrl: users.profileImageUrl,
      deletedAt: users.deletedAt,
      // Intentionally omit seller onlinePayment* columns — BLOCK 17 revoked
      // authenticated/anon SELECT on those fields; selecting them returns 42501
      // and blocks every login after Supabase Auth succeeds.
    }).from(users)
      .where(eq(users.openId, authUserId))
      .limit(2));
  const profileRoles = await inDatabasePhase("canonical_role_lookup", () =>
    db.select({ roleName: roles.roleName })
      .from(profiles)
      .leftJoin(roles, eq(profiles.roleId, roles.roleId))
      .where(eq(profiles.userId, authUserId))
      .limit(2));
  return { applicationUsers, profileRoles };
}

/** Keep public.profiles.role_id aligned with agricoop_app.users.role (operational source of truth). */
export async function syncProfileRoleToApplicationRole(
  authUserId: string,
  applicationRole: "buyer" | "seller" | "admin" | "superadmin",
  executor?: RootDb | RootTransaction,
) {
  const db = executor ?? await getDb();
  const publicRoleName = applicationRoleToPublicRoleName(applicationRole);
  // SECURITY DEFINER helper: public.profiles has no authenticated UPDATE policy/grants.
  await db.execute(sql`
    select agricoop_app.sync_profile_role_from_app(${authUserId}, ${applicationRole})
  `);
  const [roleRow] = await db.select({ roleId: roles.roleId })
    .from(roles)
    .where(eq(roles.roleName, publicRoleName))
    .limit(1);
  if (!roleRow) {
    throw new Error(`Canonical public role "${publicRoleName}" is missing.`);
  }
  return { publicRoleName, roleId: roleRow.roleId };
}

export type VerifiedAuthIdentityContext = {
  email?: string | null;
  name?: string | null;
  userMetadata?: Record<string, unknown> | null;
};

export async function getUserByVerifiedAuthId(
  authUserId: string,
  identityContext?: VerifiedAuthIdentityContext,
) {
  const first = await loadAuthIdentityRecords(authUserId);
  let resolution = resolveAuthIdentityMapping(authUserId, first.applicationUsers, first.profileRoles);
  // Safe self-heal: when exactly one app user and one profile disagree, mirror app role into profiles.
  if (resolution.status === "application_role_mapping_conflict" && first.applicationUsers.length === 1) {
    try {
      await syncProfileRoleToApplicationRole(authUserId, first.applicationUsers[0].role);
      const healed = await loadAuthIdentityRecords(authUserId);
      resolution = resolveAuthIdentityMapping(authUserId, healed.applicationUsers, healed.profileRoles);
      if (resolution.status === "application_user_resolved") {
        console.info("[auth] Self-healed role mapping conflict by syncing profiles to application role", {
          applicationRole: first.applicationUsers[0].role,
        });
      }
    } catch (error) {
      console.error("[auth] Role mapping self-heal failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  // Soft-deleted accounts must not self-heal or resolve to a usable session.
  if (
    resolution.status === "application_user_resolved"
    && first.applicationUsers[0]
    && (first.applicationUsers[0] as { deletedAt?: Date | null }).deletedAt
  ) {
    return { status: "application_user_deleted" as const, user: null };
  }

  if (resolution.status === "application_user_missing") {
    const email = identityContext?.email?.trim().toLowerCase() ?? "";
    // Never revive a soft-deleted account via self-heal.
    if (email) {
      try {
        const db = await getDb();
        const [deleted] = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.email, email), sql`${users.deletedAt} is not null`))
          .limit(1);
        if (deleted) {
          return { status: "application_user_deleted" as const, user: null };
        }
      } catch {
        // Fall through to normal self-heal if the deleted check fails.
      }
    }
    const rateSubject = email || authUserId;
    try {
      registrationRateLimiter.consume("self_heal", undefined, rateSubject);
    } catch (error) {
      if (error instanceof RegistrationRateLimitError) {
        console.warn("[auth] self_heal_application_user rate_limited", {
          authUserPrefix: authUserId.slice(0, 8),
        });
        return resolution;
      }
      throw error;
    }
    try {
      const displayName = identityContext?.name?.trim()
        || identityContext?.email?.split("@")[0]?.trim()
        || "AgriCoop member";
      const requestedRole = requestedRoleFromAuthMetadata(identityContext?.userMetadata ?? undefined);
      await upsertUser({
        openId: authUserId,
        email: email || null,
        name: displayName,
        role: "buyer",
        approvalStatus: "approved",
        cooperativeId: null,
        requestedRole,
        loginMethod: "supabase",
      }, undefined, { intent: "buyer" });
      const db = await getDb();
      const [buyerRole] = await db.select({ roleId: roles.roleId })
        .from(roles)
        .where(eq(roles.roleName, "buyer"))
        .limit(1);
      if (!buyerRole) throw new Error('Canonical public role "buyer" is missing.');
      await db.execute(sql`
        insert into public.profiles (user_id, full_name, email, role_id)
        values (
          ${authUserId}::uuid,
          ${displayName},
          ${email || displayName},
          ${buyerRole.roleId}
        )
        on conflict (user_id) do nothing
      `);
      console.info("[auth] self_heal_application_user", {
        authUserPrefix: authUserId.slice(0, 8),
        requestedRolePresent: Boolean(requestedRole),
      });
      const healed = await loadAuthIdentityRecords(authUserId);
      resolution = resolveAuthIdentityMapping(authUserId, healed.applicationUsers, healed.profileRoles);
    } catch (error) {
      console.error("[auth] self_heal_application_user failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  return resolution;
}

export async function getCooperatives() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(cooperatives).where(and(
    eq(cooperatives.status, "active"),
    isNull(cooperatives.deletedAt),
  )).orderBy(asc(cooperatives.name));
}

export async function getOpenOrderReservationQuantities(db: RootTransaction, productIds: number[]) {
  const reservationsByProduct = new Map<number, number>();
  if (!productIds.length) return reservationsByProduct;
  // SECURITY DEFINER helper: works under anon RLS without SELECT on orders/orderItems.
  const result = await db.execute(sql`
    select product_id, quantity
    from agricoop_app.reserved_quantities_for_products(array[${sql.join(productIds.map(id => sql`${id}`), sql`,`)}]::integer[])
  `);
  for (const row of Array.from(result as unknown as Array<Record<string, unknown>>)) {
    const productId = Number(row.product_id ?? row.productId);
    const quantity = Number(row.quantity ?? 0);
    if (!Number.isFinite(productId)) continue;
    reservationsByProduct.set(productId, (reservationsByProduct.get(productId) ?? 0) + quantity);
  }
  return reservationsByProduct;
}

export async function getMarketplace(category?: string, sort: "asc" | "desc" = "asc") {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(products.status, "published"), eq(products.verificationStatus, "approved"), eq(products.visibility, "visible"), isNull(products.deletedAt), eq(users.approvalStatus, "approved"), isNull(users.deletedAt)];
  if (category && category !== "all") conditions.push(eq(products.category, category));
  const listings = await db
    .select({
      id: products.id,
      sellerId: products.sellerId,
      cooperativeId: products.cooperativeId,
      name: products.name,
      category: products.category,
      variety: products.variety,
      description: products.description,
      unit: products.unit,
      priceCents: products.priceCents,
      stockQty: products.stockQty,
      minOrderQty: products.minOrderQty,
      qualityGrade: products.qualityGrade,
      status: products.status,
      verificationStatus: products.verificationStatus,
      visibility: products.visibility,
      deletedAt: products.deletedAt,
      primaryImageUrl: products.primaryImageUrl,
      allowsPickup: products.allowsPickup,
      allowsDelivery: products.allowsDelivery,
      acceptsOnlinePayment: products.acceptsOnlinePayment,
      sellerName: users.name,
      sellerApprovalStatus: users.approvalStatus,
      sellerDeletedAt: users.deletedAt,
      cooperativeName: cooperatives.name,
      cooperativeNormalizedName: cooperatives.normalizedName,
    })
    .from(products)
    .innerJoin(users, eq(products.sellerId, users.id))
    .leftJoin(cooperatives, eq(products.cooperativeId, cooperatives.id))
    .where(and(...conditions))
    .orderBy(sort === "asc" ? asc(products.priceCents) : desc(products.priceCents));
  const productIds = listings.map(listing => listing.id);
  const [reservations, imageRows] = await Promise.all([
    getOpenOrderReservationQuantities(db, productIds),
    productIds.length
      ? db.select({
          productId: productImages.productId,
          imageUrl: productImages.imageUrl,
        }).from(productImages)
          .where(inArray(productImages.productId, productIds))
          .orderBy(asc(productImages.displayOrder), asc(productImages.id))
      : Promise.resolve([] as Array<{ productId: number; imageUrl: string }>),
  ]);
  const imagesByProduct = new Map<number, string[]>();
  for (const row of imageRows) {
    const urls = imagesByProduct.get(row.productId) ?? [];
    urls.push(row.imageUrl);
    imagesByProduct.set(row.productId, urls);
  }
  const purchasableListings = listings.filter(listing => productPurchaseBlockReason({
    name: listing.name,
    unit: listing.unit,
    status: listing.status,
    verificationStatus: listing.verificationStatus,
    visibility: listing.visibility,
    deletedAt: listing.deletedAt,
    stockQty: availableStockAfterReservations(
      listing.stockQty,
      reservations.get(listing.id) ?? 0,
    ),
    minOrderQty: listing.minOrderQty,
    allowsPickup: listing.allowsPickup,
    allowsDelivery: listing.allowsDelivery,
  }, {
    approvalStatus: listing.sellerApprovalStatus,
    deletedAt: listing.sellerDeletedAt,
  }) === null);
  let onlinePaymentAvailable = false;
  try {
    const availability = await getSystemPaymentAvailability(db);
    onlinePaymentAvailable = availability.onlineEnabled && availability.onlineAccountReady;
  } catch (error) {
    console.error("[marketplace] system payment availability unavailable", error instanceof Error ? error.name : "UnknownError");
  }
  return purchasableListings.map(listing => {
    const storedImages = imagesByProduct.get(listing.id) ?? [];
    const {
      sellerName,
      sellerApprovalStatus,
      sellerDeletedAt,
      cooperativeName,
      cooperativeNormalizedName,
      ...productFields
    } = listing;
    return {
      sellerName,
      cooperativeName,
      cooperativeSlug: cooperativeNormalizedName ?? null,
      onlinePaymentAvailable,
      sellerHasOnlineQr: onlinePaymentAvailable,
      product: {
        ...productFields,
        allowsPickup: listing.allowsPickup ?? true,
        allowsDelivery: listing.allowsDelivery ?? true,
        acceptsOnlinePayment: listing.acceptsOnlinePayment ?? false,
        imageUrls: storedImages.length
          ? storedImages
          : listing.primaryImageUrl ? [listing.primaryImageUrl] : [],
        stockQty: availableStockAfterReservations(
          listing.stockQty,
          reservations.get(listing.id) ?? 0,
        ),
      },
    };
  });
}

export async function getMarketplaceProduct(productId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select({
      product: products,
      sellerName: users.name,
      sellerApprovalStatus: users.approvalStatus,
      sellerDeletedAt: users.deletedAt,
      cooperativeName: cooperatives.name,
    })
    .from(products)
    .innerJoin(users, eq(products.sellerId, users.id))
    .leftJoin(cooperatives, eq(products.cooperativeId, cooperatives.id))
    .where(and(
      eq(products.id, productId),
      eq(products.status, "published"),
      eq(products.verificationStatus, "approved"),
      eq(products.visibility, "visible"),
      isNull(products.deletedAt),
      eq(users.approvalStatus, "approved"),
      isNull(users.deletedAt),
    ))
    .limit(1);
  const listing = rows[0];
  if (!listing) return undefined;
  const imageRows = await db.select().from(productImages)
    .where(eq(productImages.productId, listing.product.id))
    .orderBy(asc(productImages.displayOrder), asc(productImages.id));
  const reservations = await getOpenOrderReservationQuantities(db, [listing.product.id]);
  const stockQty = availableStockAfterReservations(
    listing.product.stockQty,
    reservations.get(listing.product.id) ?? 0,
  );
  if (productPurchaseBlockReason({
    name: listing.product.name,
    unit: listing.product.unit,
    status: listing.product.status,
    verificationStatus: listing.product.verificationStatus,
    visibility: listing.product.visibility,
    deletedAt: listing.product.deletedAt,
    stockQty,
    minOrderQty: listing.product.minOrderQty,
    allowsPickup: listing.product.allowsPickup,
    allowsDelivery: listing.product.allowsDelivery,
  }, {
    approvalStatus: listing.sellerApprovalStatus,
    deletedAt: listing.sellerDeletedAt,
  })) return undefined;
  return {
    ...listing,
    product: {
      ...listing.product,
      imageUrls: imageRows.length
        ? imageRows.map(row => row.imageUrl)
        : listing.product.primaryImageUrl ? [listing.product.primaryImageUrl] : [],
      stockQty,
    },
  };
}

export async function getCategories() {
  const db = await getDb();
  if (!db) return [];
  return db
    .selectDistinct({ category: products.category })
    .from(products)
    .innerJoin(users, eq(products.sellerId, users.id))
    .where(and(
      eq(products.status, "published"),
      eq(products.verificationStatus, "approved"),
      eq(products.visibility, "visible"),
      isNull(products.deletedAt),
      eq(users.approvalStatus, "approved"),
      isNull(users.deletedAt),
    ))
    .orderBy(asc(products.category));
}

export async function getSellerProducts(sellerId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      product: products,
      cooperativeName: cooperatives.name,
    })
    .from(products)
    .leftJoin(cooperatives, eq(products.cooperativeId, cooperatives.id))
    .where(and(eq(products.sellerId, sellerId), isNull(products.deletedAt)))
    .orderBy(desc(products.createdAt));
  if (!rows.length) return [];
  const imageRows = await db.select().from(productImages)
    .where(inArray(productImages.productId, rows.map(row => row.product.id)))
    .orderBy(asc(productImages.displayOrder), asc(productImages.id));
  const imagesByProduct = new Map<number, string[]>();
  for (const row of imageRows) {
    const urls = imagesByProduct.get(row.productId) ?? [];
    urls.push(row.imageUrl);
    imagesByProduct.set(row.productId, urls);
  }
  return rows.map(({ product, cooperativeName }) => {
    const storedImages = imagesByProduct.get(product.id) ?? [];
    return {
      ...product,
      cooperativeName: cooperativeName ?? null,
      imageUrls: storedImages.length
        ? storedImages
        : product.primaryImageUrl ? [product.primaryImageUrl] : [],
    };
  });
}

export type BuyerOrderListOptions = {
  archived?: boolean;
  deleted?: boolean;
};

function inboxVisibility(archived: boolean, deleted: boolean) {
  if (deleted) return sql`${threadStates.deletedAt} is not null`;
  if (archived) return and(sql`${threadStates.archivedAt} is not null`, isNull(threadStates.deletedAt));
  return and(isNull(threadStates.archivedAt), isNull(threadStates.deletedAt));
}

export async function countBuyerOrderInboxStates(buyerId: number) {
  const db = await getDb();
  if (!db) return { active: 0, archived: 0, deleted: 0 };
  const rows = await db
    .select({
      archived: sql<boolean>`${threadStates.archivedAt} is not null`,
      deleted: sql<boolean>`${threadStates.deletedAt} is not null`,
      count: sql<number>`count(*)::int`,
    })
    .from(orders)
    .leftJoin(threadStates, and(
      eq(threadStates.userId, buyerId),
      eq(threadStates.channel, "order"),
      eq(threadStates.threadId, orders.id),
    ))
    .where(eq(orders.buyerId, buyerId))
    .groupBy(sql`${threadStates.archivedAt} is not null`, sql`${threadStates.deletedAt} is not null`);

  let active = 0;
  let archived = 0;
  let deleted = 0;
  for (const row of rows) {
    if (row.deleted) deleted += row.count;
    else if (row.archived) archived += row.count;
    else active += row.count;
  }
  return { active, archived, deleted };
}

export async function countSellerOrderInboxStates(sellerId: number) {
  const db = await getDb();
  if (!db) return { active: 0, archived: 0, deleted: 0 };
  const rows = await db
    .select({
      archived: sql<boolean>`${threadStates.archivedAt} is not null`,
      deleted: sql<boolean>`${threadStates.deletedAt} is not null`,
      count: sql<number>`count(*)::int`,
    })
    .from(orders)
    .leftJoin(threadStates, and(
      eq(threadStates.userId, sellerId),
      eq(threadStates.channel, "order"),
      eq(threadStates.threadId, orders.id),
    ))
    .where(eq(orders.sellerId, sellerId))
    .groupBy(sql`${threadStates.archivedAt} is not null`, sql`${threadStates.deletedAt} is not null`);
  let active = 0;
  let archived = 0;
  let deleted = 0;
  for (const row of rows) {
    if (row.deleted) deleted += row.count;
    else if (row.archived) archived += row.count;
    else active += row.count;
  }
  return { active, archived, deleted };
}

export async function countQuotationInboxStates(userId: number, side: "buyer" | "seller") {
  const db = await getDb();
  if (!db) return { active: 0, archived: 0, deleted: 0 };
  const owner = side === "buyer" ? eq(quotations.buyerId, userId) : eq(quotations.sellerId, userId);
  const rows = await db
    .select({
      archived: sql<boolean>`${threadStates.archivedAt} is not null`,
      deleted: sql<boolean>`${threadStates.deletedAt} is not null`,
      count: sql<number>`count(*)::int`,
    })
    .from(quotations)
    .leftJoin(threadStates, and(
      eq(threadStates.userId, userId),
      eq(threadStates.channel, "support"),
      eq(threadStates.threadId, quotations.id),
    ))
    .where(owner)
    .groupBy(sql`${threadStates.archivedAt} is not null`, sql`${threadStates.deletedAt} is not null`);
  let active = 0;
  let archived = 0;
  let deleted = 0;
  for (const row of rows) {
    if (row.deleted) deleted += row.count;
    else if (row.archived) archived += row.count;
    else active += row.count;
  }
  return { active, archived, deleted };
}

export async function getBuyerOrders(buyerId: number, options: BuyerOrderListOptions = {}) {
  const archived = options.archived ?? false;
  const deleted = options.deleted ?? false;
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      order: orders,
      sellerName: users.name,
      cooperativeName: cooperatives.name,
      archivedAt: threadStates.archivedAt,
    })
    .from(orders)
    .innerJoin(users, eq(orders.sellerId, users.id))
    .leftJoin(cooperatives, eq(orders.cooperativeId, cooperatives.id))
    .leftJoin(threadStates, and(
      eq(threadStates.userId, buyerId),
      eq(threadStates.channel, "order"),
      eq(threadStates.threadId, orders.id),
    ))
    .where(and(
      eq(orders.buyerId, buyerId),
      inboxVisibility(archived, deleted),
    ))
    .orderBy(desc(orders.createdAt));
  if (!rows.length) return [];
  const items = await db
    .select({ item: orderItems, productName: products.name, unit: products.unit })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(inArray(orderItems.orderId, rows.map(row => row.order.id)));
  return rows.map(row => ({
    order: row.order,
    sellerName: row.sellerName,
    cooperativeName: row.cooperativeName,
    archivedAt: row.archivedAt,
    items: items.filter(item => item.item.orderId === row.order.id),
  }));
}

export async function getSellerOrders(sellerId: number, options: BuyerOrderListOptions = {}) {
  const archived = options.archived ?? false;
  const deleted = options.deleted ?? false;
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ order: orders, payment: transactions, item: orderItems, productName: products.name, unit: products.unit, buyerName: users.name })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(products, eq(orderItems.productId, products.id))
    .innerJoin(users, eq(orders.buyerId, users.id))
    .leftJoin(transactions, eq(transactions.orderId, orders.id))
    .leftJoin(threadStates, and(
      eq(threadStates.userId, sellerId),
      eq(threadStates.channel, "order"),
      eq(threadStates.threadId, orders.id),
    ))
    .where(and(
      eq(orders.sellerId, sellerId),
      inboxVisibility(archived, deleted),
    ))
    .orderBy(desc(orders.createdAt));
}

export async function getOrderDetail(orderId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [orderRow] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!orderRow) return undefined;

  const [buyer, seller, cooperativeRows] = await Promise.all([
    db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      contactNumber: users.contactNumber,
      phone: users.phone,
      address: users.address,
    }).from(users).where(eq(users.id, orderRow.buyerId)).limit(1),
    db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      contactNumber: users.contactNumber,
      phone: users.phone,
      address: users.address,
    }).from(users).where(eq(users.id, orderRow.sellerId)).limit(1),
    orderRow.cooperativeId == null
      ? Promise.resolve([] as Array<{ id: number; name: string; location: string; normalizedName: string | null }>)
      : db.select({
          id: cooperatives.id,
          name: cooperatives.name,
          location: cooperatives.location,
          normalizedName: cooperatives.normalizedName,
        }).from(cooperatives).where(eq(cooperatives.id, orderRow.cooperativeId)).limit(1),
  ]);
  const [payment] = await db.select().from(transactions).where(eq(transactions.orderId, orderId)).limit(1);
  const [proof] = await db.select({
    id: paymentProofs.id,
    storagePath: paymentProofs.storagePath,
    verificationStatus: paymentProofs.verificationStatus,
    reviewNote: paymentProofs.reviewNote,
    reviewedAt: paymentProofs.reviewedAt,
    createdAt: paymentProofs.createdAt,
  }).from(paymentProofs)
    .where(eq(paymentProofs.orderId, orderId))
    .orderBy(desc(paymentProofs.createdAt), desc(paymentProofs.id))
    .limit(1);

  const items = await db
    .select({
      item: orderItems,
      productName: products.name,
      unit: products.unit,
      priceCents: products.priceCents,
      stockQty: products.stockQty,
      primaryImageUrl: products.primaryImageUrl,
    })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, orderId));

  const events = await db
    .select({ event: orderEvents, actorName: users.name })
    .from(orderEvents)
    .leftJoin(users, eq(orderEvents.actorUserId, users.id))
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(desc(orderEvents.createdAt));

  const history = await db
    .select({
      id: orderHistory.id,
      eventType: orderHistory.eventType,
      fromValue: orderHistory.fromValue,
      toValue: orderHistory.toValue,
      note: orderHistory.note,
      createdAt: orderHistory.createdAt,
      actorName: users.name,
    })
    .from(orderHistory)
    .leftJoin(users, eq(orderHistory.actorUserId, users.id))
    .where(eq(orderHistory.orderId, orderId))
    .orderBy(asc(orderHistory.createdAt), asc(orderHistory.id));

  const cooperative = cooperativeRows[0]
    ? {
        id: cooperativeRows[0].id,
        name: cooperativeRows[0].name,
        location: cooperativeRows[0].location,
        slug: cooperativeRows[0].normalizedName,
      }
    : null;

  return {
    order: orderRow,
    buyer: buyer[0] ?? null,
    seller: seller[0] ?? null,
    cooperative,
    payment: payment ?? null,
    proof: proof ?? null,
    items,
    events,
    history,
  };
}

export async function getBuyerQuotations(buyerId: number, options: BuyerOrderListOptions = {}) {
  const archived = options.archived ?? false;
  const deleted = options.deleted ?? false;
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ quotation: quotations, productName: products.name, unit: products.unit, sellerName: users.name })
    .from(quotations)
    .innerJoin(products, eq(quotations.productId, products.id))
    .innerJoin(users, eq(quotations.sellerId, users.id))
    .leftJoin(threadStates, and(
      eq(threadStates.userId, buyerId),
      eq(threadStates.channel, "support"),
      eq(threadStates.threadId, quotations.id),
    ))
    .where(and(eq(quotations.buyerId, buyerId), inboxVisibility(archived, deleted)))
    .orderBy(desc(quotations.createdAt));
}

export async function getSellerQuotations(sellerId: number, options: BuyerOrderListOptions = {}) {
  const archived = options.archived ?? false;
  const deleted = options.deleted ?? false;
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ quotation: quotations, productName: products.name, unit: products.unit, buyerName: users.name })
    .from(quotations)
    .innerJoin(products, eq(quotations.productId, products.id))
    .innerJoin(users, eq(quotations.buyerId, users.id))
    .leftJoin(threadStates, and(
      eq(threadStates.userId, sellerId),
      eq(threadStates.channel, "support"),
      eq(threadStates.threadId, quotations.id),
    ))
    .where(and(eq(quotations.sellerId, sellerId), inboxVisibility(archived, deleted)))
    .orderBy(desc(quotations.createdAt));
}

export async function getOfficerOverview(cooperativeId: number | null) {
  const db = await getDb();
  if (!db || !cooperativeId) return { members: [], products: [], orders: [], quotations: [], transactions: [] };
  const members = await db.select({
    id: users.id,
    name: users.name,
    role: users.role,
    approvalStatus: users.approvalStatus,
  }).from(users).where(eq(users.cooperativeId, cooperativeId));
  const listings = await db.select().from(products).where(eq(products.cooperativeId, cooperativeId));
  const orderRows = await db.select().from(orders).where(eq(orders.cooperativeId, cooperativeId)).orderBy(desc(orders.createdAt));
  const quotationRows = await db
    .select({ quotation: quotations, productName: products.name, unit: products.unit, buyerName: users.name })
    .from(quotations)
    .innerJoin(products, eq(quotations.productId, products.id))
    .innerJoin(users, eq(quotations.buyerId, users.id))
    .where(eq(products.cooperativeId, cooperativeId))
    .orderBy(desc(quotations.createdAt));
  const transactionRows = await db
    .select()
    .from(transactions)
    .innerJoin(orders, eq(transactions.orderId, orders.id))
    .where(eq(orders.cooperativeId, cooperativeId));
  return { members, products: listings, orders: orderRows, quotations: quotationRows, transactions: transactionRows };
}

export async function getAdminOverview(cooperativeId?: number | null) {
  const db = await getDb();
  if (!db) return { users: [], cooperatives: [], products: [], orders: [], quotations: [], transactions: [] };
  const scoped = cooperativeId !== undefined;
  const userScope = !scoped ? undefined : cooperativeId === null ? eq(users.id, -1) : eq(users.cooperativeId, cooperativeId);
  const productScope = !scoped
    ? isNull(products.deletedAt)
    : cooperativeId === null
      ? eq(products.id, -1)
      : and(eq(products.cooperativeId, cooperativeId), isNull(products.deletedAt));
  const orderScope = !scoped ? undefined : cooperativeId === null ? eq(orders.id, -1) : eq(orders.cooperativeId, cooperativeId);
  const memberRows = await db
    .select({
      user: {
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        approvalStatus: users.approvalStatus,
        cooperativeId: users.cooperativeId,
        deletedAt: users.deletedAt,
      },
      cooperativeName: cooperatives.name,
    })
    .from(users)
    .leftJoin(cooperatives, eq(users.cooperativeId, cooperatives.id))
    .where(userScope)
    .orderBy(desc(users.createdAt));
  const [cooperativeRows, listingRows, orderRows, quotationRows, transactionRows] = await Promise.all([
    db.select().from(cooperatives).where(!scoped ? undefined : cooperativeId === null ? eq(cooperatives.id, -1) : eq(cooperatives.id, cooperativeId)).orderBy(asc(cooperatives.name)),
    db.select().from(products).where(productScope).orderBy(desc(products.createdAt)),
    db.select().from(orders).where(orderScope).orderBy(desc(orders.createdAt)),
    db.select({ quotation: quotations, unit: products.unit }).from(quotations).innerJoin(products, eq(quotations.productId, products.id)).where(productScope).orderBy(desc(quotations.createdAt)),
    db.select().from(transactions).where(!scoped ? undefined : cooperativeId === null ? eq(transactions.orderId, -1) : inArray(transactions.orderId, db.select({ id: orders.id }).from(orders).where(eq(orders.cooperativeId, cooperativeId)))).orderBy(desc(transactions.completedAt)),
  ]);
  return { users: memberRows, cooperatives: cooperativeRows, products: listingRows, orders: orderRows, quotations: quotationRows, transactions: transactionRows };
}

export async function getProductById(productId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  return rows[0];
}

export type ConversationKindFilter = "messages" | "support" | "all";

function conversationKindCondition(kind: ConversationKindFilter) {
  const isTrade = or(
    sql`${conversations.sellerId} is not null`,
    sql`${conversations.orderId} is not null`,
    sql`${conversations.quotationId} is not null`,
    sql`${conversations.productId} is not null`,
  );
  const isSupport = and(
    isNull(conversations.sellerId),
    isNull(conversations.orderId),
    isNull(conversations.quotationId),
    isNull(conversations.productId),
  );
  if (kind === "messages") return isTrade;
  if (kind === "support") return isSupport;
  return undefined;
}

export async function getConversationsForUser(
  userId: number,
  options: {
    kind?: ConversationKindFilter;
    archived?: boolean;
    /** Only for platform support queues — never for private trade chats. */
    staffSupportQueue?: boolean;
  } = {},
) {
  const db = await getDb();
  if (!db) return [];
  const kind = options.kind ?? "all";
  const archived = options.archived ?? false;
  const kindCondition = conversationKindCondition(kind);

  // Trade messages: participants only. Support: requester, or staff queue for platform threads.
  const visibility = options.staffSupportQueue && kind === "support"
    ? and(isNull(conversations.sellerId), isNull(conversations.orderId), isNull(conversations.quotationId), isNull(conversations.productId))
    : or(eq(conversations.buyerId, userId), eq(conversations.sellerId, userId));

  const rows = await db.select({
    conversation: conversations,
    ownerName: users.name,
    productName: products.name,
    productUnit: products.unit,
    requestedQty: quotations.requestedQty,
    stateIsRead: threadStates.isRead,
    statePinnedAt: threadStates.pinnedAt,
    stateArchivedAt: threadStates.archivedAt,
    stateDeletedAt: threadStates.deletedAt,
  })
    .from(conversations)
    .innerJoin(users, eq(conversations.buyerId, users.id))
    .leftJoin(products, eq(conversations.productId, products.id))
    .leftJoin(quotations, eq(conversations.quotationId, quotations.id))
    .leftJoin(threadStates, and(
      eq(threadStates.userId, userId),
      eq(threadStates.channel, "conversation"),
      eq(threadStates.threadId, conversations.id),
    ))
    .where(and(
      isNull(conversations.deletedAt),
      visibility,
      kindCondition,
      // Per-user archive/delete only (threadStates). Global conversation.deletedAt hides for everyone.
      archived
        ? sql`${threadStates.archivedAt} is not null`
        : and(isNull(threadStates.archivedAt), isNull(threadStates.deletedAt)),
    ))
    .orderBy(desc(threadStates.pinnedAt), desc(conversations.updatedAt));

  return rows.map(row => ({
    conversation: row.conversation,
    ownerName: row.ownerName,
    productName: row.productName,
    productUnit: row.productUnit,
    requestedQty: row.requestedQty,
    inbox: {
      isRead: row.stateIsRead === null ? 1 : row.stateIsRead,
      pinnedAt: row.statePinnedAt,
      archivedAt: row.stateArchivedAt,
      deletedAt: row.stateDeletedAt,
    },
  }));
}

export async function getConversationMessages(conversationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ message: conversationMessages, senderName: users.name })
    .from(conversationMessages)
    .innerJoin(users, eq(conversationMessages.senderId, users.id))
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(asc(conversationMessages.createdAt));
}
