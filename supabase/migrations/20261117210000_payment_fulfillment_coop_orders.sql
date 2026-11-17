-- Additive: listing fulfillment/online flags, order fulfillmentMethod, seller QR columns,
-- orderHistory timeline, SUTAFACO Cooperative seed + scoped NULL backfill.

-- Product listing options
ALTER TABLE agricoop_app.products
  ADD COLUMN IF NOT EXISTS "allowsPickup" boolean NOT NULL DEFAULT true;
ALTER TABLE agricoop_app.products
  ADD COLUMN IF NOT EXISTS "allowsDelivery" boolean NOT NULL DEFAULT true;
ALTER TABLE agricoop_app.products
  ADD COLUMN IF NOT EXISTS "acceptsOnlinePayment" boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_fulfillment_at_least_one'
      AND conrelid = 'agricoop_app.products'::regclass
  ) THEN
    ALTER TABLE agricoop_app.products
      ADD CONSTRAINT products_fulfillment_at_least_one
      CHECK ("allowsPickup" OR "allowsDelivery");
  END IF;
END $$;

-- Order fulfillment separate from payment method
ALTER TABLE agricoop_app.orders
  ADD COLUMN IF NOT EXISTS "fulfillmentMethod" varchar(32);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_fulfillment_method_check'
      AND conrelid = 'agricoop_app.orders'::regclass
  ) THEN
    ALTER TABLE agricoop_app.orders
      ADD CONSTRAINT orders_fulfillment_method_check
      CHECK ("fulfillmentMethod" IS NULL OR "fulfillmentMethod" IN ('pickup', 'delivery'));
  END IF;
END $$;

-- Seller online-payment QR profile (paths/labels only)
ALTER TABLE agricoop_app.users
  ADD COLUMN IF NOT EXISTS "onlinePaymentQrPath" text;
ALTER TABLE agricoop_app.users
  ADD COLUMN IF NOT EXISTS "onlinePaymentAccountName" varchar(150);
ALTER TABLE agricoop_app.users
  ADD COLUMN IF NOT EXISTS "onlinePaymentAccountNumber" varchar(100);
ALTER TABLE agricoop_app.users
  ADD COLUMN IF NOT EXISTS "onlinePaymentLabel" varchar(150);

-- Order + payment timeline (additive; orderEvents remains for stock notes)
CREATE TABLE IF NOT EXISTS agricoop_app."orderHistory" (
  id serial PRIMARY KEY,
  "orderId" integer NOT NULL REFERENCES agricoop_app.orders(id),
  "actorUserId" integer REFERENCES agricoop_app.users(id),
  "eventType" varchar(64) NOT NULL,
  "fromValue" varchar(64),
  "toValue" varchar(64),
  note text,
  "createdAt" timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_history_order_id_idx
  ON agricoop_app."orderHistory" ("orderId", "createdAt");

ALTER TABLE agricoop_app."orderHistory" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'agricoop_app' AND tablename = 'orderHistory' AND policyname = 'agricoop_order_history_select'
  ) THEN
    CREATE POLICY agricoop_order_history_select
      ON agricoop_app."orderHistory"
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM agricoop_app.orders o
          JOIN agricoop_app.users me ON me."openId" = (SELECT auth.uid()::text)
          WHERE o.id = "orderHistory"."orderId"
            AND (
              o."buyerId" = me.id
              OR o."sellerId" = me.id
              OR me.role IN ('admin', 'superadmin')
            )
        )
      );
  END IF;
END $$;

GRANT SELECT ON TABLE agricoop_app."orderHistory" TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE agricoop_app."orderHistory" TO service_role;
GRANT USAGE, SELECT ON SEQUENCE agricoop_app."orderHistory_id_seq" TO service_role;

-- Exact cooperative name required by product brief (do not rename existing Sutafaco variant)
INSERT INTO agricoop_app.cooperatives (name, "normalizedName", location, status)
SELECT 'SUTAFACO Cooperative', 'sutafacocooperative', 'Butuan City', 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM agricoop_app.cooperatives WHERE "normalizedName" = 'sutafacocooperative'
);

-- Scoped backfill only where cooperativeId IS NULL (previewed: 0 sellers / 0 products at apply time)
UPDATE agricoop_app.users u
SET "cooperativeId" = c.id
FROM agricoop_app.cooperatives c
WHERE c."normalizedName" = 'sutafacocooperative'
  AND u.role = 'seller'
  AND u."cooperativeId" IS NULL;

UPDATE agricoop_app.products p
SET "cooperativeId" = c.id
FROM agricoop_app.cooperatives c
WHERE c."normalizedName" = 'sutafacocooperative'
  AND p."cooperativeId" IS NULL;

-- Seller QR private bucket (signed read after authz)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'seller-payment-qr',
  'seller-payment-qr',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'seller_payment_qr_owner_insert'
  ) THEN
    CREATE POLICY seller_payment_qr_owner_insert
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'seller-payment-qr'
        AND split_part(name, '/', 1) = (SELECT auth.uid()::text)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'seller_payment_qr_owner_update'
  ) THEN
    CREATE POLICY seller_payment_qr_owner_update
      ON storage.objects FOR UPDATE TO authenticated
      USING (
        bucket_id = 'seller-payment-qr'
        AND split_part(name, '/', 1) = (SELECT auth.uid()::text)
      )
      WITH CHECK (
        bucket_id = 'seller-payment-qr'
        AND split_part(name, '/', 1) = (SELECT auth.uid()::text)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'seller_payment_qr_owner_select'
  ) THEN
    CREATE POLICY seller_payment_qr_owner_select
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'seller-payment-qr'
        AND split_part(name, '/', 1) = (SELECT auth.uid()::text)
      );
  END IF;
END $$;
