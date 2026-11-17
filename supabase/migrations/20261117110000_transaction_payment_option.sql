-- Unexecuted additive migration draft. Requires an owner-reviewed production
-- catalog snapshot and a maintenance window before application.
-- Adds a nullable link only; it creates no records and does not change existing values.

BEGIN;

DO $migration$
DECLARE
  transaction_table regclass := to_regclass('"agricoop_app"."transactions"');
  option_table regclass := to_regclass('"agricoop_app"."paymentOptions"');
  transaction_option_attnum smallint;
  option_id_attnum smallint;
  existing_fk record;
  existing_index record;
BEGIN
  IF transaction_table IS NULL OR option_table IS NULL THEN
    RAISE EXCEPTION 'Precondition failed: agricoop_app transactions and paymentOptions tables must already exist';
  END IF;

  SELECT attnum INTO option_id_attnum
  FROM pg_attribute
  WHERE attrelid = option_table AND attname = 'id' AND NOT attisdropped;
  IF option_id_attnum IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = option_table
      AND attname = 'id'
      AND atttypid = 'integer'::regtype
      AND attnotnull
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Precondition failed: paymentOptions.id must be a non-null integer';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = transaction_table
      AND attname = 'paymentOptionId'
      AND NOT attisdropped
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = transaction_table
      AND attname = 'paymentOptionId'
      AND atttypid = 'integer'::regtype
      AND NOT attnotnull
      AND NOT atthasdef
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Precondition failed: existing transactions.paymentOptionId must be nullable integer';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = transaction_table
      AND attname = 'paymentOptionId'
      AND NOT attisdropped
  ) THEN
    ALTER TABLE agricoop_app."transactions"
      ADD COLUMN "paymentOptionId" integer;
  END IF;

  SELECT attnum INTO transaction_option_attnum
  FROM pg_attribute
  WHERE attrelid = transaction_table
    AND attname = 'paymentOptionId'
    AND NOT attisdropped;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = transaction_table
      AND contype = 'f'
      AND conkey = ARRAY[transaction_option_attnum]::smallint[]
      AND confrelid = option_table
      AND conname <> 'transactions_paymentOptionId_fkey'
  ) THEN
    RAISE EXCEPTION 'Precondition failed: an equivalent payment-option FK exists under an unexpected name';
  END IF;

  SELECT * INTO existing_fk
  FROM pg_constraint
  WHERE conrelid = transaction_table
    AND conname = 'transactions_paymentOptionId_fkey';

  IF FOUND AND (
    existing_fk.contype <> 'f'
    OR existing_fk.conkey <> ARRAY[transaction_option_attnum]::smallint[]
    OR existing_fk.confrelid <> option_table
    OR existing_fk.confkey <> ARRAY[option_id_attnum]::smallint[]
    OR existing_fk.confdeltype <> 'n'
    OR NOT existing_fk.convalidated
  ) THEN
    RAISE EXCEPTION 'Precondition failed: transactions_paymentOptionId_fkey exists with unexpected definition';
  ELSIF NOT FOUND THEN
    ALTER TABLE agricoop_app."transactions"
      ADD CONSTRAINT "transactions_paymentOptionId_fkey"
      FOREIGN KEY ("paymentOptionId")
      REFERENCES agricoop_app."paymentOptions" ("id")
      ON DELETE SET NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = transaction_table
      AND i.indkey[0] = transaction_option_attnum
      AND i.indnkeyatts = 1
      AND i.indnatts = 1
      AND c.relname <> 'transactionsPaymentOptionIdIdx'
  ) THEN
    RAISE EXCEPTION 'Precondition failed: an equivalent payment-option index exists under an unexpected name';
  END IF;

  SELECT i.* INTO existing_index
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  WHERE i.indrelid = transaction_table
    AND c.relname = 'transactionsPaymentOptionIdIdx';

  IF FOUND AND (
    NOT existing_index.indisvalid
    OR NOT existing_index.indisready
    OR existing_index.indisunique
    OR existing_index.indpred IS NOT NULL
    OR existing_index.indnkeyatts <> 1
    OR existing_index.indnatts <> 1
    OR existing_index.indkey[0] <> transaction_option_attnum
  ) THEN
    RAISE EXCEPTION 'Precondition failed: transactionsPaymentOptionIdIdx exists with unexpected definition';
  ELSIF NOT FOUND THEN
    CREATE INDEX "transactionsPaymentOptionIdIdx"
      ON agricoop_app."transactions" ("paymentOptionId");
  END IF;
END
$migration$;

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = to_regclass('"agricoop_app"."transactions"')
      AND attname = 'paymentOptionId'
      AND atttypid = 'integer'::regtype
      AND NOT attnotnull
      AND NOT atthasdef
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = to_regclass('"agricoop_app"."transactions"')
      AND conname = 'transactions_paymentOptionId_fkey'
      AND contype = 'f'
      AND confrelid = to_regclass('"agricoop_app"."paymentOptions"')
      AND confdeltype = 'n'
      AND convalidated
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = to_regclass('"agricoop_app"."transactions"')
      AND c.relname = 'transactionsPaymentOptionIdIdx'
      AND i.indisvalid
      AND i.indisready
      AND NOT i.indisunique
      AND i.indpred IS NULL
      AND i.indnkeyatts = 1
      AND i.indnatts = 1
  ) THEN
    RAISE EXCEPTION 'Postcondition failed: payment-option column, FK, or index is missing or invalid';
  END IF;
END
$postflight$;

COMMIT;

-- Read-only verification after an approved application:
-- SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS data_type, a.attnotnull
-- FROM pg_attribute a
-- WHERE a.attrelid = '"agricoop_app"."transactions"'::regclass
--   AND a.attname = 'paymentOptionId' AND NOT a.attisdropped;
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = '"agricoop_app"."transactions"'::regclass
--   AND conname = 'transactions_paymentOptionId_fkey';
-- SELECT indexrelid::regclass, indisvalid, pg_get_indexdef(indexrelid)
-- FROM pg_index
-- WHERE indrelid = '"agricoop_app"."transactions"'::regclass
--   AND indexrelid::regclass::text LIKE '%transactionsPaymentOptionIdIdx';

-- Rollback guidance: this additive nullable link does not alter existing rows.
-- Before rollback, verify there are no non-NULL paymentOptionId values and no
-- dependent app version. Then manually drop only the confirmed FK, index, and
-- column in a transaction. Retain the column if any selected option is stored.
-- Do not execute rollback automatically.
