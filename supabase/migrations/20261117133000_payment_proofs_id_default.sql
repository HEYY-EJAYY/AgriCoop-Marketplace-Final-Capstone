-- PURPOSE: Additive default for paymentProofs.id when production has no sequence/identity (B8),
--          plus partial unique index for one active pending/verified proof per order.
-- LIVE CHECK (2026-11-17): production already has nextval('agricoop_app."paymentProofs_id_seq"');
--          the sequence/default section will NOTICE-skip; unique index still applies.
-- DEPENDENCIES: agricoop_app."paymentProofs" exists.
-- TOUCHES: CREATE SEQUENCE IF NOT EXISTS only if missing; OWNED BY; SET DEFAULT; setval; partial unique index.
-- DOES NOT TOUCH: existing proof rows' ids; payment-proofs bucket; other tables.
-- Compatible with app code that still uses advisory lock + max(id)+1 (both can coexist).
-- OWNER-RUN ONLY (paste via docs/MANUAL_SQL.md). Never executed by the agent.

BEGIN;

DO $preflight$
DECLARE
  dup_count integer;
BEGIN
  IF to_regclass('agricoop_app."paymentProofs"') IS NULL THEN
    RAISE EXCEPTION 'paymentProofs id migration stopped: table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'agricoop_app."paymentProofs"'::regclass
      AND attname = 'id'
      AND atttypid = 'integer'::regtype
      AND attnotnull
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'paymentProofs id migration stopped: id must be NOT NULL integer';
  END IF;

  -- Abort if active pending/verified duplicates would break the unique index
  SELECT count(*) INTO dup_count
  FROM (
    SELECT "orderId"
    FROM agricoop_app."paymentProofs"
    WHERE "verificationStatus" IN ('pending', 'verified')
    GROUP BY "orderId"
    HAVING count(*) > 1
  ) dups;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'paymentProofs id migration stopped: % orderId(s) have duplicate pending/verified proofs; reconcile manually', dup_count;
  END IF;
END
$preflight$;

DO $add_default$
DECLARE
  max_id integer;
  seq_name text := 'agricoop_app."paymentProofs_id_seq"';
BEGIN
  IF pg_get_serial_sequence('agricoop_app."paymentProofs"', 'id') IS NOT NULL THEN
    -- Already has a default sequence/identity — do not overwrite
    RAISE NOTICE 'paymentProofs.id already has a sequence default; skipping sequence create';
  ELSE
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %s AS integer', seq_name);
    EXECUTE format('ALTER SEQUENCE %s OWNED BY agricoop_app."paymentProofs".id', seq_name);
    SELECT coalesce(max(id), 0) INTO max_id FROM agricoop_app."paymentProofs";
    IF max_id = 0 THEN
      EXECUTE format('SELECT setval(%L::regclass, 1, false)', seq_name);
    ELSE
      EXECUTE format('SELECT setval(%L::regclass, %s, true)', seq_name, max_id);
    END IF;
    -- Only set DEFAULT when none exists
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = 'agricoop_app."paymentProofs"'::regclass
        AND attname = 'id'
        AND atthasdef
        AND NOT attisdropped
    ) THEN
      EXECUTE format(
        'ALTER TABLE agricoop_app."paymentProofs" ALTER COLUMN id SET DEFAULT nextval(%L)',
        seq_name
      );
    END IF;
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', seq_name);
  END IF;
END
$add_default$;

CREATE UNIQUE INDEX IF NOT EXISTS "paymentProofs_one_active_order_idx"
  ON agricoop_app."paymentProofs" ("orderId")
  WHERE "verificationStatus" IN ('pending', 'verified');

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'agricoop_app'
      AND indexname = 'paymentProofs_one_active_order_idx'
  ) THEN
    RAISE EXCEPTION 'paymentProofs id migration postflight failed: unique index missing';
  END IF;
END
$postflight$;

COMMIT;

-- Verification:
-- SELECT column_default FROM information_schema.columns
--  WHERE table_schema='agricoop_app' AND table_name='paymentProofs' AND column_name='id';
-- SELECT indexname, indexdef FROM pg_indexes
--  WHERE schemaname='agricoop_app' AND indexname='paymentProofs_one_active_order_idx';

-- ROLLBACK:
-- DROP INDEX IF EXISTS agricoop_app."paymentProofs_one_active_order_idx";
-- ALTER TABLE agricoop_app."paymentProofs" ALTER COLUMN id DROP DEFAULT;
-- -- only drop sequence if owned solely by this column and unused
