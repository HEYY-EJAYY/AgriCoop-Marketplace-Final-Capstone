-- Product-level online payment eligibility.
-- Sellers/OfficerAdmins can disable online payment per listing; checkout and
-- order creation must then exclude online methods for orders containing it.
-- New columns do not inherit prior column-level grants on agricoop_app.products,
-- so SELECT/INSERT/UPDATE privileges must be granted explicitly.
ALTER TABLE agricoop_app.products
  ADD COLUMN IF NOT EXISTS "onlinePaymentEnabled" boolean NOT NULL DEFAULT true;

GRANT SELECT ("onlinePaymentEnabled") ON TABLE agricoop_app.products TO anon, authenticated;
GRANT INSERT ("onlinePaymentEnabled") ON TABLE agricoop_app.products TO authenticated;
GRANT UPDATE ("onlinePaymentEnabled") ON TABLE agricoop_app.products TO authenticated;

DO $postflight$
BEGIN
  IF NOT has_column_privilege('anon', 'agricoop_app.products', 'onlinePaymentEnabled', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.products', 'onlinePaymentEnabled', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.products', 'onlinePaymentEnabled', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.products', 'onlinePaymentEnabled', 'UPDATE')
  THEN
    RAISE EXCEPTION 'product_online_payment_toggle postflight failed: column privileges missing';
  END IF;
END
$postflight$;
