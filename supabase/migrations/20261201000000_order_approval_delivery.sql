-- Order approval workflow: seller availability confirmation state and COD delivery snapshot.
-- sellerConfirmationStatus tracks the officer-requested seller availability response
-- (pending / available / partially_available / unavailable / needs_clarification).
-- deliveryDetails stores the checkout delivery-address snapshot for cash-on-delivery orders.
ALTER TABLE agricoop_app.orders
  ADD COLUMN IF NOT EXISTS "sellerConfirmationStatus" varchar(32);

ALTER TABLE agricoop_app.orders
  ADD COLUMN IF NOT EXISTS "deliveryDetails" jsonb;
