-- Minimal agricoop_app + public identity baseline for local harness.
-- Mirrors drizzle/pg-schema.ts closely enough for RLS/concurrency tests.

CREATE SCHEMA IF NOT EXISTS agricoop_app;
GRANT USAGE ON SCHEMA agricoop_app TO anon, authenticated, service_role, agricoop_login;

CREATE TABLE public.roles (
  role_id integer PRIMARY KEY,
  role_name text NOT NULL UNIQUE
);
INSERT INTO public.roles (role_id, role_name) VALUES
  (1, 'buyer'), (2, 'seller'), (3, 'coop_officer'), (4, 'system_admin')
ON CONFLICT DO NOTHING;

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY,
  full_name text NOT NULL,
  email text NOT NULL,
  role_id integer NOT NULL REFERENCES public.roles(role_id),
  cooperative_id uuid,
  account_status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.products (
  product_id uuid PRIMARY KEY,
  seller_id uuid NOT NULL,
  status text NOT NULL
);

CREATE TABLE public.inventory (
  inventory_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(product_id),
  stock_quantity numeric NOT NULL,
  last_updated timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.activity_logs (
  log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  action_performed text NOT NULL,
  log_date timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.products TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.activity_logs TO anon, authenticated;

DO $$ BEGIN
  CREATE TYPE agricoop_app.cooperative_status AS ENUM ('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE agricoop_app.user_role AS ENUM ('buyer', 'seller', 'admin', 'superadmin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE agricoop_app.user_approval_status AS ENUM ('approved', 'pending', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE agricoop_app.user_verification_status AS ENUM ('unverified', 'pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE agricoop_app.product_status AS ENUM ('published', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE agricoop_app.product_verification_status AS ENUM ('draft', 'pending', 'approved', 'rejected', 'pending_review');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE agricoop_app.product_visibility AS ENUM ('hidden', 'visible');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE agricoop_app.product_quality_grade AS ENUM ('premium', 'standard', 'imperfect');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE agricoop_app.order_type AS ENUM ('regular', 'bulk');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE agricoop_app.order_status AS ENUM ('submitted', 'confirmed', 'ready', 'completed', 'cancelled', 'processing', 'shipped', 'delivered');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE agricoop_app.order_payment_status AS ENUM ('pending', 'paid', 'failed', 'F2F-pending-confirmation', 'awaiting_verification', 'verified', 'refunded', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE agricoop_app.transaction_status AS ENUM ('recorded', 'payment_coordinated', 'pending', 'paid', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE agricoop_app.quotation_status AS ENUM ('requested', 'responded', 'accepted', 'declined');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE agricoop_app.conversation_status AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE agricoop_app.cooperatives (
  id serial PRIMARY KEY,
  name varchar(180) NOT NULL,
  "normalizedName" varchar(180) NOT NULL UNIQUE,
  description text,
  location varchar(180) NOT NULL,
  status agricoop_app.cooperative_status NOT NULL DEFAULT 'active',
  "createdAt" timestamp NOT NULL DEFAULT now()
);

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
  "demoSeedKey" varchar(80),
  "completedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE agricoop_app."orderItems" (
  id serial PRIMARY KEY,
  "orderId" integer NOT NULL REFERENCES agricoop_app.orders(id),
  "productId" integer NOT NULL REFERENCES agricoop_app.products(id),
  quantity integer NOT NULL,
  "unitPriceCents" integer NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

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

CREATE TABLE agricoop_app."paymentOptions" (
  id serial PRIMARY KEY,
  "cooperativeId" integer REFERENCES agricoop_app.cooperatives(id) ON DELETE RESTRICT,
  "paymentMethod" varchar(50) NOT NULL DEFAULT 'gcash',
  "displayName" varchar(150) NOT NULL,
  "accountName" varchar(150),
  "accountNumber" varchar(100),
  "qrImagePath" text,
  instructions text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdBy" integer REFERENCES agricoop_app.users(id) ON DELETE SET NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE agricoop_app.transactions (
  id serial PRIMARY KEY,
  "orderId" integer NOT NULL UNIQUE REFERENCES agricoop_app.orders(id),
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

CREATE TABLE agricoop_app."paymentProofs" (
  id integer PRIMARY KEY,
  "orderId" integer NOT NULL REFERENCES agricoop_app.orders(id) ON DELETE RESTRICT,
  "transactionId" integer REFERENCES agricoop_app.transactions(id) ON DELETE SET NULL,
  "uploadedBy" integer NOT NULL REFERENCES agricoop_app.users(id) ON DELETE RESTRICT,
  "storagePath" text NOT NULL,
  "originalFileName" varchar(255),
  "mimeType" varchar(100),
  "fileSizeBytes" bigint,
  "verificationStatus" varchar(30) NOT NULL DEFAULT 'pending',
  "reviewNote" text,
  "reviewedBy" integer REFERENCES agricoop_app.users(id) ON DELETE SET NULL,
  "reviewedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "paymentProofsVerificationStatusCheck" CHECK ("verificationStatus" IN ('pending','verified','rejected'))
);

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

CREATE TABLE agricoop_app."conversationMessages" (
  id serial PRIMARY KEY,
  "conversationId" integer NOT NULL REFERENCES agricoop_app.conversations(id),
  "senderId" integer NOT NULL REFERENCES agricoop_app.users(id),
  body text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE agricoop_app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE agricoop_app.cooperatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE agricoop_app.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE agricoop_app.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE agricoop_app."orderItems" ENABLE ROW LEVEL SECURITY;
ALTER TABLE agricoop_app."orderEvents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE agricoop_app.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agricoop_app."paymentOptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE agricoop_app."paymentProofs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE agricoop_app.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agricoop_app.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agricoop_app."conversationMessages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
