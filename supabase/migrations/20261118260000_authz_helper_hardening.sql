-- BLOCK 36: Disable tombstoned identities and non-operational staff; close public role-sync RPC access.
-- Deleted accounts no longer resolve to an app user ID; staff roles also require
-- approval. Bind profile role sync to the application's role source and caller
-- identity/scope, and apply the same inactive-staff check to profile/review helpers.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('agricoop_app.users') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR (
       SELECT count(*)
       FROM information_schema.columns
       WHERE table_schema = 'agricoop_app'
         AND table_name = 'users'
         AND column_name IN (
           'id', 'openId', 'role', 'approvalStatus', 'cooperativeId', 'deletedAt'
         )
     ) <> 6
     OR to_regprocedure('auth.uid()') IS NULL
     OR to_regprocedure('agricoop_app.current_app_cooperative_id()') IS NULL
     OR to_regprocedure('agricoop_app.is_staff()') IS NULL
     OR to_regprocedure('agricoop_app.is_superadmin()') IS NULL
     OR to_regprocedure('agricoop_app.sync_profile_role_from_app(text,text)') IS NULL THEN
    RAISE EXCEPTION
      'Authorization helper hardening stopped: expected application identity columns and dependent helper functions';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION agricoop_app.current_app_user_id()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT user_row.id
  FROM agricoop_app.users AS user_row
  WHERE user_row."openId" = (SELECT auth.uid())::text
    AND user_row."deletedAt" IS NULL
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION agricoop_app.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN user_row.role::text IN ('admin', 'superadmin')
      AND (
        user_row."approvalStatus" IS DISTINCT FROM 'approved'::agricoop_app.user_approval_status
        OR user_row."deletedAt" IS NOT NULL
      )
      THEN NULL
    ELSE user_row.role::text
  END
  FROM agricoop_app.users AS user_row
  WHERE user_row.id = agricoop_app.current_app_user_id()
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION agricoop_app.can_review_profile_verification_user(
  target_user_id integer
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog', 'agricoop_app', 'auth'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM agricoop_app.users AS actor
    JOIN agricoop_app.users AS target ON target."id" = target_user_id
    WHERE actor."openId" = (SELECT auth.uid())::text
      AND actor."approvalStatus" = 'approved'
      AND actor."deletedAt" IS NULL
      AND actor."id" <> target."id"
      AND target."deletedAt" IS NULL
      AND target."role" IN ('buyer', 'seller')
      AND (
        actor."role" = 'superadmin'
        OR (
          actor."role" = 'admin'
          AND actor."cooperativeId" IS NOT NULL
          AND actor."cooperativeId" = target."cooperativeId"
        )
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public.agricoop_profile_visible(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS actor
    JOIN public.roles AS actor_role ON actor_role.role_id = actor.role_id
    JOIN public.profiles AS target ON target.user_id = target_user_id
    LEFT JOIN agricoop_app.users AS app_actor
      ON app_actor."openId" = actor.user_id::text
    WHERE actor.user_id = auth.uid()
      AND (
        app_actor."openId" IS NULL
        OR app_actor."deletedAt" IS NULL
      )
      AND (
        target.user_id = actor.user_id
        OR (
          app_actor."approvalStatus" = 'approved'
          AND app_actor."deletedAt" IS NULL
          AND (
            (actor_role.role_name = 'system_admin' AND app_actor."role" = 'superadmin')
            OR (
              actor_role.role_name = 'coop_officer'
              AND app_actor."role" = 'admin'
              AND actor.cooperative_id IS NOT NULL
              AND actor.cooperative_id = target.cooperative_id
            )
          )
        )
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT profile_role.role_name
  FROM public.profiles AS profile
  JOIN public.roles AS profile_role
    ON profile_role.role_id = profile.role_id
  JOIN agricoop_app.users AS app_user
    ON app_user."openId" = profile.user_id::text
  WHERE profile.user_id = auth.uid()
    AND app_user."approvalStatus" = 'approved'
    AND app_user."deletedAt" IS NULL
    AND (
      (profile_role.role_name = 'coop_officer' AND app_user."role" = 'admin')
      OR (profile_role.role_name = 'system_admin' AND app_user."role" = 'superadmin')
      OR (profile_role.role_name = app_user."role"::text)
    )
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION agricoop_app.sync_profile_role_from_app(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION agricoop_app.sync_profile_role_from_app(
  p_auth_user_id text,
  p_app_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id integer := agricoop_app.current_app_user_id();
  actor_role text := agricoop_app.current_app_role();
  actor_cooperative_id integer := agricoop_app.current_app_cooperative_id();
  target_id integer;
  target_role text;
  target_cooperative_id integer;
  target_approval_status text;
  target_deleted boolean;
  canonical_role_name text;
  canonical_role_id integer;
BEGIN
  IF p_auth_user_id IS NULL OR length(btrim(p_auth_user_id)) = 0 THEN
    RAISE EXCEPTION 'auth user id is required' USING ERRCODE = '22023';
  END IF;

  canonical_role_name := CASE p_app_role
    WHEN 'buyer' THEN 'buyer'
    WHEN 'seller' THEN 'seller'
    WHEN 'admin' THEN 'coop_officer'
    WHEN 'superadmin' THEN 'system_admin'
    ELSE NULL
  END;
  IF canonical_role_name IS NULL THEN
    RAISE EXCEPTION 'unsupported application role: %', p_app_role USING ERRCODE = '22023';
  END IF;

  SELECT user_row.id, user_row.role::text, user_row."cooperativeId",
         user_row."approvalStatus"::text, user_row."deletedAt" IS NOT NULL
  INTO target_id, target_role, target_cooperative_id,
       target_approval_status, target_deleted
  FROM agricoop_app.users AS user_row
  WHERE user_row."openId" = p_auth_user_id
  FOR UPDATE;

  IF NOT FOUND OR target_role IS DISTINCT FROM p_app_role THEN
    RAISE EXCEPTION 'Profile role must match the application user role'
      USING ERRCODE = '42501';
  END IF;
  IF target_role IN ('admin', 'superadmin')
     AND (target_approval_status IS DISTINCT FROM 'approved' OR target_deleted) THEN
    RAISE EXCEPTION 'Non-operational staff cannot sync a privileged profile role'
      USING ERRCODE = '42501';
  END IF;
  IF actor_id IS DISTINCT FROM target_id
     AND actor_role IS DISTINCT FROM 'superadmin'
     AND NOT (
       actor_role = 'admin'
       AND actor_cooperative_id IS NOT NULL
       AND actor_cooperative_id = target_cooperative_id
       AND target_role IN ('buyer', 'seller')
     ) THEN
    RAISE EXCEPTION 'Profile role sync is outside the acting user scope'
      USING ERRCODE = '42501';
  END IF;

  SELECT roles.role_id INTO canonical_role_id
  FROM public.roles
  WHERE roles.role_name = canonical_role_name
  LIMIT 1;
  IF canonical_role_id IS NULL THEN
    RAISE EXCEPTION 'canonical public role "%" is missing', canonical_role_name;
  END IF;

  UPDATE public.profiles
  SET role_id = canonical_role_id
  WHERE user_id::text = p_auth_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'canonical profile row is missing for this Auth identity';
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION agricoop_app.sync_profile_role_from_app(text, text)
  TO authenticated;

DO $postflight$
BEGIN
  IF NOT has_function_privilege(
       'authenticated',
       'agricoop_app.sync_profile_role_from_app(text,text)',
       'EXECUTE'
     )
     OR position(
       '"approvalStatus"' IN pg_get_functiondef(
         to_regprocedure('agricoop_app.current_app_role()')
       )
     ) = 0
     OR position(
       '"deletedAt"' IN pg_get_functiondef(
         to_regprocedure('agricoop_app.current_app_role()')
       )
     ) = 0
     OR position(
       '"deletedAt"' IN pg_get_functiondef(
         to_regprocedure('agricoop_app.current_app_user_id()')
       )
     ) = 0
     OR position(
       '"deletedAt"' IN pg_get_functiondef(
         to_regprocedure('agricoop_app.can_review_profile_verification_user(integer)')
       )
     ) = 0
     OR position(
       '"deletedAt"' IN pg_get_functiondef(
         to_regprocedure('public.agricoop_profile_visible(uuid)')
       )
     ) = 0
     OR position(
       '"deletedAt"' IN pg_get_functiondef(
         to_regprocedure('public.get_my_role()')
       )
     ) = 0 THEN
    RAISE EXCEPTION 'Authorization helper hardening verification failed';
  END IF;
END;
$postflight$;

COMMIT;
