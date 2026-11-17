-- REVIEW-ONLY: requires database-owner approval before staging use.
-- Do not apply as part of local implementation or against production.
ALTER TYPE agricoop_app.order_payment_status
  ADD VALUE IF NOT EXISTS 'refunded';
ALTER TYPE agricoop_app.transaction_status
  ADD VALUE IF NOT EXISTS 'refunded';
