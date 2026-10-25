-- Additive AgriCoop application schema. Existing reduced public tables remain untouched.
CREATE SCHEMA IF NOT EXISTS agricoop_app;
--> statement-breakpoint

CREATE TYPE agricoop_app.cooperative_status AS ENUM ('active', 'inactive');
--> statement-breakpoint

CREATE TYPE agricoop_app.user_role AS ENUM ('buyer', 'seller', 'admin', 'superadmin');
--> statement-breakpoint

CREATE TYPE agricoop_app.user_approval_status AS ENUM ('approved', 'pending', 'suspended');
--> statement-breakpoint

CREATE TYPE agricoop_app.user_verification_status AS ENUM ('unverified', 'pending', 'approved', 'rejected');
--> statement-breakpoint

CREATE TYPE agricoop_app.product_quality_grade AS ENUM ('premium', 'standard', 'imperfect');
--> statement-breakpoint

CREATE TYPE agricoop_app.product_status AS ENUM ('published', 'archived');
--> statement-breakpoint

CREATE TYPE agricoop_app.product_verification_status AS ENUM ('draft', 'pending', 'approved', 'rejected');
--> statement-breakpoint

CREATE TYPE agricoop_app.product_visibility AS ENUM ('hidden', 'visible');
--> statement-breakpoint

CREATE TYPE agricoop_app.quotation_status AS ENUM ('requested', 'responded', 'accepted', 'declined');
--> statement-breakpoint

CREATE TYPE agricoop_app.order_type AS ENUM ('regular', 'bulk');
--> statement-breakpoint

CREATE TYPE agricoop_app.order_status AS ENUM ('submitted', 'confirmed', 'ready', 'completed', 'cancelled');
--> statement-breakpoint

CREATE TYPE agricoop_app.order_payment_status AS ENUM ('pending', 'paid', 'failed', 'F2F-pending-confirmation');
--> statement-breakpoint

CREATE TYPE agricoop_app.transaction_status AS ENUM ('recorded', 'payment_coordinated', 'pending', 'paid', 'failed');
--> statement-breakpoint

CREATE TYPE agricoop_app.conversation_status AS ENUM ('open', 'closed');
--> statement-breakpoint

CREATE TABLE agricoop_app.cooperatives (
  id serial PRIMARY KEY,
  name varchar(180) NOT NULL,
  "normalizedName" varchar(180) NOT NULL,
  description text,
  location varchar(180) NOT NULL,
  status agricoop_app.cooperative_status NOT NULL DEFAULT 'active',
  "createdAt" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX cooperatives_normalized_name_idx ON agricoop_app.cooperatives ("normalizedName");
--> statement-breakpoint

CREATE TABLE agricoop_app.users (
  id serial PRIMARY KEY,
  "openId" varchar(64) NOT NULL UNIQUE,
  name text,
  email varchar(320),
  "loginMethod" varchar(64),
  role agricoop_app.user_role NOT NULL DEFAULT 'buyer',
  "approvalStatus" agricoop_app.user_approval_status NOT NULL DEFAULT 'approved',
  "verificationStatus" agricoop_app.user_verification_status NOT NULL DEFAULT 'unverified',
  "verificationNote" text,
  "verifiedBy" integer REFERENCES agricoop_app.users(id),
  "verifiedAt" timestamp,
  "profileImageUrl" varchar(1000),
  birthdate timestamp,
  phone varchar(40),
  address text,
  "cooperativeId" integer REFERENCES agricoop_app.cooperatives(id),
  "contactNumber" varchar(40),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "lastSignedIn" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX users_cooperative_id_idx ON agricoop_app.users ("cooperativeId");
--> statement-breakpoint

CREATE TABLE agricoop_app.products (
  id serial PRIMARY KEY,
  "sellerId" integer NOT NULL REFERENCES agricoop_app.users(id),
  "cooperativeId" integer REFERENCES agricoop_app.cooperatives(id),
  name varchar(160) NOT NULL,
  category varchar(80) NOT NULL,
  variety varchar(180) NOT NULL,
  description text,
  unit varchar(40) NOT NULL,
  "priceCents" integer NOT NULL,
  "stockQty" integer NOT NULL DEFAULT 0,
  "minOrderQty" integer NOT NULL DEFAULT 1,
  "qualityGrade" agricoop_app.product_quality_grade NOT NULL DEFAULT 'standard',
  status agricoop_app.product_status NOT NULL DEFAULT 'published',
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "verificationStatus" agricoop_app.product_verification_status NOT NULL DEFAULT 'draft',
  visibility agricoop_app.product_visibility NOT NULL DEFAULT 'hidden',
  "rejectionReason" text,
  "primaryImageUrl" varchar(1000)
);
--> statement-breakpoint

CREATE INDEX products_seller_id_idx ON agricoop_app.products ("sellerId");
--> statement-breakpoint

CREATE TABLE agricoop_app.quotations (
  id serial PRIMARY KEY,
  "productId" integer NOT NULL REFERENCES agricoop_app.products(id),
  "buyerId" integer NOT NULL REFERENCES agricoop_app.users(id),
  "sellerId" integer NOT NULL REFERENCES agricoop_app.users(id),
  "requestedQty" integer NOT NULL,
  "buyerNote" text,
  "quotedPriceCents" integer,
  "sellerNote" text,
  status agricoop_app.quotation_status NOT NULL DEFAULT 'requested',
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "respondedAt" timestamp
);
--> statement-breakpoint

CREATE INDEX quotations_product_id_idx ON agricoop_app.quotations ("productId");
--> statement-breakpoint

CREATE TABLE agricoop_app.orders (
  id serial PRIMARY KEY,
  "buyerId" integer NOT NULL REFERENCES agricoop_app.users(id),
  "sellerId" integer NOT NULL REFERENCES agricoop_app.users(id),
  "cooperativeId" integer REFERENCES agricoop_app.cooperatives(id),
  "orderType" agricoop_app.order_type NOT NULL,
  status agricoop_app.order_status NOT NULL DEFAULT 'submitted',
  "paymentStatus" agricoop_app.order_payment_status NOT NULL DEFAULT 'pending',
  "paymentMethod" varchar(64),
  "totalCents" integer NOT NULL,
  "buyerNote" text,
  "completedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX orders_buyer_id_idx ON agricoop_app.orders ("buyerId");
--> statement-breakpoint

CREATE INDEX orders_seller_id_idx ON agricoop_app.orders ("sellerId");
--> statement-breakpoint

CREATE INDEX orders_cooperative_id_idx ON agricoop_app.orders ("cooperativeId");
--> statement-breakpoint

CREATE TABLE agricoop_app."orderEvents" (
  id serial PRIMARY KEY,
  "orderId" integer NOT NULL REFERENCES agricoop_app.orders(id),
  "actorUserId" integer NOT NULL REFERENCES agricoop_app.users(id),
  action varchar(80) NOT NULL,
  "fromStatus" varchar(32),
  "toStatus" varchar(32),
  note text,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE agricoop_app."orderItems" (
  id serial PRIMARY KEY,
  "orderId" integer NOT NULL REFERENCES agricoop_app.orders(id),
  "productId" integer NOT NULL REFERENCES agricoop_app.products(id),
  quantity integer NOT NULL,
  "unitPriceCents" integer NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX orderItems_order_id_idx ON agricoop_app."orderItems" ("orderId");
--> statement-breakpoint

CREATE TABLE agricoop_app.transactions (
  id serial PRIMARY KEY,
  "orderId" integer NOT NULL REFERENCES agricoop_app.orders(id),
  "buyerId" integer NOT NULL REFERENCES agricoop_app.users(id),
  "sellerId" integer NOT NULL REFERENCES agricoop_app.users(id),
  "amountCents" integer NOT NULL,
  "paymentReferenceNote" text,
  status agricoop_app.transaction_status NOT NULL DEFAULT 'recorded',
  "paymentMethod" varchar(64),
  "externalId" varchar(128),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "completedAt" timestamp
);
--> statement-breakpoint

CREATE UNIQUE INDEX transactions_order_id_idx ON agricoop_app.transactions ("orderId");
--> statement-breakpoint

CREATE TABLE agricoop_app.conversations (
  id serial PRIMARY KEY,
  subject varchar(180) NOT NULL,
  "buyerId" integer NOT NULL REFERENCES agricoop_app.users(id),
  "sellerId" integer REFERENCES agricoop_app.users(id),
  "productId" integer REFERENCES agricoop_app.products(id),
  "orderId" integer REFERENCES agricoop_app.orders(id),
  "quotationId" integer REFERENCES agricoop_app.quotations(id),
  status agricoop_app.conversation_status NOT NULL DEFAULT 'open',
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE agricoop_app."conversationMessages" (
  id serial PRIMARY KEY,
  "conversationId" integer NOT NULL REFERENCES agricoop_app.conversations(id),
  "senderId" integer NOT NULL REFERENCES agricoop_app.users(id),
  body text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX conversationMessages_conversation_id_idx
  ON agricoop_app."conversationMessages" ("conversationId");
--> statement-breakpoint

ALTER TABLE agricoop_app.cooperatives ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE agricoop_app.users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE agricoop_app.products ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE agricoop_app.quotations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE agricoop_app.orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE agricoop_app."orderEvents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE agricoop_app."orderItems" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE agricoop_app.transactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE agricoop_app.conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE agricoop_app."conversationMessages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Deliberately no policies: application access is through the server's direct DB connection.
