import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const appSchema = pgSchema("agricoop_app");

const cooperativeStatus = appSchema.enum("cooperative_status", ["active", "inactive"]);
const conversationStatus = appSchema.enum("conversation_status", ["open", "closed"]);
const orderType = appSchema.enum("order_type", ["regular", "bulk"]);
const orderStatus = appSchema.enum("order_status", ["submitted", "confirmed", "ready", "completed", "cancelled", "processing", "shipped", "delivered"]);
const orderPaymentStatus = appSchema.enum("order_payment_status", ["pending", "paid", "failed", "F2F-pending-confirmation", "awaiting_verification", "verified", "refunded", "expired"]);
const productQualityGrade = appSchema.enum("product_quality_grade", ["premium", "standard", "imperfect"]);
const productStatus = appSchema.enum("product_status", ["published", "archived"]);
const productVerificationStatus = appSchema.enum("product_verification_status", ["draft", "pending", "approved", "rejected", "pending_review"]);
const productVisibility = appSchema.enum("product_visibility", ["hidden", "visible"]);
const quotationStatus = appSchema.enum("quotation_status", ["requested", "responded", "accepted", "declined"]);
const transactionStatus = appSchema.enum("transaction_status", ["recorded", "payment_coordinated", "pending", "paid", "failed"]);
const userRole = appSchema.enum("user_role", ["buyer", "seller", "admin", "superadmin"]);
const userApprovalStatus = appSchema.enum("user_approval_status", ["approved", "pending", "suspended"]);
const userVerificationStatus = appSchema.enum("user_verification_status", ["unverified", "pending", "approved", "rejected"]);
const associationRequestStatus = appSchema.enum("association_request_status", ["pending", "approved", "rejected"]);

export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  roleId: integer("role_id").notNull(),
  cooperativeId: uuid("cooperative_id"),
  accountStatus: text("account_status").default("pending"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow(),
}, table => [
  // Catalog assumes FK to public.roles / auth.users / public.cooperatives; modeled as docs for Drizzle only.
  index("profiles_role_id_idx").on(table.roleId),
]);

export const roles = pgTable("roles", {
  roleId: integer("role_id").primaryKey(),
  roleName: text("role_name").notNull(),
}, table => [
  uniqueIndex("roles_role_name_uidx").on(table.roleName),
]);

export const cooperatives = appSchema.table("cooperatives", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 180 }).notNull(),
  normalizedName: varchar("normalizedName", { length: 180 }).notNull(),
  description: text("description"),
  location: varchar("location", { length: 180 }).notNull(),
  address: varchar("address", { length: 255 }).notNull().default(""),
  normalizedLocation: varchar("normalizedLocation", { length: 180 }).notNull().default(""),
  status: cooperativeStatus("status").default("active").notNull(),
  createdBy: integer("createdBy").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  source: varchar("source", { length: 32 }).notNull().default("seed"),
  deletedAt: timestamp("deletedAt", { mode: "date" }),
  deletedBy: integer("deletedBy").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
}, table => [
  uniqueIndex("cooperatives_normalized_name_location_uidx")
    .on(table.normalizedName, table.normalizedLocation),
  index("cooperatives_created_by_idx").on(table.createdBy),
  index("cooperatives_deleted_at_idx").on(table.deletedAt),
]);

export const coopAdminApplicationStatus = appSchema.enum("coop_admin_application_status", [
  "awaiting_documents",
  "pending",
  "approved",
  "rejected",
]);

export const users = appSchema.table("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRole("role").default("buyer").notNull(),
  requestedRole: userRole("requestedRole"),
  approvalStatus: userApprovalStatus("approvalStatus").default("approved").notNull(),
  verificationStatus: userVerificationStatus("verificationStatus").default("unverified").notNull(),
  verificationNote: text("verificationNote"),
  verifiedBy: integer("verifiedBy").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  verifiedAt: timestamp("verifiedAt", { mode: "date" }),
  profileImageUrl: varchar("profileImageUrl", { length: 1000 }),
  birthdate: timestamp("birthdate", { mode: "date" }),
  phone: varchar("phone", { length: 40 }),
  address: text("address"),
  cooperativeId: integer("cooperativeId").references(() => cooperatives.id),
  contactNumber: varchar("contactNumber", { length: 40 }),
  onlinePaymentQrPath: text("onlinePaymentQrPath"),
  onlinePaymentAccountName: varchar("onlinePaymentAccountName", { length: 150 }),
  onlinePaymentAccountNumber: varchar("onlinePaymentAccountNumber", { length: 100 }),
  onlinePaymentLabel: varchar("onlinePaymentLabel", { length: 150 }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
  lastSignedIn: timestamp("lastSignedIn", { mode: "date" }).defaultNow().notNull(),
  deletedAt: timestamp("deletedAt", { mode: "date" }),
  deletedBy: integer("deletedBy").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  deletedByRole: varchar("deletedByRole", { length: 32 }),
}, table => [
  index("users_cooperative_id_idx").on(table.cooperativeId),
  index("users_deleted_at_idx").on(table.deletedAt),
]);

export const cooperativeAdminApplications = appSchema.table("cooperativeAdminApplications", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id),
  fullName: varchar("fullName", { length: 180 }).notNull(),
  cooperativeId: integer("cooperativeId").notNull().references(() => cooperatives.id),
  positionTitle: varchar("positionTitle", { length: 180 }).notNull().default(""),
  contactNumber: varchar("contactNumber", { length: 40 }),
  idType: varchar("idType", { length: 40 }),
  idNumber: varchar("idNumber", { length: 60 }),
  consentAcceptedAt: timestamp("consentAcceptedAt", { mode: "date" }),
  idDocumentPath: text("idDocumentPath"),
  proofDocumentPath: text("proofDocumentPath"),
  status: coopAdminApplicationStatus("status").default("awaiting_documents").notNull(),
  rejectionReason: text("rejectionReason"),
  reviewedBy: integer("reviewedBy").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewedAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, table => [
  index("coop_admin_apps_user_idx").on(table.userId),
  index("coop_admin_apps_status_idx").on(table.status),
  uniqueIndex("coop_admin_apps_one_open_per_user_uidx")
    .on(table.userId)
    .where(sql`${table.status} in ('awaiting_documents', 'pending')`),
]);

export const cooperativeAssociationRequests = appSchema.table("cooperativeAssociationRequests", {
  id: serial("id").primaryKey(),
  sellerId: integer("sellerId").notNull().references(() => users.id),
  cooperativeId: integer("cooperativeId").notNull().references(() => cooperatives.id),
  status: associationRequestStatus("status").default("pending").notNull(),
  message: text("message"),
  reviewNote: text("reviewNote"),
  reviewedBy: integer("reviewedBy").references(() => users.id, { onDelete: "set null" }),
  moveExistingListings: boolean("moveExistingListings").default(false).notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  reviewedAt: timestamp("reviewedAt", { mode: "date" }),
}, table => [
  index("cooperativeAssociationRequests_seller_status_idx").on(table.sellerId, table.status),
  index("cooperativeAssociationRequests_cooperative_status_idx").on(table.cooperativeId, table.status),
  uniqueIndex("cooperativeAssociationRequests_one_pending_seller_idx")
    .on(table.sellerId)
    .where(sql`${table.status} = 'pending'`),
]);

export const products = appSchema.table("products", {
  id: serial("id").primaryKey(),
  sellerId: integer("sellerId").references(() => users.id, { onDelete: "set null" }),
  cooperativeId: integer("cooperativeId").references(() => cooperatives.id),
  name: varchar("name", { length: 160 }).notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  variety: varchar("variety", { length: 180 }).notNull(),
  description: text("description"),
  unit: varchar("unit", { length: 40 }).notNull(),
  priceCents: integer("priceCents").notNull(),
  stockQty: integer("stockQty").notNull().default(0),
  minOrderQty: integer("minOrderQty").notNull().default(1),
  qualityGrade: productQualityGrade("qualityGrade").default("standard").notNull(),
  status: productStatus("status").default("published").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
  verificationStatus: productVerificationStatus("verificationStatus").default("draft").notNull(),
  visibility: productVisibility("visibility").default("hidden").notNull(),
  rejectionReason: text("rejectionReason"),
  primaryImageUrl: varchar("primaryImageUrl", { length: 1000 }),
  allowsPickup: boolean("allowsPickup").notNull().default(true),
  allowsDelivery: boolean("allowsDelivery").notNull().default(true),
  acceptsOnlinePayment: boolean("acceptsOnlinePayment").notNull().default(false),
  onlinePaymentEnabled: boolean("onlinePaymentEnabled").notNull().default(true),
  fulfillmentType: varchar("fulfillmentType", { length: 20 }).notNull().default("on_hand"),
  prepTimeDays: integer("prepTimeDays"),
  capacityNote: text("capacityNote"),
  deletedAt: timestamp("deletedAt", { mode: "date" }),
  deletedBy: integer("deletedBy").references(() => users.id, { onDelete: "set null" }),
}, table => [index("products_seller_id_idx").on(table.sellerId)]);

export const productImages = appSchema.table("productImages", {
  id: serial("id").primaryKey(),
  productId: integer("productId").notNull().references(() => products.id, { onDelete: "cascade" }),
  imageUrl: varchar("imageUrl", { length: 1000 }).notNull(),
  displayOrder: integer("displayOrder").notNull().default(0),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
}, table => [index("productImages_product_order_idx").on(table.productId, table.displayOrder)]);

export const cartItems = appSchema.table("cartItems", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id),
  productId: integer("productId").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
}, table => [
  uniqueIndex("cart_items_user_product_uidx").on(table.userId, table.productId),
  index("cart_items_user_id_idx").on(table.userId),
]);

export const quotations = appSchema.table("quotations", {
  id: serial("id").primaryKey(),
  productId: integer("productId").notNull().references(() => products.id),
  buyerId: integer("buyerId").notNull().references(() => users.id),
  sellerId: integer("sellerId").notNull().references(() => users.id),
  requestedQty: integer("requestedQty").notNull(),
  buyerNote: text("buyerNote"),
  quotedPriceCents: integer("quotedPriceCents"),
  sellerNote: text("sellerNote"),
  status: quotationStatus("status").default("requested").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
  respondedAt: timestamp("respondedAt", { mode: "date" }),
}, table => [index("quotations_product_id_idx").on(table.productId)]);

export const orders = appSchema.table("orders", {
  id: serial("id").primaryKey(),
  buyerId: integer("buyerId").references(() => users.id, { onDelete: "set null" }),
  sellerId: integer("sellerId").references(() => users.id, { onDelete: "set null" }),
  cooperativeId: integer("cooperativeId").references(() => cooperatives.id),
  orderType: orderType("orderType").notNull(),
  status: orderStatus("status").default("submitted").notNull(),
  paymentStatus: orderPaymentStatus("paymentStatus").default("pending").notNull(),
  paymentMethod: varchar("paymentMethod", { length: 64 }),
  fulfillmentMethod: varchar("fulfillmentMethod", { length: 32 }),
  sellerConfirmationStatus: varchar("sellerConfirmationStatus", { length: 32 }),
  deliveryDetails: jsonb("deliveryDetails"),
  totalCents: integer("totalCents").notNull(),
  buyerNote: text("buyerNote"),
  demoSeedKey: varchar("demoSeedKey", { length: 80 }),
  completedAt: timestamp("completedAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, table => [
  index("orders_buyer_id_idx").on(table.buyerId),
  index("orders_cooperative_id_idx").on(table.cooperativeId),
  index("orders_seller_id_idx").on(table.sellerId),
  uniqueIndex("orders_demo_seed_key_idx").on(table.demoSeedKey),
]);

export const orderHistory = appSchema.table("orderHistory", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId").notNull().references(() => orders.id),
  actorUserId: integer("actorUserId").references(() => users.id, { onDelete: "set null" }),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  fromValue: varchar("fromValue", { length: 64 }),
  toValue: varchar("toValue", { length: 64 }),
  note: text("note"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
}, table => [index("order_history_order_id_idx").on(table.orderId, table.createdAt)]);

export const orderEvents = appSchema.table("orderEvents", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId").notNull().references(() => orders.id),
  actorUserId: integer("actorUserId").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 80 }).notNull(),
  fromStatus: varchar("fromStatus", { length: 32 }),
  toStatus: varchar("toStatus", { length: 32 }),
  note: text("note"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export const orderItems = appSchema.table("orderItems", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId").notNull().references(() => orders.id),
  productId: integer("productId").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unitPriceCents").notNull(),
  fulfillmentType: varchar("fulfillmentType", { length: 20 }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, table => [index("orderitems_order_id_idx").on(table.orderId)]);

export const paymentOptions = appSchema.table("paymentOptions", {
  id: serial("id").primaryKey(),
  cooperativeId: integer("cooperativeId").references(() => cooperatives.id, { onDelete: "restrict" }),
  paymentMethod: varchar("paymentMethod", { length: 50 }).notNull().default("gcash"),
  displayName: varchar("displayName", { length: 150 }).notNull(),
  accountName: varchar("accountName", { length: 150 }),
  accountNumber: varchar("accountNumber", { length: 100 }),
  qrImagePath: text("qrImagePath"),
  instructions: text("instructions"),
  isActive: boolean("isActive").notNull().default(true),
  createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
}, table => [
  index("paymentOptionsCooperativeIdIdx").on(table.cooperativeId),
  index("paymentOptionsIsActiveIdx").on(table.isActive),
]);

export const qrIssueReports = appSchema.table("qrIssueReports", {
  id: serial("id").primaryKey(),
  paymentOptionId: integer("paymentOptionId").references(() => paymentOptions.id, { onDelete: "set null" }),
  cooperativeId: integer("cooperativeId").references(() => cooperatives.id, { onDelete: "set null" }),
  orderId: integer("orderId").references(() => orders.id, { onDelete: "set null" }),
  reportedBy: integer("reportedBy").references(() => users.id, { onDelete: "set null" }),
  paymentProvider: varchar("paymentProvider", { length: 50 }),
  paymentOptionLabel: varchar("paymentOptionLabel", { length: 150 }),
  accountName: varchar("accountName", { length: 150 }),
  accountNumber: varchar("accountNumber", { length: 100 }),
  qrImagePath: text("qrImagePath"),
  reason: varchar("reason", { length: 60 }).notNull(),
  details: text("details"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  adminNote: text("adminNote"),
  reviewedBy: integer("reviewedBy").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewedAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
}, table => [
  check("qrIssueReportsStatusCheck", sql`${table.status} in ('pending', 'under_review', 'resolved', 'dismissed')`),
  index("qrIssueReportsCooperativeIdIdx").on(table.cooperativeId),
  index("qrIssueReportsStatusIdx").on(table.status),
  index("qrIssueReportsPaymentOptionIdIdx").on(table.paymentOptionId),
  index("qrIssueReportsReportedByIdx").on(table.reportedBy),
  index("qrIssueReportsOrderIdIdx").on(table.orderId),
]);

export const transactions = appSchema.table("transactions", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId").notNull().references(() => orders.id),
  buyerId: integer("buyerId").references(() => users.id, { onDelete: "set null" }),
  sellerId: integer("sellerId").references(() => users.id, { onDelete: "set null" }),
  amountCents: integer("amountCents").notNull(),
  paymentReferenceNote: text("paymentReferenceNote"),
  paymentOptionId: integer("paymentOptionId").references(() => paymentOptions.id, { onDelete: "set null" }),
  status: transactionStatus("status").default("recorded").notNull(),
  paymentMethod: varchar("paymentMethod", { length: 64 }),
  externalId: varchar("externalId", { length: 128 }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
  completedAt: timestamp("completedAt", { mode: "date" }),
}, table => [uniqueIndex("transactions_order_id_idx").on(table.orderId)]);

export const paymentProofs = appSchema.table("paymentProofs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orderId: integer("orderId").notNull().references(() => orders.id, { onDelete: "restrict" }),
  transactionId: integer("transactionId").references(() => transactions.id, { onDelete: "set null" }),
  uploadedBy: integer("uploadedBy").references(() => users.id, { onDelete: "set null" }),
  storagePath: text("storagePath").notNull(),
  originalFileName: varchar("originalFileName", { length: 255 }),
  mimeType: varchar("mimeType", { length: 100 }),
  fileSizeBytes: bigint("fileSizeBytes", { mode: "number" }),
  verificationStatus: varchar("verificationStatus", { length: 30 }).notNull().default("pending"),
  reviewNote: text("reviewNote"),
  reviewedBy: integer("reviewedBy").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewedAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
}, table => [
  check("paymentProofsVerificationStatusCheck", sql`${table.verificationStatus} in ('pending', 'verified', 'rejected')`),
  check("paymentProofsFileSizeBytesCheck", sql`${table.fileSizeBytes} is null or ${table.fileSizeBytes} between 1 and 5242880`),
  check("paymentProofsMimeTypeCheck", sql`${table.mimeType} is null or ${table.mimeType} in ('image/jpeg', 'image/png', 'image/webp')`),
  index("paymentProofsOrderIdIdx").on(table.orderId),
  index("paymentProofsUploadedByIdx").on(table.uploadedBy),
  index("paymentProofsVerificationStatusIdx").on(table.verificationStatus),
]);

export const payments = appSchema.table("payments", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId").notNull().references(() => orders.id),
  buyerId: integer("buyerId").references(() => users.id, { onDelete: "set null" }),
  sellerId: integer("sellerId").references(() => users.id, { onDelete: "set null" }),
  cooperativeId: integer("cooperativeId").references(() => cooperatives.id),
  amountCents: bigint("amountCents", { mode: "number" }).notNull(),
  currency: varchar("currency", { length: 8 }).notNull().default("PHP"),
  paymentMethod: varchar("paymentMethod", { length: 64 }).notNull().default("f2f"),
  paymentOptionId: integer("paymentOptionId").references(() => paymentOptions.id),
  status: text("status").$type<"pending" | "awaiting_verification" | "verified" | "failed" | "cancelled" | "refunded" | "expired">().default("pending").notNull(),
  verifiedByUserId: integer("verifiedByUserId").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  paymentReference: text("paymentReference"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
  paidAt: timestamp("paidAt", { mode: "date" }),
  verifiedAt: timestamp("verifiedAt", { mode: "date" }),
}, table => [
  uniqueIndex("payments_order_id_idx").on(table.orderId),
  index("payments_payment_option_id_idx").on(table.paymentOptionId),
]);

export const paymentEvents = appSchema.table("paymentEvents", {
  id: serial("id").primaryKey(),
  paymentId: integer("paymentId").notNull().references(() => payments.id),
  actorUserId: integer("actorUserId").references(() => users.id, { onDelete: "set null" }),
  eventType: varchar("eventType", { length: 80 }).notNull(),
  fromStatus: varchar("fromStatus", { length: 32 }),
  toStatus: varchar("toStatus", { length: 32 }),
  reason: text("reason"),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
}, table => [index("payment_events_payment_id_created_at_idx").on(table.paymentId, table.createdAt)]);

export const paymentAttempts = appSchema.table("paymentAttempts", {
  id: serial("id").primaryKey(),
  paymentId: integer("paymentId").notNull().references(() => payments.id),
  attemptNumber: integer("attemptNumber").notNull().default(1),
  paymentMethod: varchar("paymentMethod", { length: 64 }).notNull().default("f2f"),
  referenceNumber: varchar("referenceNumber", { length: 160 }),
  externalId: varchar("externalId", { length: 128 }),
  evidenceUrl: varchar("evidenceUrl", { length: 1000 }),
  status: text("status").$type<"pending" | "submitted" | "under_review" | "approved" | "rejected" | "failed" | "expired" | "cancelled">().default("pending").notNull(),
  submittedAt: timestamp("submittedAt", { mode: "date" }).defaultNow().notNull(),
  reviewedByUserId: integer("reviewedByUserId").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  rejectionReason: text("rejectionReason"),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, table => [uniqueIndex("payment_attempts_payment_id_attempt_number_idx").on(table.paymentId, table.attemptNumber)]);

export const conversations = appSchema.table("conversations", {
  id: serial("id").primaryKey(),
  subject: varchar("subject", { length: 180 }).notNull(),
  buyerId: integer("buyerId").notNull().references(() => users.id),
  sellerId: integer("sellerId").references(() => users.id),
  productId: integer("productId").references(() => products.id),
  orderId: integer("orderId").references(() => orders.id),
  quotationId: integer("quotationId").references(() => quotations.id),
  status: conversationStatus("status").default("open").notNull(),
  archivedAt: timestamp("archivedAt", { mode: "date" }),
  deletedAt: timestamp("deletedAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, table => [
  index("conversations_order_id_idx").on(table.orderId),
  index("conversations_buyer_id_idx").on(table.buyerId),
  index("conversations_seller_id_idx").on(table.sellerId),
]);

/** Per-user inbox metadata for conversations and tickets (pin / archive / soft-delete / read). */
export const threadStates = appSchema.table("threadStates", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id),
  channel: varchar("channel", { length: 32 }).notNull(),
  threadId: integer("threadId").notNull(),
  isRead: integer("isRead").notNull().default(0),
  pinnedAt: timestamp("pinnedAt", { mode: "date" }),
  archivedAt: timestamp("archivedAt", { mode: "date" }),
  deletedAt: timestamp("deletedAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, table => [
  uniqueIndex("thread_states_user_channel_thread_uidx").on(table.userId, table.channel, table.threadId),
  index("thread_states_user_channel_idx").on(table.userId, table.channel),
]);

export const conversationMessages = appSchema.table("conversationMessages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversationId").notNull().references(() => conversations.id),
  senderId: integer("senderId").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, table => [index("conversationmessages_conversation_id_idx").on(table.conversationId)]);

export const notifications = appSchema.table("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id),
  type: varchar("type", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  link: varchar("link", { length: 255 }),
  isRead: integer("isRead").notNull().default(0),
  relatedEntityId: integer("relatedEntityId"),
  relatedEntityType: varchar("relatedEntityType", { length: 50 }),
  archivedAt: timestamp("archivedAt", { mode: "date" }),
  deletedAt: timestamp("deletedAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export const supportTickets = appSchema.table("supportTickets", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id),
  cooperativeId: integer("cooperativeId").references(() => cooperatives.id),
  subject: varchar("subject", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  description: text("description").notNull(),
  priority: varchar("priority", { length: 20 }).notNull().default("medium"),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  assignedToUserId: integer("assignedToUserId").references(() => users.id, { onDelete: "set null" }),
  archivedAt: timestamp("archivedAt", { mode: "date" }),
  deletedAt: timestamp("deletedAt", { mode: "date" }),
  pinnedAt: timestamp("pinnedAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
});

export const supportTicketMessages = appSchema.table("supportTicketMessages", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticketId").notNull().references(() => supportTickets.id, { onDelete: "cascade" }),
  senderId: integer("senderId").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
}, table => [index("supportTicketMessages_ticket_created_idx").on(table.ticketId, table.createdAt)]);

export const auditLogs = appSchema.table("auditLogs", {
  id: serial("id").primaryKey(),
  actorUserId: integer("actorUserId").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entityType", { length: 50 }).notNull(),
  entityId: integer("entityId"),
  cooperativeId: integer("cooperativeId").references(() => cooperatives.id),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export const profileVerificationSubmissions = appSchema.table("profileVerificationSubmissions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  storagePath: text("storagePath").notNull().unique(),
  mimeType: varchar("mimeType", { length: 100 }).notNull(),
  fileSizeBytes: bigint("fileSizeBytes", { mode: "number" }).notNull(),
  submissionNote: text("submissionNote"),
  status: userVerificationStatus("status").default("pending").notNull(),
  submittedAt: timestamp("submittedAt", { mode: "date" }).defaultNow().notNull(),
  reviewedBy: integer("reviewedBy").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewedAt", { mode: "date" }),
  reviewNote: text("reviewNote"),
}, table => [
  index("profileVerificationSubmissionsUserSubmittedIdx").on(table.userId, table.submittedAt),
  uniqueIndex("profileVerificationSubmissionsOnePendingUserIdx")
    .on(table.userId)
    .where(sql`${table.status} = 'pending'`),
  check("profileVerificationSubmissionsFileSizeCheck", sql`${table.fileSizeBytes} BETWEEN 1 AND 5242880`),
  check("profileVerificationSubmissionsMimeTypeCheck", sql`${table.mimeType} IN ('image/jpeg', 'image/png', 'image/webp')`),
]);

/** Platform payment method toggles — Admin/SuperAdmin only (singleton id=1). */
export const systemPaymentSettings = appSchema.table("systemPaymentSettings", {
  id: integer("id").primaryKey().default(1),
  cashPickupEnabled: boolean("cashPickupEnabled").notNull().default(true),
  cashDeliveryEnabled: boolean("cashDeliveryEnabled").notNull().default(true),
  onlineEnabled: boolean("onlineEnabled").notNull().default(false),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
  updatedBy: integer("updatedBy").references(() => users.id, { onDelete: "set null" }),
});

/** System online payment accounts — one active non-archived at a time. */
export const systemOnlinePaymentAccounts = appSchema.table("systemOnlinePaymentAccounts", {
  id: serial("id").primaryKey(),
  label: varchar("label", { length: 150 }).notNull(),
  accountName: varchar("accountName", { length: 150 }).notNull(),
  accountNumber: varchar("accountNumber", { length: 100 }).notNull(),
  instructions: text("instructions"),
  qrImagePath: text("qrImagePath"),
  isActive: boolean("isActive").notNull().default(false),
  archivedAt: timestamp("archivedAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
  createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  updatedBy: integer("updatedBy").references(() => users.id, { onDelete: "set null" }),
}, table => [
  uniqueIndex("system_online_payment_one_active_idx")
    .on(table.isActive)
    .where(sql`${table.isActive} = true AND ${table.archivedAt} IS NULL`),
]);

export const systemPaymentSettingsAudit = appSchema.table("systemPaymentSettingsAudit", {
  id: serial("id").primaryKey(),
  actorUserId: integer("actorUserId").references(() => users.id, { onDelete: "set null" }),
  actorRole: text("actorRole").notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  details: text("details"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type CooperativeAdminApplication = typeof cooperativeAdminApplications.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Cooperative = typeof cooperatives.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type SystemPaymentSettings = typeof systemPaymentSettings.$inferSelect;
export type SystemOnlinePaymentAccount = typeof systemOnlinePaymentAccounts.$inferSelect;
