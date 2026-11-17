-- REVIEW ONLY / LEGACY TEMPLATE. Do not execute against production without isolation.
-- If ALTER TYPE ... ADD VALUE is ever required, run EACH value in its own committed
-- transaction before any statement that uses the new label (PostgreSQL rule).
-- Current application cancel path does not write cancelled onto order_payment_status.
ALTER TYPE agricoop_app.order_payment_status
  ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TYPE agricoop_app.transaction_status
  ADD VALUE IF NOT EXISTS 'cancelled';
