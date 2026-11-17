import { AsyncLocalStorage } from "node:async_hooks";
import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  cooperativeAssociationRequests,
  cooperatives,
  conversationMessages,
  conversations,
  type InsertUser,
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
} from "../drizzle/pg-schema";
import { availableStockAfterReservations } from "./marketplaceRules";
import {
  matchesPublicRegistrationIdentity,
  resolveAuthIdentityMapping,
  resolvePublicRegistrationIdentity,
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
  await inDatabasePhase("request_role_switch", () =>
    tx.execute(sql`select set_config('role', ${role}, true)`));
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

export function buildUserUpsertPlan(user: InsertUser) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const identity = resolvePublicRegistrationIdentity(user.role);
  if (!identity
    || user.approvalStatus !== identity.approvalStatus
    || (user.cooperativeId !== undefined && user.cooperativeId !== null)) {
    throw new Error("User upsert requires a verified Buyer or Seller registration identity.");
  }

  const now = new Date();
  const values: InsertUser = {
    openId: user.openId,
    role: identity.applicationRole,
    approvalStatus: identity.approvalStatus,
    cooperativeId: null,
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
  return { values, updateSet, identity };
}

export async function upsertUser(user: InsertUser, executor?: RootDb | RootTransaction): Promise<void> {
  const db = executor ?? await getDb();
  const plan = buildUserUpsertPlan(user);
  const [persisted] = await db.insert(users).values(plan.values).onConflictDoUpdate({
    target: users.openId,
    set: plan.updateSet,
  }).returning({
    role: users.role,
    approvalStatus: users.approvalStatus,
    cooperativeId: users.cooperativeId,
  });
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

export async function getUserByVerifiedAuthId(authUserId: string) {
  const db = await getDb();
  const applicationUsers = await inDatabasePhase("application_user_lookup", () =>
    db.select({
      id: users.id,
      openId: users.openId,
      name: users.name,
      email: users.email,
      role: users.role,
      approvalStatus: users.approvalStatus,
      verificationStatus: users.verificationStatus,
      cooperativeId: users.cooperativeId,
      contactNumber: users.contactNumber,
      birthdate: users.birthdate,
      phone: users.phone,
      address: users.address,
    }).from(users)
      .where(eq(users.openId, authUserId))
      .limit(2));
  const profileRoles = await inDatabasePhase("canonical_role_lookup", () =>
    db.select({ roleName: roles.roleName })
      .from(profiles)
      .leftJoin(roles, eq(profiles.roleId, roles.roleId))
      .where(eq(profiles.userId, authUserId))
      .limit(2));
  return resolveAuthIdentityMapping(authUserId, applicationUsers, profileRoles);
}

export async function getCooperatives() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(cooperatives).where(eq(cooperatives.status, "active")).orderBy(asc(cooperatives.name));
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
  const conditions = [eq(products.status, "published"), eq(products.verificationStatus, "approved"), eq(products.visibility, "visible"), eq(users.approvalStatus, "approved")];
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
      primaryImageUrl: products.primaryImageUrl,
      sellerName: users.name,
      cooperativeName: cooperatives.name,
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
  return listings.map(listing => {
    const storedImages = imagesByProduct.get(listing.id) ?? [];
    const { sellerName, cooperativeName, ...productFields } = listing;
    return {
      sellerName,
      cooperativeName,
      product: {
        ...productFields,
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
    .select({ product: products, sellerName: users.name, cooperativeName: cooperatives.name })
    .from(products)
    .innerJoin(users, eq(products.sellerId, users.id))
    .leftJoin(cooperatives, eq(products.cooperativeId, cooperatives.id))
    .where(and(
      eq(products.id, productId),
      eq(products.status, "published"),
      eq(products.verificationStatus, "approved"),
      eq(products.visibility, "visible"),
      eq(users.approvalStatus, "approved"),
    ))
    .limit(1);
  const listing = rows[0];
  if (!listing) return undefined;
  const imageRows = await db.select().from(productImages)
    .where(eq(productImages.productId, listing.product.id))
    .orderBy(asc(productImages.displayOrder), asc(productImages.id));
  const reservations = await getOpenOrderReservationQuantities(db, [listing.product.id]);
  return {
    ...listing,
    product: {
      ...listing.product,
      imageUrls: imageRows.length
        ? imageRows.map(row => row.imageUrl)
        : listing.product.primaryImageUrl ? [listing.product.primaryImageUrl] : [],
      stockQty: availableStockAfterReservations(
        listing.product.stockQty,
        reservations.get(listing.product.id) ?? 0,
      ),
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
      eq(users.approvalStatus, "approved"),
    ))
    .orderBy(asc(products.category));
}

export async function getSellerProducts(sellerId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(products).where(eq(products.sellerId, sellerId)).orderBy(desc(products.createdAt));
  if (!rows.length) return [];
  const imageRows = await db.select().from(productImages)
    .where(inArray(productImages.productId, rows.map(row => row.id)))
    .orderBy(asc(productImages.displayOrder), asc(productImages.id));
  const imagesByProduct = new Map<number, string[]>();
  for (const row of imageRows) {
    const urls = imagesByProduct.get(row.productId) ?? [];
    urls.push(row.imageUrl);
    imagesByProduct.set(row.productId, urls);
  }
  return rows.map(product => {
    const storedImages = imagesByProduct.get(product.id) ?? [];
    return {
      ...product,
      imageUrls: storedImages.length
        ? storedImages
        : product.primaryImageUrl ? [product.primaryImageUrl] : [],
    };
  });
}

export async function getBuyerOrders(buyerId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ order: orders, sellerName: users.name, cooperativeName: cooperatives.name })
    .from(orders)
    .innerJoin(users, eq(orders.sellerId, users.id))
    .leftJoin(cooperatives, eq(orders.cooperativeId, cooperatives.id))
    .where(eq(orders.buyerId, buyerId))
    .orderBy(desc(orders.createdAt));
  if (!rows.length) return [];
  const items = await db
    .select({ item: orderItems, productName: products.name, unit: products.unit })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(inArray(orderItems.orderId, rows.map(row => row.order.id)));
  return rows.map(row => ({
    ...row,
    items: items.filter(item => item.item.orderId === row.order.id),
  }));
}

export async function getSellerOrders(sellerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ order: orders, payment: transactions, item: orderItems, productName: products.name, unit: products.unit, buyerName: users.name })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(products, eq(orderItems.productId, products.id))
    .innerJoin(users, eq(orders.buyerId, users.id))
    .leftJoin(transactions, eq(transactions.orderId, orders.id))
    .where(eq(orders.sellerId, sellerId))
    .orderBy(desc(orders.createdAt));
}

export async function getOrderDetail(orderId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [orderRow] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!orderRow) return undefined;

  const [buyer, seller] = await Promise.all([
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
  ]);
  const [payment] = await db.select().from(transactions).where(eq(transactions.orderId, orderId)).limit(1);

  const items = await db
    .select({ item: orderItems, productName: products.name, unit: products.unit, priceCents: products.priceCents, stockQty: products.stockQty })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, orderId));

  const events = await db
    .select({ event: orderEvents, actorName: users.name })
    .from(orderEvents)
    .leftJoin(users, eq(orderEvents.actorUserId, users.id))
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(desc(orderEvents.createdAt));

  return {
    order: orderRow,
    buyer: buyer[0],
    seller: seller[0],
    payment: payment ?? null,
    items,
    events,
  };
}

export async function getBuyerQuotations(buyerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ quotation: quotations, productName: products.name, unit: products.unit, sellerName: users.name })
    .from(quotations)
    .innerJoin(products, eq(quotations.productId, products.id))
    .innerJoin(users, eq(quotations.sellerId, users.id))
    .where(eq(quotations.buyerId, buyerId))
    .orderBy(desc(quotations.createdAt));
}

export async function getSellerQuotations(sellerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ quotation: quotations, productName: products.name, unit: products.unit, buyerName: users.name })
    .from(quotations)
    .innerJoin(products, eq(quotations.productId, products.id))
    .innerJoin(users, eq(quotations.buyerId, users.id))
    .where(eq(quotations.sellerId, sellerId))
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
  const productScope = !scoped ? undefined : cooperativeId === null ? eq(products.id, -1) : eq(products.cooperativeId, cooperativeId);
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

export async function getConversationsForUser(userId: number, canSeeAll = false, cooperativeId: number | null = null) {
  const db = await getDb();
  if (!db) return [];
  const visibleConversations = [eq(conversations.buyerId, userId), eq(conversations.sellerId, userId)];
  if (cooperativeId !== null) {
    visibleConversations.push(inArray(conversations.sellerId, db.select({ id: users.id }).from(users).where(eq(users.cooperativeId, cooperativeId))));
  }
  return db.select({ conversation: conversations, ownerName: users.name, productName: products.name, productUnit: products.unit, requestedQty: quotations.requestedQty })
    .from(conversations)
    .innerJoin(users, eq(conversations.buyerId, users.id))
    .leftJoin(products, eq(conversations.productId, products.id))
    .leftJoin(quotations, eq(conversations.quotationId, quotations.id))
    .where(canSeeAll ? undefined : or(...visibleConversations))
    .orderBy(desc(conversations.updatedAt));
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
