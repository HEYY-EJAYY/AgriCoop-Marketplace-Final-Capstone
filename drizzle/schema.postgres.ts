// PostgreSQL schema for AgriCoop.
// Keep the original MySQL schema and migration history separate.
import {
  pgEnum,
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const cooperativeStatusEnum = pgEnum("cooperative_status", ["active", "inactive"]);
const userRoleEnum = pgEnum("user_role", ["buyer", "seller", "admin", "superadmin"]);
const userApprovalStatusEnum = pgEnum("user_approval_status", ["approved", "pending", "suspended"]);
const userVerificationStatusEnum = pgEnum("user_verification_status", ["unverified", "pending", "approved", "rejected"]);
const productQualityGradeEnum = pgEnum("product_quality_grade", ["premium", "standard", "imperfect"]);
const productStatusEnum = pgEnum("product_status", ["published", "archived"]);
const productVerificationStatusEnum = pgEnum("product_verification_status", ["draft", "pending", "approved", "rejected"]);
const productVisibilityEnum = pgEnum("product_visibility", ["hidden", "visible"]);
const quotationStatusEnum = pgEnum("quotation_status", ["requested", "responded", "accepted", "declined"]);
const orderTypeEnum = pgEnum("order_type", ["regular", "bulk"]);
const orderStatusEnum = pgEnum("order_status", ["submitted", "confirmed", "ready", "completed", "cancelled"]);
const orderPaymentStatusEnum = pgEnum("order_payment_status", ["pending", "paid", "failed", "F2F-pending-confirmation"]);
const transactionStatusEnum = pgEnum("transaction_status", ["recorded", "payment_coordinated", "pending", "paid", "failed"]);
const conversationStatusEnum = pgEnum("conversation_status", ["open", "closed"]);

export const cooperatives = pgTable("cooperatives", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 180 }).notNull(),
  normalizedName: varchar("normalizedName", { length: 180 }).notNull(),
  description: text("description"),
  location: varchar("location", { length: 180 }).notNull(),
  status: cooperativeStatusEnum("status").default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  uniqueIndex("cooperatives_normalized_name_idx").on(table.normalizedName),
]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("buyer").notNull(),
  approvalStatus: userApprovalStatusEnum("approvalStatus").default("approved").notNull(),
  verificationStatus: userVerificationStatusEnum("verificationStatus").default("unverified").notNull(),
  verificationNote: text("verificationNote"),
  verifiedBy: integer("verifiedBy").references((): AnyPgColumn => users.id),
  verifiedAt: timestamp("verifiedAt"),
  profileImageUrl: varchar("profileImageUrl", { length: 1000 }),
  birthdate: timestamp("birthdate"),
  phone: varchar("phone", { length: 40 }),
  address: text("address"),
  cooperativeId: integer("cooperativeId").references(() => cooperatives.id),
  contactNumber: varchar("contactNumber", { length: 40 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  sellerId: integer("sellerId").notNull().references(() => users.id),
  cooperativeId: integer("cooperativeId").references(() => cooperatives.id),
  name: varchar("name", { length: 160 }).notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  variety: varchar("variety", { length: 180 }).notNull(),
  description: text("description"),
  unit: varchar("unit", { length: 40 }).notNull(),
  priceCents: integer("priceCents").notNull(),
  stockQty: integer("stockQty").notNull().default(0),
  minOrderQty: integer("minOrderQty").notNull().default(1),
  qualityGrade: productQualityGradeEnum("qualityGrade").default("standard").notNull(),
  status: productStatusEnum("status").default("published").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  verificationStatus: productVerificationStatusEnum("verificationStatus").default("draft").notNull(),
  visibility: productVisibilityEnum("visibility").default("hidden").notNull(),
  rejectionReason: text("rejectionReason"),
  primaryImageUrl: varchar("primaryImageUrl", { length: 1000 }),
});

export const quotations = pgTable("quotations", {
  id: serial("id").primaryKey(),
  productId: integer("productId").notNull().references(() => products.id),
  buyerId: integer("buyerId").notNull().references(() => users.id),
  sellerId: integer("sellerId").notNull().references(() => users.id),
  requestedQty: integer("requestedQty").notNull(),
  buyerNote: text("buyerNote"),
  quotedPriceCents: integer("quotedPriceCents"),
  sellerNote: text("sellerNote"),
  status: quotationStatusEnum("status").default("requested").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  respondedAt: timestamp("respondedAt"),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  buyerId: integer("buyerId").notNull().references(() => users.id),
  sellerId: integer("sellerId").notNull().references(() => users.id),
  cooperativeId: integer("cooperativeId").references(() => cooperatives.id),
  orderType: orderTypeEnum("orderType").notNull(),
  status: orderStatusEnum("status").default("submitted").notNull(),
  paymentStatus: orderPaymentStatusEnum("paymentStatus").default("pending").notNull(),
  paymentMethod: varchar("paymentMethod", { length: 64 }),
  totalCents: integer("totalCents").notNull(),
  buyerNote: text("buyerNote"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export const orderEvents = pgTable("orderEvents", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId").notNull().references(() => orders.id),
  actorUserId: integer("actorUserId").notNull().references(() => users.id),
  action: varchar("action", { length: 80 }).notNull(),
  fromStatus: varchar("fromStatus", { length: 32 }),
  toStatus: varchar("toStatus", { length: 32 }),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const orderItems = pgTable("orderItems", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId").notNull().references(() => orders.id),
  productId: integer("productId").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unitPriceCents").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId").notNull().references(() => orders.id),
  buyerId: integer("buyerId").notNull().references(() => users.id),
  sellerId: integer("sellerId").notNull().references(() => users.id),
  amountCents: integer("amountCents").notNull(),
  paymentReferenceNote: text("paymentReferenceNote"),
  status: transactionStatusEnum("status").default("recorded").notNull(),
  paymentMethod: varchar("paymentMethod", { length: 64 }),
  externalId: varchar("externalId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  completedAt: timestamp("completedAt"),
}, table => [
  uniqueIndex("transactions_order_id_idx").on(table.orderId),
]);

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  subject: varchar("subject", { length: 180 }).notNull(),
  buyerId: integer("buyerId").notNull().references(() => users.id),
  sellerId: integer("sellerId").references(() => users.id),
  productId: integer("productId").references(() => products.id),
  orderId: integer("orderId").references(() => orders.id),
  quotationId: integer("quotationId").references(() => quotations.id),
  status: conversationStatusEnum("status").default("open").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export const conversationMessages = pgTable("conversationMessages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversationId").notNull().references(() => conversations.id),
  senderId: integer("senderId").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Cooperative = typeof cooperatives.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
