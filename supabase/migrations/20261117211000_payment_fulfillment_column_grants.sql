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
