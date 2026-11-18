-- BLOCK 25: Cooperative address + location keys, soft delete, duplicate unique index.
-- ADDITIVE / IDEMPOTENT. Replaces name-only unique with (normalizedName, normalizedLocation)
-- for non-deleted rows. Extends create_user_cooperative and audit allowlist.

BEGIN;

ALTER TABLE agricoop_app.cooperatives
  ADD COLUMN IF NOT EXISTS address varchar(255) NOT NULL DEFAULT '';

ALTER TABLE agricoop_app.cooperatives
  ADD COLUMN IF NOT EXISTS "normalizedLocation" varchar(180);

ALTER TABLE agricoop_app.cooperatives
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp without time zone;

ALTER TABLE agricoop_app.cooperatives
  ADD COLUMN IF NOT EXISTS "deletedBy" integer REFERENCES agricoop_app.users(id);

-- Backfill normalized location from existing location text.
UPDATE agricoop_app.cooperatives
SET "normalizedLocation" = lower(regexp_replace(regexp_replace(btrim(location), '[[:punct:]]+', '', 'g'), '\s+', '', 'g'))
WHERE "normalizedLocation" IS NULL OR btrim("normalizedLocation") = '';

UPDATE agricoop_app.cooperatives
SET "normalizedLocation" = 'philippines'
WHERE "normalizedLocation" IS NULL OR btrim("normalizedLocation") = '';

ALTER TABLE agricoop_app.cooperatives
  ALTER COLUMN "normalizedLocation" SET NOT NULL;

ALTER TABLE agricoop_app.cooperatives
  ALTER COLUMN "normalizedLocation" SET DEFAULT '';

-- Replace name-only uniqueness so same name + different location can coexist.
DROP INDEX IF EXISTS agricoop_app.cooperatives_normalized_name_idx;

CREATE UNIQUE INDEX IF NOT EXISTS cooperatives_normalized_name_location_uidx
  ON agricoop_app.cooperatives ("normalizedName", "normalizedLocation")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS cooperatives_deleted_at_idx
  ON agricoop_app.cooperatives ("deletedAt");

-- Active pickers / public reads exclude soft-deleted rows; staff still see deleted for restore.
DROP POLICY IF EXISTS agricoop_mkt_cooperatives_anon_read ON agricoop_app.cooperatives;
CREATE POLICY agricoop_mkt_cooperatives_anon_read
  ON agricoop_app.cooperatives FOR SELECT TO anon, authenticated
  USING (
    ("deletedAt" IS NULL AND status = 'active')
    OR agricoop_app.is_staff()
  );

DROP POLICY IF EXISTS agricoop_mkt_cooperatives_staff_write ON agricoop_app.cooperatives;
CREATE POLICY agricoop_mkt_cooperatives_staff_write
  ON agricoop_app.cooperatives FOR ALL TO authenticated
  USING (agricoop_app.is_staff())
  WITH CHECK (agricoop_app.is_staff());

GRANT SELECT (address, "normalizedLocation", "deletedAt", "deletedBy")
  ON TABLE agricoop_app.cooperatives TO anon, authenticated;
GRANT INSERT (address, "normalizedLocation")
  ON TABLE agricoop_app.cooperatives TO authenticated;
GRANT UPDATE (address, "normalizedLocation", "deletedAt", "deletedBy", location, name, "normalizedName", description, status)
  ON TABLE agricoop_app.cooperatives TO authenticated;

-- User-created cooperatives: address + normalized location + conflict on composite key.
CREATE OR REPLACE FUNCTION agricoop_app.create_user_cooperative(
  p_name varchar,
  p_normalized_name varchar,
  p_location varchar,
  p_description text DEFAULT NULL,
  p_address varchar DEFAULT '',
  p_normalized_location varchar DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  actor_id integer := agricoop_app.current_app_user_id();
  new_id integer;
  loc_key varchar := coalesce(
    nullif(btrim(p_normalized_location), ''),
    lower(regexp_replace(regexp_replace(btrim(coalesce(p_location, '')), '[[:punct:]]+', '', 'g'), '\s+', '', 'g'))
  );
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Cooperative creation requires an authenticated application user';
  END IF;
  IF loc_key IS NULL OR length(loc_key) = 0 THEN
    loc_key := 'philippines';
  END IF;
  INSERT INTO agricoop_app.cooperatives (
    name, "normalizedName", location, address, "normalizedLocation", description, status, source, "createdBy"
  ) VALUES (
    p_name, p_normalized_name, p_location, coalesce(p_address, ''), loc_key, p_description, 'active', 'user', actor_id
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END
$fn$;

REVOKE ALL ON FUNCTION agricoop_app.create_user_cooperative(varchar, varchar, varchar, text, varchar, varchar)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION agricoop_app.create_user_cooperative(varchar, varchar, varchar, text, varchar, varchar)
  TO authenticated;

-- Keep legacy 4-arg signature as a thin wrapper for older callers.
CREATE OR REPLACE FUNCTION agricoop_app.create_user_cooperative(
  p_name varchar,
  p_normalized_name varchar,
  p_location varchar,
  p_description text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  RETURN agricoop_app.create_user_cooperative(
    p_name, p_normalized_name, p_location, p_description, '', NULL
  );
END
$fn$;

REVOKE ALL ON FUNCTION agricoop_app.create_user_cooperative(varchar, varchar, varchar, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION agricoop_app.create_user_cooperative(varchar, varchar, varchar, text)
  TO authenticated;

-- Audit allowlist: soft delete / restore (preserve existing signature: metadata text → bigint)
CREATE OR REPLACE FUNCTION agricoop_app.write_audit_log(
  p_action varchar,
  p_entity_type varchar,
  p_entity_id integer DEFAULT NULL,
  p_cooperative_id integer DEFAULT NULL,
  p_metadata text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  actor_id integer := agricoop_app.current_app_user_id();
  actor_role text := agricoop_app.current_app_role();
  new_id bigint;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Audit write requires an authenticated application user';
  END IF;
  IF p_action IS NULL OR length(btrim(p_action)) = 0 OR length(p_action) > 100 THEN
    RAISE EXCEPTION 'Audit action is invalid';
  END IF;
  IF p_entity_type IS NULL OR length(btrim(p_entity_type)) = 0 OR length(p_entity_type) > 50 THEN
    RAISE EXCEPTION 'Audit entity type is invalid';
  END IF;
  IF p_action NOT IN (
    'product.content_revised_for_review',
    'product_approved',
    'product_rejected',
    'cooperative_association_requested',
    'cooperative_association_approved',
    'cooperative_association_rejected',
    'member_approval_status_updated',
    'user_access_updated',
    'support_ticket_created',
    'support_ticket_assigned',
    'support_ticket_reply_sent',
    'support_ticket_status_updated',
    'cooperative_updated',
    'cooperative_deactivated',
    'cooperative_activated',
    'cooperative_soft_deleted',
    'cooperative_restored'
  ) THEN
    RAISE EXCEPTION 'Audit action is not permitted';
  END IF;
  IF actor_role NOT IN ('seller', 'admin', 'superadmin', 'buyer') THEN
    RAISE EXCEPTION 'Audit actor role is not permitted';
  END IF;

  INSERT INTO agricoop_app."auditLogs" (
    "actorUserId", "action", "entityType", "entityId", "cooperativeId", "metadata"
  ) VALUES (
    actor_id, p_action, p_entity_type, p_entity_id, p_cooperative_id, p_metadata
  ) RETURNING id INTO new_id;

  RETURN new_id;
END
$fn$;

COMMIT;

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'agricoop_app' AND table_name = 'cooperatives' AND column_name = 'address'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'agricoop_app' AND table_name = 'cooperatives' AND column_name = 'normalizedLocation'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'agricoop_app' AND table_name = 'cooperatives' AND column_name = 'deletedAt'
  ) THEN
    RAISE EXCEPTION 'cooperative_address_soft_delete_duplicates postflight failed';
  END IF;
END
$postflight$;
