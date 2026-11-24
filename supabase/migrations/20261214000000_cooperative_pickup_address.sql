-- Structured cooperative pickup address for OfficerAdmin "My Cooperative".
--
-- Buyers choosing Pickup need an accurate cooperative pickup location. The
-- existing free-text address/location columns stay untouched; these nullable
-- columns hold the structured pickup address parts (province, city/municipality,
-- barangay, street/building/landmark). All columns are nullable with no
-- defaults rewritten, so existing rows and historical order snapshots are
-- unaffected. Pickup instructions remain in "pickupInstructions".

ALTER TABLE agricoop_app.cooperatives
  ADD COLUMN IF NOT EXISTS "pickupProvince" varchar(120),
  ADD COLUMN IF NOT EXISTS "pickupCity" varchar(120),
  ADD COLUMN IF NOT EXISTS "pickupBarangay" varchar(120),
  ADD COLUMN IF NOT EXISTS "pickupStreetAddress" varchar(255);

-- Column-level grants mirror the existing pickup-detail write grants so the
-- authenticated role can maintain the pickup address through the app.
GRANT INSERT ("pickupProvince", "pickupCity", "pickupBarangay", "pickupStreetAddress")
  ON TABLE agricoop_app.cooperatives TO authenticated;
GRANT UPDATE ("pickupProvince", "pickupCity", "pickupBarangay", "pickupStreetAddress")
  ON TABLE agricoop_app.cooperatives TO authenticated;
