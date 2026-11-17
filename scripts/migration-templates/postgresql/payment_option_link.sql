-- SUPERSEDED (B5): Do NOT apply.
-- Canonical design is transactions.paymentOptionId via
-- supabase/migrations/20261117110000_transaction_payment_option.sql
-- (matches active checkout code). This template targets payments.paymentOptionId instead.
-- REVIEW ONLY / LEGACY TEMPLATE.
BEGIN;

ALTER TABLE agricoop_app.payments
  ADD COLUMN IF NOT EXISTS "paymentOptionId" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payments_paymentOptionId_paymentOptions_id_fk'
      AND conrelid = 'agricoop_app.payments'::regclass
  ) THEN
    ALTER TABLE agricoop_app.payments
      ADD CONSTRAINT "payments_paymentOptionId_paymentOptions_id_fk"
      FOREIGN KEY ("paymentOptionId")
      REFERENCES agricoop_app."paymentOptions"(id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS payments_payment_option_id_idx
  ON agricoop_app.payments ("paymentOptionId");

COMMIT;
