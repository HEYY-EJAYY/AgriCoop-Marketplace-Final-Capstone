import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const cooperatives = mysqlTable("cooperatives", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 180 }).notNull(),
  description: text("description"),
  location: varchar("location", { length: 180 }).notNull(),
  status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["buyer", "seller", "admin", "superadmin"]).default("buyer").notNull(),
  approvalStatus: mysqlEnum("approvalStatus", ["approved", "pending", "suspended"])
    .default("approved")
    .notNull(),
  cooperativeId: int("cooperativeId").references(() => cooperatives.id),
  contactNumber: varchar("contactNumber", { length: 40 }),
  address: text("address"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  sellerId: int("sellerId").notNull().references(() => users.id),
  cooperativeId: int("cooperativeId").references(() => cooperatives.id),
  name: varchar("name", { length: 160 }).notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  description: text("description"),
  unit: varchar("unit", { length: 40 }).notNull(),
  priceCents: int("priceCents").notNull(),
  stockQty: int("stockQty").notNull().default(0),
  qualityGrade: mysqlEnum("qualityGrade", ["premium", "standard", "imperfect"])
    .default("standard")
    .notNull(),
  status: mysqlEnum("status", ["published", "archived"])
    .default("published")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  verificationStatus: mysqlEnum("verificationStatus", ["draft", "pending", "approved", "rejected"]).default("draft").notNull(),
  visibility: mysqlEnum("visibility", ["hidden", "visible"]).default("hidden").notNull(),
  rejectionReason: text("rejectionReason"),
  primaryImageUrl: varchar("primaryImageUrl", { length: 1000 }),
});

export const quotations = mysqlTable("quotations", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull().references(() => products.id),
  buyerId: int("buyerId").notNull().references(() => users.id),
  sellerId: int("sellerId").notNull().references(() => users.id),
  requestedQty: int("requestedQty").notNull(),
  buyerNote: text("buyerNote"),
  quotedPriceCents: int("quotedPriceCents"),
  sellerNote: text("sellerNote"),
  status: mysqlEnum("status", ["requested", "responded", "accepted", "declined"])
    .default("requested")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  respondedAt: timestamp("respondedAt"),
});

export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  buyerId: int("buyerId").notNull().references(() => users.id),
  sellerId: int("sellerId").notNull().references(() => users.id),
  cooperativeId: int("cooperativeId").references(() => cooperatives.id),
  orderType: mysqlEnum("orderType", ["regular", "bulk"]).notNull(),
  status: mysqlEnum("status", ["submitted", "confirmed", "ready", "completed", "cancelled"])
    .default("submitted")
    .notNull(),
  paymentStatus: mysqlEnum("paymentStatus", ["pending", "paid", "failed", "F2F-pending-confirmation"])
    .default("pending")
    .notNull(),
  paymentMethod: varchar("paymentMethod", { length: 64 }),
  totalCents: int("totalCents").notNull(),
  buyerNote: text("buyerNote"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const orderItems = mysqlTable("orderItems", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull().references(() => orders.id),
  productId: int("productId").notNull().references(() => products.id),
  quantity: int("quantity").notNull(),
  unitPriceCents: int("unitPriceCents").notNull(),
});

export const transactions = mysqlTable(
  "transactions",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("orderId").notNull().references(() => orders.id),
    buyerId: int("buyerId").notNull().references(() => users.id),
    sellerId: int("sellerId").notNull().references(() => users.id),
    amountCents: int("amountCents").notNull(),
    paymentReferenceNote: text("paymentReferenceNote"),
    status: mysqlEnum("status", [
      "recorded",
      "payment_coordinated",
      "pending",
      "paid",
      "failed"
    ])
      .default("recorded")
      .notNull(),
    paymentMethod: varchar("paymentMethod", { length: 64 }),
    externalId: varchar("externalId", { length: 128 }),
    completedAt: timestamp("completedAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("transactions_order_id_idx").on(table.orderId)],
);

export const conversations = mysqlTable("conversations", {
  id: int("id").autoincrement().primaryKey(),
  subject: varchar("subject", { length: 180 }).notNull(),
  buyerId: int("buyerId").notNull().references(() => users.id),
  sellerId: int("sellerId").references(() => users.id),
  productId: int("productId").references(() => products.id),
  orderId: int("orderId").references(() => orders.id),
  quotationId: int("quotationId").references(() => quotations.id),
  status: mysqlEnum("status", ["open", "closed"]).default("open").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const conversationMessages = mysqlTable("conversationMessages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull().references(() => conversations.id),
  senderId: int("senderId").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Cooperative = typeof cooperatives.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
