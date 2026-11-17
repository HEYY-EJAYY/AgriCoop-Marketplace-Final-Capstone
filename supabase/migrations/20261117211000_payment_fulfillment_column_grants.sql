-- Column grants for payment/fulfillment fields added in 20261117210000.
-- New columns do not inherit prior column-level marketplace GRANTs.

GRANT SELECT ("allowsPickup", "allowsDelivery", "acceptsOnlinePayment")
  ON TABLE agricoop_app.products TO anon, authenticated;

GRANT SELECT (
  "onlinePaymentQrPath",
  "onlinePaymentAccountName",
  "onlinePaymentAccountNumber",
  "onlinePaymentLabel"
) ON TABLE agricoop_app.users TO authenticated;

GRANT UPDATE (
  "onlinePaymentQrPath",
  "onlinePaymentAccountName",
  "onlinePaymentAccountNumber",
  "onlinePaymentLabel"
) ON TABLE agricoop_app.users TO authenticated;

-- Marketplace cards only need a boolean presence check for seller QR.
GRANT SELECT ("onlinePaymentQrPath") ON TABLE agricoop_app.users TO anon;

GRANT SELECT ("fulfillmentMethod") ON TABLE agricoop_app.orders TO authenticated;

DO $postflight$
BEGIN
  IF NOT has_column_privilege('anon', 'agricoop_app.products', 'allowsPickup', 'SELECT')
     OR NOT has_column_privilege('anon', 'agricoop_app.products', 'allowsDelivery', 'SELECT')
     OR NOT has_column_privilege('anon', 'agricoop_app.products', 'acceptsOnlinePayment', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'onlinePaymentAccountName', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'onlinePaymentAccountNumber', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'onlinePaymentLabel', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'onlinePaymentQrPath', 'SELECT')
     OR NOT has_column_privilege('anon', 'agricoop_app.users', 'onlinePaymentQrPath', 'SELECT')
     OR has_column_privilege('anon', 'agricoop_app.users', 'onlinePaymentAccountName', 'SELECT')
     OR has_column_privilege('anon', 'agricoop_app.users', 'onlinePaymentAccountNumber', 'SELECT')
     OR has_column_privilege('anon', 'agricoop_app.users', 'onlinePaymentLabel', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.orders', 'fulfillmentMethod', 'SELECT')
  THEN
    RAISE EXCEPTION 'payment_fulfillment_column_grants postflight failed: column privileges do not match least-privilege expectations';
  END IF;
END
$postflight$;
