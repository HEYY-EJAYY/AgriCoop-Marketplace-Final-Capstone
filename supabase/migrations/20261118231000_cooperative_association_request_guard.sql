-- Enforce Seller association-request eligibility at the database boundary.
-- ADDITIVE / IDEMPOTENT. The existing one-pending partial unique index remains authoritative.
--
-- READ-ONLY PREVIEW:
-- SELECT
--   to_regclass('agricoop_app."cooperativeAssociationRequests"') AS requests_table,
--   to_regclass('agricoop_app.users') AS users_table,
--   to_regclass('agricoop_app.cooperatives') AS cooperatives_table,
--   (SELECT count(*) = 6 FROM information_schema.columns
--    WHERE table_schema = 'agricoop_app' AND table_name = 'cooperativeAssociationRequests'
--      AND column_name IN ('message', 'status', 'reviewedBy', 'reviewNote', 'reviewedAt', 'moveExistingListings')) AS request_guard_columns_present,
--   to_regprocedure('agricoop_app.cooperative_association_request_insert_guard()') AS guard_function,
--   (SELECT tgname FROM pg_trigger
--    WHERE tgrelid = to_regclass('agricoop_app."cooperativeAssociationRequests"')
--      AND tgname = 'cooperative_association_request_insert_guard'
--      AND NOT tgisinternal) AS guard_trigger,
--   (SELECT indexdef FROM pg_indexes
--    WHERE schemaname = 'agricoop_app'
--      AND tablename = 'cooperativeAssociationRequests'
--      AND indexname = 'cooperativeAssociationRequests_one_pending_seller_idx') AS pending_request_index;

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('agricoop_app."cooperativeAssociationRequests"') IS NULL
     OR to_regclass('agricoop_app.users') IS NULL
     OR to_regclass('agricoop_app.cooperatives') IS NULL
     OR (
       SELECT count(*)
       FROM information_schema.columns
       WHERE table_schema = 'agricoop_app'
         AND table_name = 'cooperativeAssociationRequests'
         AND column_name IN ('message', 'status', 'reviewedBy', 'reviewNote', 'reviewedAt', 'moveExistingListings')
     ) <> 6
     OR to_regprocedure('agricoop_app.current_app_user_id()') IS NULL
     OR to_regprocedure('agricoop_app.current_app_role()') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       WHERE i.indrelid = 'agricoop_app."cooperativeAssociationRequests"'::regclass
         AND c.relname = 'cooperativeAssociationRequests_one_pending_seller_idx'
         AND i.indisunique
         AND pg_get_expr(i.indpred, i.indrelid) LIKE '%pending%'
     ) THEN
    RAISE EXCEPTION 'Association request guard precondition failed: expected marketplace tables, actor helpers, and one-pending unique index';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION agricoop_app.cooperative_association_request_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id integer := agricoop_app.current_app_user_id();
  actor_role text := agricoop_app.current_app_role();
  seller_role text;
  seller_status text;
  seller_deleted boolean;
  seller_cooperative_id integer;
  cooperative_status text;
  cooperative_deleted boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF actor_id IS NULL THEN
    IF current_setting('role', true) = 'authenticated'
       OR nullif(current_setting('request.jwt.claim.sub', true), '') IS NOT NULL THEN
      RAISE EXCEPTION 'Association requests require a valid Seller identity'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF actor_role IS DISTINCT FROM 'seller'
     OR NEW."sellerId" IS DISTINCT FROM actor_id
     OR NEW.status::text <> 'pending'
     OR NEW."reviewedBy" IS NOT NULL
     OR NEW."reviewNote" IS NOT NULL
     OR NEW."reviewedAt" IS NOT NULL
     OR NEW."moveExistingListings" IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Only Sellers can submit a new pending association request'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.message IS NULL OR length(btrim(NEW.message)) NOT BETWEEN 1 AND 600 THEN
    RAISE EXCEPTION 'A reason of 1 to 600 characters is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller."role"::text, seller."approvalStatus"::text,
         seller."deletedAt" IS NOT NULL, seller."cooperativeId"
  INTO seller_role, seller_status, seller_deleted, seller_cooperative_id
  FROM agricoop_app.users AS seller
  WHERE seller.id = NEW."sellerId";
  IF NOT FOUND
     OR seller_role <> 'seller'
     OR seller_status = 'suspended'
     OR seller_deleted THEN
    RAISE EXCEPTION 'Suspended, deleted, or non-Seller accounts cannot request a cooperative association'
      USING ERRCODE = '42501';
  END IF;
  IF seller_cooperative_id IS NOT DISTINCT FROM NEW."cooperativeId" THEN
    RAISE EXCEPTION 'Seller is already assigned to the requested cooperative'
      USING ERRCODE = '23514';
  END IF;

  SELECT cooperative.status::text, cooperative."deletedAt" IS NOT NULL
  INTO cooperative_status, cooperative_deleted
  FROM agricoop_app.cooperatives AS cooperative
  WHERE cooperative.id = NEW."cooperativeId";
  IF NOT FOUND OR cooperative_status <> 'active' OR cooperative_deleted THEN
    RAISE EXCEPTION 'Association requests require an active cooperative'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION agricoop_app.cooperative_association_request_insert_guard()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION agricoop_app.cooperative_association_request_insert_guard()
  TO authenticated;

DROP TRIGGER IF EXISTS cooperative_association_request_insert_guard
  ON agricoop_app."cooperativeAssociationRequests";
CREATE TRIGGER cooperative_association_request_insert_guard
  BEFORE INSERT ON agricoop_app."cooperativeAssociationRequests"
  FOR EACH ROW
  EXECUTE FUNCTION agricoop_app.cooperative_association_request_insert_guard();

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'agricoop_app."cooperativeAssociationRequests"'::regclass
      AND tgname = 'cooperative_association_request_insert_guard'
      AND NOT tgisinternal
  ) OR to_regprocedure('agricoop_app.cooperative_association_request_insert_guard()') IS NULL THEN
    RAISE EXCEPTION 'Association request guard migration verification failed';
  END IF;
END;
$postflight$;

COMMIT;
