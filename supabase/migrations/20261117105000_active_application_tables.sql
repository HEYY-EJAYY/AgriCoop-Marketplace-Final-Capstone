-- Additive tables used by active application code and the following
-- profile-verification migration. paymentAttempts is intentionally excluded.
-- New tables remain inaccessible to client roles until a separate reviewed
-- policy/grant migration is applied.

BEGIN;

DO $preflight$
DECLARE
  existing_tables text[];
  association_labels text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'Active-table migration stopped: expected Supabase database roles are unavailable';
  END IF;

  IF to_regclass('agricoop_app.users') IS NULL
     OR to_regclass('agricoop_app.cooperatives') IS NULL
     OR to_regclass('agricoop_app.products') IS NULL
     OR to_regclass('agricoop_app.orders') IS NULL
     OR to_regclass('agricoop_app.transactions') IS NULL
     OR to_regclass('agricoop_app.paymentOptions') IS NULL THEN
    RAISE EXCEPTION 'Active-table migration stopped: an existing foreign-key dependency is missing';
  END IF;

  SELECT array_agg(format('%I', table_name) ORDER BY table_name)
    INTO existing_tables
    FROM (VALUES
      ('cooperativeAssociationRequests'),
      ('productImages'),
      ('payments'),
      ('paymentEvents'),
      ('notifications'),
      ('supportTickets'),
      ('supportTicketMessages'),
      ('auditLogs')
    ) AS expected(table_name)
   WHERE to_regclass(format('agricoop_app.%I', table_name)) IS NOT NULL;

  IF existing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Active-table migration stopped: existing application tables require structural reconciliation';
  END IF;

  IF to_regtype('agricoop_app.association_request_status') IS NOT NULL THEN
    SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
      INTO association_labels
      FROM pg_enum
     WHERE enumtypid = 'agricoop_app.association_request_status'::regtype;
    IF association_labels IS DISTINCT FROM ARRAY['pending', 'approved', 'rejected']::text[] THEN
      RAISE EXCEPTION 'Active-table migration stopped: association_request_status labels differ from the application schema';
    END IF;
  END IF;
END
$preflight$;

DO $association_enum$
BEGIN
  IF to_regtype('agricoop_app.association_request_status') IS NULL THEN
    CREATE TYPE agricoop_app.association_request_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END
$association_enum$;

CREATE TABLE agricoop_app."cooperativeAssociationRequests" (
  "id" serial PRIMARY KEY,
  "sellerId" integer NOT NULL REFERENCES agricoop_app.users("id"),
  "cooperativeId" integer NOT NULL REFERENCES agricoop_app.cooperatives("id"),
  "status" agricoop_app.association_request_status NOT NULL DEFAULT 'pending',
  "message" text,
  "reviewNote" text,
  "reviewedBy" integer REFERENCES agricoop_app.users("id"),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "reviewedAt" timestamp
);
CREATE INDEX "cooperativeAssociationRequests_seller_status_idx"
  ON agricoop_app."cooperativeAssociationRequests" ("sellerId", "status");
CREATE INDEX "cooperativeAssociationRequests_cooperative_status_idx"
  ON agricoop_app."cooperativeAssociationRequests" ("cooperativeId", "status");
CREATE UNIQUE INDEX "cooperativeAssociationRequests_one_pending_seller_idx"
  ON agricoop_app."cooperativeAssociationRequests" ("sellerId")
  WHERE "status" = 'pending';

CREATE TABLE agricoop_app."productImages" (
  "id" serial PRIMARY KEY,
  "productId" integer NOT NULL REFERENCES agricoop_app.products("id") ON DELETE CASCADE,
  "imageUrl" varchar(1000) NOT NULL,
  "displayOrder" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX "productImages_product_order_idx"
  ON agricoop_app."productImages" ("productId", "displayOrder");

CREATE TABLE agricoop_app.payments (
  "id" serial PRIMARY KEY,
  "orderId" integer NOT NULL REFERENCES agricoop_app.orders("id"),
  "buyerId" integer NOT NULL REFERENCES agricoop_app.users("id"),
  "sellerId" integer NOT NULL REFERENCES agricoop_app.users("id"),
  "cooperativeId" integer REFERENCES agricoop_app.cooperatives("id"),
  "amountCents" bigint NOT NULL,
  "currency" varchar(8) NOT NULL DEFAULT 'PHP',
  "paymentMethod" varchar(64) NOT NULL DEFAULT 'f2f',
  "paymentOptionId" integer REFERENCES agricoop_app."paymentOptions"("id"),
  "status" text NOT NULL DEFAULT 'pending',
  "verifiedByUserId" integer REFERENCES agricoop_app.users("id"),
  "paymentReference" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "paidAt" timestamp,
  "verifiedAt" timestamp
);
CREATE UNIQUE INDEX "payments_order_id_idx" ON agricoop_app.payments ("orderId");
CREATE INDEX "payments_payment_option_id_idx" ON agricoop_app.payments ("paymentOptionId");

CREATE TABLE agricoop_app."paymentEvents" (
  "id" serial PRIMARY KEY,
  "paymentId" integer NOT NULL REFERENCES agricoop_app.payments("id"),
  "actorUserId" integer REFERENCES agricoop_app.users("id"),
  "eventType" varchar(80) NOT NULL,
  "fromStatus" varchar(32),
  "toStatus" varchar(32),
  "reason" text,
  "metadata" text,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX "payment_events_payment_id_created_at_idx"
  ON agricoop_app."paymentEvents" ("paymentId", "createdAt");

CREATE TABLE agricoop_app.notifications (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES agricoop_app.users("id"),
  "type" varchar(50) NOT NULL,
  "title" varchar(255) NOT NULL,
  "content" text NOT NULL,
  "link" varchar(255),
  "isRead" integer NOT NULL DEFAULT 0,
  "relatedEntityId" integer,
  "relatedEntityType" varchar(50),
  "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE agricoop_app."supportTickets" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES agricoop_app.users("id"),
  "cooperativeId" integer REFERENCES agricoop_app.cooperatives("id"),
  "subject" varchar(255) NOT NULL,
  "category" varchar(100) NOT NULL,
  "description" text NOT NULL,
  "priority" varchar(20) NOT NULL DEFAULT 'medium',
  "status" varchar(20) NOT NULL DEFAULT 'open',
  "assignedToUserId" integer REFERENCES agricoop_app.users("id"),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE agricoop_app."supportTicketMessages" (
  "id" serial PRIMARY KEY,
  "ticketId" integer NOT NULL REFERENCES agricoop_app."supportTickets"("id") ON DELETE CASCADE,
  "senderId" integer NOT NULL REFERENCES agricoop_app.users("id"),
  "body" text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX "supportTicketMessages_ticket_created_idx"
  ON agricoop_app."supportTicketMessages" ("ticketId", "createdAt");

CREATE TABLE agricoop_app."auditLogs" (
  "id" serial PRIMARY KEY,
  "actorUserId" integer NOT NULL REFERENCES agricoop_app.users("id"),
  "action" varchar(100) NOT NULL,
  "entityType" varchar(50) NOT NULL,
  "entityId" integer,
  "cooperativeId" integer REFERENCES agricoop_app.cooperatives("id"),
  "metadata" text,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

DO $secure_new_objects$
DECLARE
  target_table text;
  target_sequence text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'agricoop_app."cooperativeAssociationRequests"',
    'agricoop_app."productImages"',
    'agricoop_app.payments',
    'agricoop_app."paymentEvents"',
    'agricoop_app.notifications',
    'agricoop_app."supportTickets"',
    'agricoop_app."supportTicketMessages"',
    'agricoop_app."auditLogs"'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC, anon, authenticated, service_role', target_table);
    target_sequence := pg_get_serial_sequence(target_table, 'id');
    IF target_sequence IS NULL THEN
      RAISE EXCEPTION 'Active-table migration stopped: an expected identity sequence is unavailable';
    END IF;
    EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', target_sequence);
  END LOOP;
END
$secure_new_objects$;

COMMIT;

-- This migration intentionally grants no client access to the new tables.
-- A separate, reviewed migration must add operation-scoped RLS policies and
-- column/table grants before the corresponding application workflows are enabled.
