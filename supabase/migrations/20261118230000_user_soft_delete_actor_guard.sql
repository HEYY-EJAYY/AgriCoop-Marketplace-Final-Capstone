-- Prevent self-service or forged user tombstones while preserving scoped staff deletes/restores.
-- ADDITIVE / IDEMPOTENT. No rows, tables, or columns are removed.
--
-- READ-ONLY PREVIEW:
-- SELECT
--   to_regclass('agricoop_app.users') AS users_table,
--   (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('agricoop_app.users')) AS rls_enabled,
--   (SELECT count(*) = 3 FROM information_schema.columns
--    WHERE table_schema = 'agricoop_app' AND table_name = 'users'
--      AND column_name IN ('deletedAt', 'deletedBy', 'deletedByRole')) AS tombstone_columns_present,
--   to_regprocedure('agricoop_app.current_app_user_id()') IS NOT NULL AS actor_id_helper_present,
--   to_regprocedure('agricoop_app.current_app_role()') IS NOT NULL AS actor_role_helper_present,
--   has_column_privilege('authenticated', 'agricoop_app.users', 'deletedAt', 'UPDATE') AS authenticated_can_update_tombstone;

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('agricoop_app.users') IS NULL
     OR to_regprocedure('agricoop_app.current_app_user_id()') IS NULL
     OR to_regprocedure('agricoop_app.current_app_role()') IS NULL
     OR to_regprocedure('agricoop_app.current_app_cooperative_id()') IS NULL
     OR (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('agricoop_app.users')) IS DISTINCT FROM true
     OR (
       SELECT count(*)
       FROM information_schema.columns
       WHERE table_schema = 'agricoop_app'
         AND table_name = 'users'
         AND column_name IN ('deletedAt', 'deletedBy', 'deletedByRole')
     ) <> 3 THEN
    RAISE EXCEPTION 'User tombstone guard precondition failed: expected users RLS, actor helpers, and all three soft-delete columns';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION agricoop_app.guard_users_soft_delete_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id integer := agricoop_app.current_app_user_id();
  actor_role text := agricoop_app.current_app_role();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."deletedAt" IS NOT NULL
       OR NEW."deletedBy" IS NOT NULL
       OR NEW."deletedByRole" IS NOT NULL THEN
      RAISE EXCEPTION 'New accounts cannot set user soft-delete fields'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."deletedAt" IS NOT DISTINCT FROM OLD."deletedAt"
     AND NEW."deletedBy" IS NOT DISTINCT FROM OLD."deletedBy"
     AND NEW."deletedByRole" IS NOT DISTINCT FROM OLD."deletedByRole" THEN
    RETURN NEW;
  END IF;

  IF actor_id IS NULL OR actor_role IS NULL OR actor_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Only Admin or SuperAdmin can change user soft-delete fields'
      USING ERRCODE = '42501';
  END IF;
  IF actor_id = OLD.id THEN
    RAISE EXCEPTION 'Administrators cannot soft-delete or restore themselves'
      USING ERRCODE = '42501';
  END IF;
  IF OLD."role" = 'superadmin' THEN
    RAISE EXCEPTION 'A SuperAdmin account cannot be soft-deleted or restored'
      USING ERRCODE = '42501';
  END IF;
  IF actor_role = 'admin'
     AND (
       OLD."role" NOT IN ('buyer', 'seller')
       OR OLD."cooperativeId" IS DISTINCT FROM agricoop_app.current_app_cooperative_id()
     ) THEN
    RAISE EXCEPTION 'Admin can change soft-delete fields only for Buyers or Sellers in their cooperative'
      USING ERRCODE = '42501';
  END IF;

  IF NEW."deletedAt" IS NULL THEN
    IF NEW."deletedBy" IS NOT NULL OR NEW."deletedByRole" IS NOT NULL THEN
      RAISE EXCEPTION 'Restored users must clear all soft-delete fields'
        USING ERRCODE = '22023';
    END IF;
  ELSIF NEW."deletedBy" IS DISTINCT FROM actor_id
     OR NEW."deletedByRole" IS DISTINCT FROM actor_role THEN
    RAISE EXCEPTION 'User soft-delete attribution must match the acting administrator'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION agricoop_app.guard_users_soft_delete_actor()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION agricoop_app.guard_users_soft_delete_actor()
  TO authenticated;

DROP TRIGGER IF EXISTS agricoop_users_soft_delete_actor_guard ON agricoop_app.users;
CREATE TRIGGER agricoop_users_soft_delete_actor_guard
  BEFORE INSERT OR UPDATE OF "deletedAt", "deletedBy", "deletedByRole"
  ON agricoop_app.users
  FOR EACH ROW
  EXECUTE FUNCTION agricoop_app.guard_users_soft_delete_actor();

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'agricoop_app.users'::regclass
      AND tgname = 'agricoop_users_soft_delete_actor_guard'
      AND NOT tgisinternal
  ) OR to_regprocedure('agricoop_app.guard_users_soft_delete_actor()') IS NULL THEN
    RAISE EXCEPTION 'User tombstone guard migration verification failed';
  END IF;
END;
$postflight$;

COMMIT;
