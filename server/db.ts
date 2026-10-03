import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  cooperatives,
  conversationMessages,
  conversations,
  InsertUser,
  orderItems,
  orders,
  products,
  quotations,
  transactions,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: any = { openId: user.openId, lastSignedIn: new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: new Date() };
  (["name", "email", "loginMethod", "role", "approvalStatus"] as const).forEach(field => {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  });
  if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    values.approvalStatus = "approved";
    updateSet.role = "admin";
    updateSet.approvalStatus = "approved";
  }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getCooperatives() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(cooperatives).where(eq(cooperatives.status, "active")).orderBy(asc(cooperatives.name));
}

export async function getMarketplace(category?: string, sort: "asc" | "desc" = "asc") {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(products.status, "published"), eq(products.verificationStatus, "approved"), eq(products.visibility, "visible"), eq(users.approvalStatus, "approved")];
  if (category && category !== "all") conditions.push(eq(products.category, category));
  return db
    .select({
      product: products,
      sellerName: users.name,
      cooperativeName: cooperatives.name,
    })
    .from(products)
    .innerJoin(users, eq(products.sellerId, users.id))
    .leftJoin(cooperatives, eq(products.cooperativeId, cooperatives.id))
    .where(and(...conditions))
    .orderBy(sort === "asc" ? asc(products.priceCents) : desc(products.priceCents));
}

export async function getCategories() {
  const db = await getDb();
  if (!db) return [];
  return db
    .selectDistinct({ category: products.category })
    .from(products)
    .where(and(eq(products.status, "published"), eq(products.verificationStatus, "approved"), eq(products.visibility, "visible")))
    .orderBy(asc(products.category));
}

export async function getSellerProducts(sellerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(products).where(eq(products.sellerId, sellerId)).orderBy(desc(products.createdAt));
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
    .select({ order: orders, item: orderItems, productName: products.name, unit: products.unit, buyerName: users.name })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(products, eq(orderItems.productId, products.id))
    .innerJoin(users, eq(orders.buyerId, users.id))
    .where(eq(orders.sellerId, sellerId))
    .orderBy(desc(orders.createdAt));
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
  const members = await db.select().from(users).where(eq(users.cooperativeId, cooperativeId));
  const listings = await db.select().from(products).where(eq(products.cooperativeId, cooperativeId));
  const orderRows = await db.select().from(orders).where(eq(orders.cooperativeId, cooperativeId)).orderBy(desc(orders.createdAt));
  const quotationRows = await db
    .select({ quotation: quotations, productName: products.name, buyerName: users.name })
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

export async function getAdminOverview() {
  const db = await getDb();
  if (!db) return { users: [], cooperatives: [], products: [], orders: [], quotations: [], transactions: [] };
  const memberRows = await db
    .select({ user: users, cooperativeName: cooperatives.name })
    .from(users)
    .leftJoin(cooperatives, eq(users.cooperativeId, cooperatives.id))
    .orderBy(desc(users.createdAt));
  const [cooperativeRows, listingRows, orderRows, quotationRows, transactionRows] = await Promise.all([
    db.select().from(cooperatives).orderBy(asc(cooperatives.name)),
    db.select().from(products).orderBy(desc(products.createdAt)),
    db.select().from(orders).orderBy(desc(orders.createdAt)),
    db.select().from(quotations).orderBy(desc(quotations.createdAt)),
    db.select().from(transactions).orderBy(desc(transactions.completedAt)),
  ]);
  return { users: memberRows, cooperatives: cooperativeRows, products: listingRows, orders: orderRows, quotations: quotationRows, transactions: transactionRows };
}

export async function getProductById(productId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  return rows[0];
}

export async function decrementProductStock(productId: number, quantity: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .update(products)
    .set({ stockQty: sql`${products.stockQty} - ${quantity}` })
    .where(eq(products.id, productId));
}

export async function getConversationsForUser(userId: number, canSeeAll = false) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ conversation: conversations, ownerName: users.name })
    .from(conversations)
    .innerJoin(users, eq(conversations.buyerId, users.id))
    .where(canSeeAll ? undefined : or(eq(conversations.buyerId, userId), eq(conversations.sellerId, userId)))
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
