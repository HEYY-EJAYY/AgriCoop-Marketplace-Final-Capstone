-- Auth/profile access foundation only; this is not the complete marketplace RLS migration.
-- Reconciles only the exact legacy public.profiles policies recorded in the
-- production catalog report. Any catalog drift stops the transaction.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('agricoop_app.users') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.roles') IS NULL THEN
    RAISE EXCEPTION 'Auth/profile migration precondition failed: expected users, profiles, and roles tables';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'agricoop_app.users'::regclass
      AND attname = 'openId'
      AND atttypid = 'character varying'::regtype
      AND attnotnull
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Auth/profile migration precondition failed: users.openId must be NOT NULL varchar';
  END IF;

  IF (
    SELECT array_agg(enumlabel::text ORDER BY enumlabel::text)
    FROM pg_enum
    WHERE enumtypid = to_regtype('agricoop_app.user_role')
  ) IS DISTINCT FROM ARRAY['admin', 'buyer', 'seller', 'superadmin']::text[] THEN
    RAISE EXCEPTION 'Auth/profile migration precondition failed: agricoop_app.user_role labels differ from the confirmed enum';
  END IF;

  IF (
    SELECT array_agg(enumlabel::text ORDER BY enumlabel::text)
    FROM pg_enum
    WHERE enumtypid = to_regtype('agricoop_app.user_approval_status')
  ) IS DISTINCT FROM ARRAY['approved', 'pending', 'suspended']::text[] THEN
    RAISE EXCEPTION 'Auth/profile migration precondition failed: agricoop_app.user_approval_status labels differ from the confirmed enum';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid
     AND a.attname = 'openId'
     AND a.attnum = i.indkey[0]
    WHERE i.indrelid = 'agricoop_app.users'::regclass
      AND i.indisunique
      AND i.indisvalid
      AND i.indnkeyatts = 1
  ) THEN
    RAISE EXCEPTION 'Auth/profile migration precondition failed: users.openId must have a valid unique index';
  END IF;

  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Auth/profile migration precondition failed: auth.uid() is unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.profiles'::regclass
      AND attname = 'user_id'
      AND atttypid = 'uuid'::regtype
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.profiles'::regclass
      AND attname = 'role_id'
      AND atttypid = 'integer'::regtype
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.roles'::regclass
      AND attname = 'role_name'
      AND atttypid = 'text'::regtype
      AND attnotnull
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Auth/profile migration precondition failed: public profile/role columns differ from the application mapping';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.profiles'::regclass
      AND attname = 'full_name'
      AND atttypid = 'text'::regtype
      AND attnotnull
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.profiles'::regclass
      AND attname = 'email'
      AND atttypid = 'text'::regtype
      AND attnotnull
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.profiles'::regclass
      AND attname = 'cooperative_id'
      AND atttypid = 'uuid'::regtype
      AND NOT attnotnull
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE attrelid = 'public.profiles'::regclass
      AND a.attname = 'account_status'
      AND a.atttypid = 'text'::regtype
      AND NOT a.attnotnull
      AND pg_get_expr(d.adbin, d.adrelid) = '''pending''::text'
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Auth/profile migration precondition failed: public profile registration columns differ from the inspected catalog';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.profiles'::regclass
      AND c.confrelid = 'auth.users'::regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attname = 'user_id')]::smallint[]
      AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'auth.users'::regclass AND attname = 'id')]::smallint[]
      AND c.convalidated
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.profiles'::regclass
      AND c.confrelid = 'public.roles'::regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attname = 'role_id')]::smallint[]
      AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.roles'::regclass AND attname = 'role_id')]::smallint[]
      AND c.convalidated
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.profiles'::regclass
      AND c.confrelid = 'public.cooperatives'::regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attname = 'cooperative_id')]::smallint[]
      AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.cooperatives'::regclass AND attname = 'cooperative_id')]::smallint[]
      AND c.convalidated
  ) THEN
    RAISE EXCEPTION 'Auth/profile migration precondition failed: public profile identity, role, or cooperative foreign keys differ from the catalog';
  END IF;

  IF NOT (
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'agricoop_app.users'::regclass)
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.profiles'::regclass)
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.roles'::regclass)
  ) THEN
    RAISE EXCEPTION 'Auth/profile migration precondition failed: RLS must already be enabled on users, profiles, and roles';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid
     AND a.attname = 'user_id'
     AND a.attnum = i.indkey[0]
    WHERE i.indrelid = 'public.profiles'::regclass
      AND i.indisunique
      AND i.indisvalid
      AND i.indnkeyatts = 1
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid
     AND a.attname = 'role_id'
     AND a.attnum = i.indkey[0]
    WHERE i.indrelid = 'public.roles'::regclass
      AND i.indisunique
      AND i.indisvalid
      AND i.indnkeyatts = 1
  ) THEN
    RAISE EXCEPTION 'Auth/profile migration precondition failed: profiles.user_id and roles.role_id must be unique';
  END IF;

  IF EXISTS (
    SELECT role_name
    FROM public.roles
    WHERE role_name IN ('buyer', 'seller', 'coop_officer', 'system_admin')
    GROUP BY role_name
    HAVING count(*) <> 1
  ) OR NOT EXISTS (
    SELECT 1 FROM public.roles WHERE role_name = 'buyer'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.roles WHERE role_name = 'seller'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.roles WHERE role_name = 'coop_officer'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.roles WHERE role_name = 'system_admin'
  ) THEN
    RAISE EXCEPTION 'Auth/profile migration precondition failed: canonical public role names must each exist exactly once';
  END IF;

  IF (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
  ) <> 3
  OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'users insert own profile'
      AND cmd = 'INSERT'
      AND roles = ARRAY['public']::name[]
      AND qual IS NULL
      AND with_check = '(user_id = auth.uid())'
  )
  OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'users update own profile'
      AND cmd = 'UPDATE'
      AND roles = ARRAY['public']::name[]
      AND qual = '(user_id = auth.uid())'
      AND with_check IS NULL
  )
  OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'view own or officer/admin view all'
      AND cmd = 'SELECT'
      AND roles = ARRAY['public']::name[]
      AND qual = '((user_id = auth.uid()) OR (get_my_role() = ANY (ARRAY[''coop_officer''::text, ''system_admin''::text])))'
      AND with_check IS NULL
  ) THEN
    RAISE EXCEPTION 'Auth/profile migration stopped: legacy public.profiles policies differ from the inspected definitions';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE (schemaname = 'agricoop_app' AND tablename = 'users')
       OR (schemaname = 'public' AND tablename = 'roles')
  ) THEN
    RAISE EXCEPTION 'Auth/profile migration stopped: users or roles already have policies requiring manual reconciliation';
  END IF;

  IF to_regprocedure('public.agricoop_profile_visible(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Auth/profile migration stopped: profile visibility helper already exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid IN ('public.profiles'::regclass, 'public.roles'::regclass)
      AND relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
    GROUP BY relowner
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'Auth/profile migration stopped: executor cannot own an RLS-bypassing visibility helper';
  END IF;
END
$preflight$;

CREATE FUNCTION public.agricoop_profile_visible(target_user_id uuid)
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
        target.user_id = actor.user_id
        OR (
          app_actor."approvalStatus" = 'approved'
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

REVOKE ALL ON FUNCTION public.agricoop_profile_visible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agricoop_profile_visible(uuid) TO authenticated;

GRANT USAGE ON SCHEMA agricoop_app, public, auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

DO $least_privilege_auth_grants$
DECLARE
  target_table regclass;
  column_name text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'agricoop_app.users'::regclass,
    'public.profiles'::regclass,
    'public.roles'::regclass
  ]
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC, anon, authenticated',
      target_table
    );

    FOR column_name IN
      SELECT attname
      FROM pg_attribute
      WHERE attrelid = target_table
        AND attnum > 0
        AND NOT attisdropped
    LOOP
      EXECUTE format(
        'REVOKE SELECT (%1$I), INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) ON TABLE %2$s FROM PUBLIC, anon, authenticated',
        column_name,
        target_table
      );
    END LOOP;
  END LOOP;
END
$least_privilege_auth_grants$;

GRANT SELECT ("id", "openId", "name", "email", "role", "approvalStatus", "verificationStatus",
              "cooperativeId", "contactNumber", "birthdate", "phone", "address", "createdAt")
  ON TABLE agricoop_app.users TO authenticated;
GRANT INSERT ("openId", "name", "email", "loginMethod", "role", "approvalStatus", "cooperativeId", "lastSignedIn")
  ON TABLE agricoop_app.users TO authenticated;
GRANT UPDATE ("name", "email", "loginMethod", "lastSignedIn", "contactNumber", "address")
  ON TABLE agricoop_app.users TO authenticated;

GRANT SELECT ("user_id", "role_id") ON TABLE public.profiles TO authenticated;
GRANT INSERT ("user_id", "full_name", "email", "role_id") ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.roles TO authenticated;

DO $sequence_grant$
DECLARE
  users_id_sequence text;
BEGIN
  users_id_sequence := pg_get_serial_sequence('agricoop_app.users', 'id');
  IF users_id_sequence IS NULL THEN
    RAISE EXCEPTION 'Auth/profile migration stopped: users.id has no serial/identity sequence';
  END IF;
  EXECUTE format(
    'REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated',
    users_id_sequence
  );
  EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', users_id_sequence);
END
$sequence_grant$;

ALTER TABLE agricoop_app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

DROP POLICY "users insert own profile" ON public.profiles;
DROP POLICY "users update own profile" ON public.profiles;
DROP POLICY "view own or officer/admin view all" ON public.profiles;

CREATE POLICY agricoop_auth_users_self_select
  ON agricoop_app.users FOR SELECT TO authenticated
  USING ("openId" = (SELECT auth.uid())::text);

CREATE POLICY agricoop_auth_users_self_insert
  ON agricoop_app.users FOR INSERT TO authenticated
  WITH CHECK (
    "openId" = (SELECT auth.uid())::text
    AND "cooperativeId" IS NULL
    AND (
      ("role" = 'buyer' AND "approvalStatus" = 'approved')
      OR ("role" = 'seller' AND "approvalStatus" = 'pending')
    )
  );

CREATE POLICY agricoop_auth_users_self_update
  ON agricoop_app.users FOR UPDATE TO authenticated
  USING ("openId" = (SELECT auth.uid())::text)
  WITH CHECK ("openId" = (SELECT auth.uid())::text);

CREATE POLICY agricoop_auth_profiles_self_select
  ON public.profiles FOR SELECT TO authenticated
  USING (public.agricoop_profile_visible(user_id));

CREATE POLICY agricoop_auth_profiles_self_insert
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.roles r
      WHERE r.role_id = profiles.role_id
        AND r.role_name IN ('buyer', 'seller')
    )
  );

CREATE POLICY agricoop_auth_roles_read
  ON public.roles FOR SELECT TO authenticated
  USING (role_name IN ('buyer', 'seller', 'coop_officer', 'system_admin'));

DO $postflight$
BEGIN
  IF NOT has_schema_privilege('authenticated', 'agricoop_app', 'USAGE')
     OR NOT has_schema_privilege('authenticated', 'public', 'USAGE')
     OR NOT has_schema_privilege('authenticated', 'auth', 'USAGE')
     OR NOT has_function_privilege('authenticated', 'auth.uid()', 'EXECUTE')
     OR has_table_privilege('authenticated', 'agricoop_app.users', 'SELECT')
     OR has_table_privilege('authenticated', 'agricoop_app.users', 'INSERT')
     OR has_table_privilege('authenticated', 'agricoop_app.users', 'UPDATE')
     OR has_table_privilege('authenticated', 'agricoop_app.users', 'DELETE')
     OR has_table_privilege('anon', 'agricoop_app.users', 'SELECT')
     OR has_table_privilege('anon', 'agricoop_app.users', 'INSERT')
     OR has_table_privilege('anon', 'agricoop_app.users', 'UPDATE')
     OR has_table_privilege('anon', 'agricoop_app.users', 'DELETE')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'id', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'openId', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'name', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'email', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'role', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'approvalStatus', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'verificationStatus', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'cooperativeId', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'contactNumber', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'birthdate', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'phone', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'address', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'createdAt', 'SELECT')
     OR has_column_privilege('authenticated', 'agricoop_app.users', 'loginMethod', 'SELECT')
     OR has_column_privilege('authenticated', 'agricoop_app.users', 'profileImageUrl', 'SELECT')
     OR has_column_privilege('authenticated', 'agricoop_app.users', 'updatedAt', 'SELECT')
     OR has_column_privilege('authenticated', 'agricoop_app.users', 'lastSignedIn', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'openId', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'name', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'email', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'loginMethod', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'role', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'approvalStatus', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'cooperativeId', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'lastSignedIn', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'lastSignedIn', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'contactNumber', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'address', 'UPDATE')
     OR has_column_privilege('authenticated', 'agricoop_app.users', 'role', 'UPDATE')
     OR has_column_privilege('authenticated', 'agricoop_app.users', 'approvalStatus', 'UPDATE')
     OR has_column_privilege('authenticated', 'agricoop_app.users', 'cooperativeId', 'UPDATE')
     OR has_column_privilege('authenticated', 'agricoop_app.users', 'verificationStatus', 'UPDATE')
     OR has_column_privilege('authenticated', 'agricoop_app.users', 'verificationNote', 'UPDATE')
     OR has_column_privilege('authenticated', 'agricoop_app.users', 'verifiedBy', 'UPDATE')
     OR has_column_privilege('authenticated', 'agricoop_app.users', 'verifiedAt', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     OR has_table_privilege('authenticated', 'public.profiles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.profiles', 'DELETE')
     OR NOT has_column_privilege('authenticated', 'public.profiles', 'user_id', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.profiles', 'role_id', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.profiles', 'user_id', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'public.profiles', 'full_name', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'public.profiles', 'email', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'public.profiles', 'role_id', 'INSERT')
     OR has_column_privilege('authenticated', 'public.profiles', 'full_name', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'email', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'cooperative_id', 'INSERT')
     OR has_column_privilege('authenticated', 'public.profiles', 'account_status', 'INSERT')
     OR NOT has_function_privilege('authenticated', 'public.agricoop_profile_visible(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.agricoop_profile_visible(uuid)', 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc p
       CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
       WHERE p.oid = 'public.agricoop_profile_visible(uuid)'::regprocedure
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     )
     OR NOT has_table_privilege('authenticated', 'public.roles', 'SELECT')
     OR has_table_privilege('authenticated', 'public.roles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.roles', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.roles', 'DELETE')
     OR has_table_privilege('anon', 'public.roles', 'SELECT')
     OR has_table_privilege('anon', 'public.roles', 'INSERT')
     OR has_table_privilege('anon', 'public.roles', 'UPDATE')
     OR has_table_privilege('anon', 'public.roles', 'DELETE')
     OR EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'profiles'
         AND policyname IN (
           'users insert own profile',
           'users update own profile',
           'view own or officer/admin view all'
         )
     )
     OR (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'agricoop_app' AND tablename = 'users') <> 3
     OR (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'profiles') <> 2
     OR (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'roles') <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc p
       WHERE p.oid = 'public.agricoop_profile_visible(uuid)'::regprocedure
         AND p.prosecdef
         AND COALESCE((
           SELECT config.value
           FROM unnest(p.proconfig) AS config(value)
           WHERE config.value LIKE 'search_path=%'
           LIMIT 1
         ), '<not set>') = 'search_path=""'
     )
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'agricoop_app.users'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.profiles'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.roles'::regclass)
     OR NOT has_sequence_privilege(
       'authenticated',
       pg_get_serial_sequence('agricoop_app.users', 'id'),
       'USAGE'
     )
     OR has_sequence_privilege(
       'anon',
       pg_get_serial_sequence('agricoop_app.users', 'id'),
       'USAGE'
     )
     OR has_sequence_privilege(
       'anon',
       pg_get_serial_sequence('agricoop_app.users', 'id'),
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'Auth/profile migration postcondition failed: required grants are missing';
  END IF;
END
$postflight$;

COMMIT;

-- Rollback guidance (manual, after an ACL snapshot): drop only the six policies
-- above and revoke only privileges first confirmed absent before this migration.
-- Keep RLS enabled. Do not disable RLS or remove existing role/profile data.
-- The runtime must separately confirm its DATABASE_URL login role can SET ROLE
-- authenticated. Do not guess or grant role membership based on this SQL Editor
-- connection; use the application connection's session_user in approved staging.
--
-- To verify the actual transaction context in staging, execute this through the
-- application connection inside its request transaction after the four
-- set_config calls:
-- SELECT session_user, current_user, current_setting('role') AS role,
--        current_setting('search_path') AS search_path,
--        NULLIF(current_setting('request.jwt.claim.sub', true), '') IS NOT NULL AS claim_present,
--        auth.uid() IS NOT NULL AS auth_uid_present,
--        current_setting('request.jwt.claim.sub', true) = auth.uid()::text AS claim_matches_auth_uid,
--        has_schema_privilege(current_user, 'agricoop_app', 'USAGE') AS app_schema_usage,
--        has_table_privilege(current_user, 'agricoop_app.users', 'SELECT') AS app_users_select,
--        row_security_active('agricoop_app.users'::regclass) AS users_rls_active,
--        (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS effective_role_bypasses_rls,
--        (SELECT rolbypassrls FROM pg_roles WHERE rolname = session_user) AS login_role_bypasses_rls,
--        (SELECT pg_get_userbyid(relowner) FROM pg_class
--          WHERE oid = 'agricoop_app.users'::regclass) AS users_owner;
