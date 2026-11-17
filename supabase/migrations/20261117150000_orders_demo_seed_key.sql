-- Additive: align live orders with Drizzle (demo seed idempotency column).
BEGIN;

ALTER TABLE agricoop_app.orders
  ADD COLUMN IF NOT EXISTS "demoSeedKey" character varying(80);

CREATE UNIQUE INDEX IF NOT EXISTS orders_demo_seed_key_idx
  ON agricoop_app.orders ("demoSeedKey");

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'agricoop_app'
      AND table_name = 'orders'
      AND column_name = 'demoSeedKey'
  ) THEN
    RAISE EXCEPTION 'orders.demoSeedKey missing after migration';
  END IF;
END
$postflight$;

COMMIT;
