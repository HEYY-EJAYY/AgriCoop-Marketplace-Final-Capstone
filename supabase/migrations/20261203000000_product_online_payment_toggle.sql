-- Product-level online payment eligibility.
-- Sellers/OfficerAdmins can disable online payment per listing; checkout and
-- order creation must then exclude online methods for orders containing it.
ALTER TABLE agricoop_app.products
  ADD COLUMN IF NOT EXISTS "onlinePaymentEnabled" boolean NOT NULL DEFAULT true;
