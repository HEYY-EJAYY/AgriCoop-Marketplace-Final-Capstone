-- PURPOSE: Shared SECURITY DEFINER helpers for RLS policies and privileged writes.
-- DEPENDENCIES: agricoop_app.users, auth.uid(); drafts 20261117100000 (auth) recommended first.
-- TOUCHES: creates helper functions only (no table DDL).
-- DOES NOT TOUCH: Storage buckets, enum labels, existing row data, get_my_role().
-- PREFLIGHT: aborts if users/openId missing or helpers already exist with unexpected signatures.
-- VERIFY: see postflight DO block + queries at end.
-- ROLLBACK: see commented DROP FUNCTION block at end.
-- OWNER-RUN ONLY in Supabase SQL Editor after backup/PITR confirmation.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('agricoop_app.users') IS NULL THEN
    RAISE EXCEPTION 'Helpers migration stopped: agricoop_app.users missing';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Helpers migration stopped: auth.uid() unavailable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'agricoop_app.users'::regclass
      AND attname = 'openId'
      AND atttypid = 'character varying'::regtype
      AND attnotnull
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Helpers migration stopped: users.openId must be NOT NULL varchar';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION agricoop_app.current_app_user_id()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT u.id
  FROM agricoop_app.users AS u
  WHERE u."openId" = (SELECT auth.uid())::text
  LIMIT 1
$fn$;

CREATE OR REPLACE FUNCTION agricoop_app.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT u."role"::text
  FROM agricoop_app.users AS u
  WHERE u.id = agricoop_app.current_app_user_id()
  LIMIT 1
$fn$;

CREATE OR REPLACE FUNCTION agricoop_app.current_app_cooperative_id()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT u."cooperativeId"
  FROM agricoop_app.users AS u
  WHERE u.id = agricoop_app.current_app_user_id()
  LIMIT 1
$fn$;

CREATE OR REPLACE FUNCTION agricoop_app.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT agricoop_app.current_app_role() IN ('admin', 'superadmin')
$fn$;

CREATE OR REPLACE FUNCTION agricoop_app.is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT agricoop_app.current_app_role() = 'superadmin'
$fn$;

CREATE OR REPLACE FUNCTION agricoop_app.shares_cooperative(target_cooperative_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT
    agricoop_app.is_superadmin()
    OR (
      agricoop_app.current_app_role() = 'admin'
      AND agricoop_app.current_app_cooperative_id() IS NOT NULL
      AND target_cooperative_id IS NOT NULL
      AND agricoop_app.current_app_cooperative_id() = target_cooperative_id
    )
$fn$;

REVOKE ALL ON FUNCTION agricoop_app.current_app_user_id() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION agricoop_app.current_app_role() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION agricoop_app.current_app_cooperative_id() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION agricoop_app.is_staff() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION agricoop_app.is_superadmin() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION agricoop_app.shares_cooperative(integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION agricoop_app.current_app_user_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION agricoop_app.current_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION agricoop_app.current_app_cooperative_id() TO authenticated;
GRANT EXECUTE ON FUNCTION agricoop_app.is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION agricoop_app.is_superadmin() TO authenticated;
GRANT EXECUTE ON FUNCTION agricoop_app.shares_cooperative(integer) TO authenticated;

DO $postflight$
BEGIN
  IF to_regprocedure('agricoop_app.current_app_user_id()') IS NULL
     OR to_regprocedure('agricoop_app.current_app_role()') IS NULL
     OR to_regprocedure('agricoop_app.shares_cooperative(integer)') IS NULL THEN
    RAISE EXCEPTION 'Helpers migration postflight failed: expected functions missing';
  END IF;
END
$postflight$;

COMMIT;

-- Verification (read-only):
-- SELECT proname, prosecdef, proconfig
-- FROM pg_proc WHERE pronamespace = 'agricoop_app'::regnamespace
--   AND proname IN ('current_app_user_id','current_app_role','current_app_cooperative_id','is_staff','is_superadmin','shares_cooperative');

-- ROLLBACK (manual):
-- BEGIN;
-- DROP FUNCTION IF EXISTS agricoop_app.shares_cooperative(integer);
-- DROP FUNCTION IF EXISTS agricoop_app.is_superadmin();
-- DROP FUNCTION IF EXISTS agricoop_app.is_staff();
-- DROP FUNCTION IF EXISTS agricoop_app.current_app_cooperative_id();
-- DROP FUNCTION IF EXISTS agricoop_app.current_app_role();
-- DROP FUNCTION IF EXISTS agricoop_app.current_app_user_id();
-- COMMIT;
