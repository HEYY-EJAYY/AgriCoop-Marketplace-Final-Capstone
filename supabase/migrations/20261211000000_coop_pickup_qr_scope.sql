-- Cooperative pickup details + immutable order pickup snapshots + QR coop isolation.
--
-- 1. cooperatives gains pickup contact/instructions/hours so each cooperative can
--    publish where buyers collect orders. Existing name/location/address columns
--    continue to hold the official name and address.
-- 2. orders gains pickupDetails jsonb: an immutable snapshot of the cooperative
--    pickup information captured when a pickup order is placed.
-- 3. paymentOptions."cooperativeId" becomes NOT NULL: every QR payment option must
--    belong to exactly one cooperative. Platform-wide (NULL) options are removed
--    from the data model; the application already rejects creating them.

ALTER TABLE agricoop_app.cooperatives
  ADD COLUMN IF NOT EXISTS "pickupContactNumber" varchar(40),
  ADD COLUMN IF NOT EXISTS "pickupInstructions" text,
  ADD COLUMN IF NOT EXISTS "operatingHours" varchar(160);

ALTER TABLE agricoop_app.orders
  ADD COLUMN IF NOT EXISTS "pickupDetails" jsonb;

ALTER TABLE agricoop_app."paymentOptions"
  ALTER COLUMN "cooperativeId" SET NOT NULL;

-- Column-level grants mirror the existing cooperative write grants so the
-- authenticated role can maintain pickup details through the app.
GRANT INSERT ("pickupContactNumber", "pickupInstructions", "operatingHours")
  ON TABLE agricoop_app.cooperatives TO authenticated;
GRANT UPDATE ("pickupContactNumber", "pickupInstructions", "operatingHours")
  ON TABLE agricoop_app.cooperatives TO authenticated;
