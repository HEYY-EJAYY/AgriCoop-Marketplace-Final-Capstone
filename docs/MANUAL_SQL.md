# MANUAL SQL — paste into Supabase SQL Editor

**Agent does not execute this against production.** Run after backup/PITR confirmation.

Project: AgriCoop Marketplace (`adxprwseqawqrwuijata`)

Live baseline (read-only, 2026-11-17):
- Migration history: `20261016115411`, `20261016120149` only
- 12 `agricoop_app` tables, RLS enabled, **0 policies**
- Missing: cooperativeAssociationRequests, productImages, payments, paymentEvents, notifications, supportTickets, supportTicketMessages, auditLogs, profileVerificationSubmissions
- Missing column: `transactions.paymentOptionId`
- `paymentProofs.id` already has a sequence default (block 8 skips recreate)
- Buckets: product-images (public), payment-proofs (private); profile-verification-documents **missing**
- `authenticated` lacks USAGE on `agricoop_app` and SELECT on users (blocks app after SET ROLE)

Run **one block at a time**. Stop on any RAISE EXCEPTION and reconcile before continuing.

---

## BLOCK 1: `20261117100000_auth_profile_access.sql`

```sql
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
```

---

## BLOCK 2: `20261117105000_active_application_tables.sql`

```sql
-- Additive tables used by active application code and the following
-- profile-verification migration. paymentAttempts is intentionally excluded.
-- New tables remain inaccessible to client roles until a separate reviewed
-- policy/grant migration is applied.

BEGIN;

DO $preflight$
DECLARE
  existing_tables text[];
  association_labels text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'Active-table migration stopped: expected Supabase database roles are unavailable';
  END IF;

  IF to_regclass('agricoop_app.users') IS NULL
     OR to_regclass('agricoop_app.cooperatives') IS NULL
     OR to_regclass('agricoop_app.products') IS NULL
     OR to_regclass('agricoop_app.orders') IS NULL
     OR to_regclass('agricoop_app.transactions') IS NULL
     OR to_regclass('agricoop_app."paymentOptions"') IS NULL THEN
    RAISE EXCEPTION 'Active-table migration stopped: an existing foreign-key dependency is missing';
  END IF;

  SELECT array_agg(format('%I', table_name) ORDER BY table_name)
    INTO existing_tables
    FROM (VALUES
      ('cooperativeAssociationRequests'),
      ('productImages'),
      ('payments'),
      ('paymentEvents'),
      ('notifications'),
      ('supportTickets'),
      ('supportTicketMessages'),
      ('auditLogs')
    ) AS expected(table_name)
   WHERE to_regclass(format('agricoop_app.%I', table_name)) IS NOT NULL;

  IF existing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Active-table migration stopped: existing application tables require structural reconciliation';
  END IF;

  IF to_regtype('agricoop_app.association_request_status') IS NOT NULL THEN
    SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
      INTO association_labels
      FROM pg_enum
     WHERE enumtypid = 'agricoop_app.association_request_status'::regtype;
    IF association_labels IS DISTINCT FROM ARRAY['pending', 'approved', 'rejected']::text[] THEN
      RAISE EXCEPTION 'Active-table migration stopped: association_request_status labels differ from the application schema';
    END IF;
  END IF;
END
$preflight$;

DO $association_enum$
BEGIN
  IF to_regtype('agricoop_app.association_request_status') IS NULL THEN
    CREATE TYPE agricoop_app.association_request_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END
$association_enum$;

CREATE TABLE agricoop_app."cooperativeAssociationRequests" (
  "id" serial PRIMARY KEY,
  "sellerId" integer NOT NULL REFERENCES agricoop_app.users("id"),
  "cooperativeId" integer NOT NULL REFERENCES agricoop_app.cooperatives("id"),
  "status" agricoop_app.association_request_status NOT NULL DEFAULT 'pending',
  "message" text,
  "reviewNote" text,
  "reviewedBy" integer REFERENCES agricoop_app.users("id"),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "reviewedAt" timestamp
);
CREATE INDEX "cooperativeAssociationRequests_seller_status_idx"
  ON agricoop_app."cooperativeAssociationRequests" ("sellerId", "status");
CREATE INDEX "cooperativeAssociationRequests_cooperative_status_idx"
  ON agricoop_app."cooperativeAssociationRequests" ("cooperativeId", "status");
CREATE UNIQUE INDEX "cooperativeAssociationRequests_one_pending_seller_idx"
  ON agricoop_app."cooperativeAssociationRequests" ("sellerId")
  WHERE "status" = 'pending';

CREATE TABLE agricoop_app."productImages" (
  "id" serial PRIMARY KEY,
  "productId" integer NOT NULL REFERENCES agricoop_app.products("id") ON DELETE CASCADE,
  "imageUrl" varchar(1000) NOT NULL,
  "displayOrder" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX "productImages_product_order_idx"
  ON agricoop_app."productImages" ("productId", "displayOrder");

CREATE TABLE agricoop_app.payments (
  "id" serial PRIMARY KEY,
  "orderId" integer NOT NULL REFERENCES agricoop_app.orders("id"),
  "buyerId" integer NOT NULL REFERENCES agricoop_app.users("id"),
  "sellerId" integer NOT NULL REFERENCES agricoop_app.users("id"),
  "cooperativeId" integer REFERENCES agricoop_app.cooperatives("id"),
  "amountCents" bigint NOT NULL,
  "currency" varchar(8) NOT NULL DEFAULT 'PHP',
  "paymentMethod" varchar(64) NOT NULL DEFAULT 'f2f',
  "paymentOptionId" integer REFERENCES agricoop_app."paymentOptions"("id"),
  "status" text NOT NULL DEFAULT 'pending',
  "verifiedByUserId" integer REFERENCES agricoop_app.users("id"),
  "paymentReference" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "paidAt" timestamp,
  "verifiedAt" timestamp
);
CREATE UNIQUE INDEX "payments_order_id_idx" ON agricoop_app.payments ("orderId");
CREATE INDEX "payments_payment_option_id_idx" ON agricoop_app.payments ("paymentOptionId");

CREATE TABLE agricoop_app."paymentEvents" (
  "id" serial PRIMARY KEY,
  "paymentId" integer NOT NULL REFERENCES agricoop_app.payments("id"),
  "actorUserId" integer REFERENCES agricoop_app.users("id"),
  "eventType" varchar(80) NOT NULL,
  "fromStatus" varchar(32),
  "toStatus" varchar(32),
  "reason" text,
  "metadata" text,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX "payment_events_payment_id_created_at_idx"
  ON agricoop_app."paymentEvents" ("paymentId", "createdAt");

CREATE TABLE agricoop_app.notifications (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES agricoop_app.users("id"),
  "type" varchar(50) NOT NULL,
  "title" varchar(255) NOT NULL,
  "content" text NOT NULL,
  "link" varchar(255),
  "isRead" integer NOT NULL DEFAULT 0,
  "relatedEntityId" integer,
  "relatedEntityType" varchar(50),
  "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE agricoop_app."supportTickets" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES agricoop_app.users("id"),
  "cooperativeId" integer REFERENCES agricoop_app.cooperatives("id"),
  "subject" varchar(255) NOT NULL,
  "category" varchar(100) NOT NULL,
  "description" text NOT NULL,
  "priority" varchar(20) NOT NULL DEFAULT 'medium',
  "status" varchar(20) NOT NULL DEFAULT 'open',
  "assignedToUserId" integer REFERENCES agricoop_app.users("id"),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE agricoop_app."supportTicketMessages" (
  "id" serial PRIMARY KEY,
  "ticketId" integer NOT NULL REFERENCES agricoop_app."supportTickets"("id") ON DELETE CASCADE,
  "senderId" integer NOT NULL REFERENCES agricoop_app.users("id"),
  "body" text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX "supportTicketMessages_ticket_created_idx"
  ON agricoop_app."supportTicketMessages" ("ticketId", "createdAt");

CREATE TABLE agricoop_app."auditLogs" (
  "id" serial PRIMARY KEY,
  "actorUserId" integer NOT NULL REFERENCES agricoop_app.users("id"),
  "action" varchar(100) NOT NULL,
  "entityType" varchar(50) NOT NULL,
  "entityId" integer,
  "cooperativeId" integer REFERENCES agricoop_app.cooperatives("id"),
  "metadata" text,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

DO $secure_new_objects$
DECLARE
  target_table text;
  target_sequence text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'agricoop_app."cooperativeAssociationRequests"',
    'agricoop_app."productImages"',
    'agricoop_app.payments',
    'agricoop_app."paymentEvents"',
    'agricoop_app.notifications',
    'agricoop_app."supportTickets"',
    'agricoop_app."supportTicketMessages"',
    'agricoop_app."auditLogs"'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC, anon, authenticated, service_role', target_table);
    target_sequence := pg_get_serial_sequence(target_table, 'id');
    IF target_sequence IS NULL THEN
      RAISE EXCEPTION 'Active-table migration stopped: an expected identity sequence is unavailable';
    END IF;
    EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', target_sequence);
  END LOOP;
END
$secure_new_objects$;

COMMIT;

-- This migration intentionally grants no client access to the new tables.
-- A separate, reviewed migration must add operation-scoped RLS policies and
-- column/table grants before the corresponding application workflows are enabled.
```

---

## BLOCK 3: `20261117110000_transaction_payment_option.sql`

```sql
-- Unexecuted additive migration draft. Requires an owner-reviewed production
-- catalog snapshot and a maintenance window before application.
-- Adds a nullable link only; it creates no records and does not change existing values.

BEGIN;

DO $migration$
DECLARE
  transaction_table regclass := to_regclass('"agricoop_app"."transactions"');
  option_table regclass := to_regclass('"agricoop_app"."paymentOptions"');
  transaction_option_attnum smallint;
  option_id_attnum smallint;
  existing_fk record;
  existing_index record;
BEGIN
  IF transaction_table IS NULL OR option_table IS NULL THEN
    RAISE EXCEPTION 'Precondition failed: agricoop_app transactions and paymentOptions tables must already exist';
  END IF;

  SELECT attnum INTO option_id_attnum
  FROM pg_attribute
  WHERE attrelid = option_table AND attname = 'id' AND NOT attisdropped;
  IF option_id_attnum IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = option_table
      AND attname = 'id'
      AND atttypid = 'integer'::regtype
      AND attnotnull
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Precondition failed: paymentOptions.id must be a non-null integer';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = transaction_table
      AND attname = 'paymentOptionId'
      AND NOT attisdropped
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = transaction_table
      AND attname = 'paymentOptionId'
      AND atttypid = 'integer'::regtype
      AND NOT attnotnull
      AND NOT atthasdef
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Precondition failed: existing transactions.paymentOptionId must be nullable integer';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = transaction_table
      AND attname = 'paymentOptionId'
      AND NOT attisdropped
  ) THEN
    ALTER TABLE agricoop_app."transactions"
      ADD COLUMN "paymentOptionId" integer;
  END IF;

  SELECT attnum INTO transaction_option_attnum
  FROM pg_attribute
  WHERE attrelid = transaction_table
    AND attname = 'paymentOptionId'
    AND NOT attisdropped;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = transaction_table
      AND contype = 'f'
      AND conkey = ARRAY[transaction_option_attnum]::smallint[]
      AND confrelid = option_table
      AND conname <> 'transactions_paymentOptionId_fkey'
  ) THEN
    RAISE EXCEPTION 'Precondition failed: an equivalent payment-option FK exists under an unexpected name';
  END IF;

  SELECT * INTO existing_fk
  FROM pg_constraint
  WHERE conrelid = transaction_table
    AND conname = 'transactions_paymentOptionId_fkey';

  IF FOUND AND (
    existing_fk.contype <> 'f'
    OR existing_fk.conkey <> ARRAY[transaction_option_attnum]::smallint[]
    OR existing_fk.confrelid <> option_table
    OR existing_fk.confkey <> ARRAY[option_id_attnum]::smallint[]
    OR existing_fk.confdeltype <> 'n'
    OR NOT existing_fk.convalidated
  ) THEN
    RAISE EXCEPTION 'Precondition failed: transactions_paymentOptionId_fkey exists with unexpected definition';
  ELSIF NOT FOUND THEN
    ALTER TABLE agricoop_app."transactions"
      ADD CONSTRAINT "transactions_paymentOptionId_fkey"
      FOREIGN KEY ("paymentOptionId")
      REFERENCES agricoop_app."paymentOptions" ("id")
      ON DELETE SET NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = transaction_table
      AND i.indkey[0] = transaction_option_attnum
      AND i.indnkeyatts = 1
      AND i.indnatts = 1
      AND c.relname <> 'transactionsPaymentOptionIdIdx'
  ) THEN
    RAISE EXCEPTION 'Precondition failed: an equivalent payment-option index exists under an unexpected name';
  END IF;

  SELECT i.* INTO existing_index
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  WHERE i.indrelid = transaction_table
    AND c.relname = 'transactionsPaymentOptionIdIdx';

  IF FOUND AND (
    NOT existing_index.indisvalid
    OR NOT existing_index.indisready
    OR existing_index.indisunique
    OR existing_index.indpred IS NOT NULL
    OR existing_index.indnkeyatts <> 1
    OR existing_index.indnatts <> 1
    OR existing_index.indkey[0] <> transaction_option_attnum
  ) THEN
    RAISE EXCEPTION 'Precondition failed: transactionsPaymentOptionIdIdx exists with unexpected definition';
  ELSIF NOT FOUND THEN
    CREATE INDEX "transactionsPaymentOptionIdIdx"
      ON agricoop_app."transactions" ("paymentOptionId");
  END IF;
END
$migration$;

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = to_regclass('"agricoop_app"."transactions"')
      AND attname = 'paymentOptionId'
      AND atttypid = 'integer'::regtype
      AND NOT attnotnull
      AND NOT atthasdef
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = to_regclass('"agricoop_app"."transactions"')
      AND conname = 'transactions_paymentOptionId_fkey'
      AND contype = 'f'
      AND confrelid = to_regclass('"agricoop_app"."paymentOptions"')
      AND confdeltype = 'n'
      AND convalidated
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = to_regclass('"agricoop_app"."transactions"')
      AND c.relname = 'transactionsPaymentOptionIdIdx'
      AND i.indisvalid
      AND i.indisready
      AND NOT i.indisunique
      AND i.indpred IS NULL
      AND i.indnkeyatts = 1
      AND i.indnatts = 1
  ) THEN
    RAISE EXCEPTION 'Postcondition failed: payment-option column, FK, or index is missing or invalid';
  END IF;
END
$postflight$;

COMMIT;

-- Read-only verification after an approved application:
-- SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS data_type, a.attnotnull
-- FROM pg_attribute a
-- WHERE a.attrelid = '"agricoop_app"."transactions"'::regclass
--   AND a.attname = 'paymentOptionId' AND NOT a.attisdropped;
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = '"agricoop_app"."transactions"'::regclass
--   AND conname = 'transactions_paymentOptionId_fkey';
-- SELECT indexrelid::regclass, indisvalid, pg_get_indexdef(indexrelid)
-- FROM pg_index
-- WHERE indrelid = '"agricoop_app"."transactions"'::regclass
--   AND indexrelid::regclass::text LIKE '%transactionsPaymentOptionIdIdx';

-- Rollback guidance: this additive nullable link does not alter existing rows.
-- Before rollback, verify there are no non-NULL paymentOptionId values and no
-- dependent app version. Then manually drop only the confirmed FK, index, and
-- column in a transaction. Retain the column if any selected option is stored.
-- Do not execute rollback automatically.
```

---

## BLOCK 4: `20261117120000_profile_verification_submissions.sql`

```sql
-- Additive profile-verification storage metadata and cooperative-scoped access.
-- Manual review only. Do not run until the complete production catalog/ACL/RLS
-- snapshot and the required private Storage bucket have been reviewed.
-- This file has not been executed against any database.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('agricoop_app.users') IS NULL
     OR to_regclass('agricoop_app.cooperatives') IS NULL
     OR to_regclass('agricoop_app."auditLogs"') IS NULL
     OR to_regclass('agricoop_app.notifications') IS NULL THEN
    RAISE EXCEPTION 'Profile-verification precondition failed: required application tables are missing';
  END IF;

  -- Idempotent: if the submission table already exists, remaining DDL uses
  -- IF NOT EXISTS / DROP POLICY IF EXISTS patterns below.
  IF to_regclass('agricoop_app."profileVerificationSubmissions"') IS NOT NULL THEN
    RAISE NOTICE 'Profile-verification: profileVerificationSubmissions already present; continuing idempotently';
  END IF;

  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Profile-verification precondition failed: auth.uid() is unavailable';
  END IF;

  IF (
    SELECT array_agg(enumlabel::text ORDER BY enumlabel::text)
    FROM pg_enum
    WHERE enumtypid = to_regtype('agricoop_app.user_verification_status')
  ) IS DISTINCT FROM ARRAY['approved', 'pending', 'rejected', 'unverified']::text[] THEN
    RAISE EXCEPTION 'Profile-verification precondition failed: user_verification_status labels differ from the confirmed enum';
  END IF;

  IF NOT (
    SELECT relrowsecurity FROM pg_class WHERE oid = 'agricoop_app.users'::regclass
  ) THEN
    RAISE EXCEPTION 'Profile-verification precondition failed: users RLS must remain enabled';
  END IF;

  IF NOT (
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'agricoop_app."auditLogs"'::regclass)
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'agricoop_app.notifications'::regclass)
  ) THEN
    RAISE EXCEPTION 'Profile-verification precondition failed: auditLogs and notifications RLS must remain enabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'agricoop_app'
      AND tablename = 'users'
      AND policyname NOT IN (
        'agricoop_auth_users_self_select',
        'agricoop_auth_users_self_insert',
        'agricoop_auth_users_self_update',
        'agricoop_profile_verification_admin_select',
        'agricoop_profile_verification_admin_update'
      )
  ) THEN
    RAISE EXCEPTION 'Profile-verification migration stopped: unexpected users policies require manual review';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'agricoop_app'
      AND tablename = 'users'
      AND policyname = 'agricoop_auth_users_self_select'
      AND cmd = 'SELECT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'agricoop_app'
      AND tablename = 'users'
      AND policyname = 'agricoop_auth_users_self_update'
      AND cmd = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'Profile-verification precondition failed: reviewed auth self-select/update policies must be installed first';
  END IF;

  -- Helpers/triggers/policies may already exist after a partial apply; recreate safely below.

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid IN (
      'agricoop_app.users'::regclass,
      'agricoop_app."auditLogs"'::regclass
    )
      AND relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
    GROUP BY relowner
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'Profile-verification migration stopped: executor cannot own the protected audit trigger';
  END IF;
END
$preflight$;

CREATE TABLE IF NOT EXISTS agricoop_app."profileVerificationSubmissions" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES agricoop_app.users("id") ON DELETE CASCADE,
  "storagePath" text NOT NULL UNIQUE,
  "mimeType" varchar(100) NOT NULL,
  "fileSizeBytes" bigint NOT NULL,
  "submissionNote" text,
  "status" agricoop_app.user_verification_status NOT NULL DEFAULT 'pending',
  "submittedAt" timestamp NOT NULL DEFAULT now(),
  "reviewedBy" integer REFERENCES agricoop_app.users("id") ON DELETE SET NULL,
  "reviewedAt" timestamp,
  "reviewNote" text,
  CONSTRAINT "profileVerificationSubmissionsFileSizeCheck"
    CHECK ("fileSizeBytes" BETWEEN 1 AND 5242880),
  CONSTRAINT "profileVerificationSubmissionsMimeTypeCheck"
    CHECK ("mimeType" IN ('image/jpeg', 'image/png', 'image/webp'))
);

CREATE INDEX IF NOT EXISTS "profileVerificationSubmissionsUserSubmittedIdx"
  ON agricoop_app."profileVerificationSubmissions" ("userId", "submittedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "profileVerificationSubmissionsOnePendingUserIdx"
  ON agricoop_app."profileVerificationSubmissions" ("userId")
  WHERE "status" = 'pending';

REVOKE ALL PRIVILEGES ON TABLE agricoop_app."profileVerificationSubmissions"
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION agricoop_app.can_review_profile_verification_user(target_user_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, agricoop_app, auth
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM agricoop_app.users AS actor
    JOIN agricoop_app.users AS target ON target."id" = target_user_id
    WHERE actor."openId" = (SELECT auth.uid())::text
      AND actor."approvalStatus" = 'approved'
      AND actor."id" <> target."id"
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

REVOKE ALL ON FUNCTION agricoop_app.can_review_profile_verification_user(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA agricoop_app, auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT EXECUTE ON FUNCTION agricoop_app.can_review_profile_verification_user(integer) TO authenticated;
GRANT SELECT ("id", "openId", "role", "cooperativeId", "verificationStatus", "name", "birthdate", "phone", "address")
  ON TABLE agricoop_app.users TO authenticated;
GRANT UPDATE ("verificationStatus", "verificationNote", "verifiedBy", "verifiedAt", "birthdate", "phone", "address")
  ON TABLE agricoop_app.users TO authenticated;
GRANT SELECT ON TABLE agricoop_app."profileVerificationSubmissions" TO authenticated;
GRANT INSERT ("userId", "storagePath", "mimeType", "fileSizeBytes", "submissionNote")
  ON TABLE agricoop_app."profileVerificationSubmissions" TO authenticated;
GRANT UPDATE ("status", "reviewedBy", "reviewedAt", "reviewNote")
  ON TABLE agricoop_app."profileVerificationSubmissions" TO authenticated;
GRANT SELECT ON TABLE agricoop_app.notifications TO authenticated;
GRANT UPDATE ("isRead") ON TABLE agricoop_app.notifications TO authenticated;
GRANT INSERT ("userId", "type", "title", "content", "link", "relatedEntityId", "relatedEntityType")
  ON TABLE agricoop_app.notifications TO authenticated;

DO $sequence_grants$
DECLARE
  target_table text;
  target_sequence regclass;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'agricoop_app."profileVerificationSubmissions"',
    'agricoop_app.notifications'
  ]
  LOOP
    target_sequence := pg_get_serial_sequence(target_table, 'id');
    IF target_sequence IS NULL THEN
      RAISE EXCEPTION 'Profile-verification migration stopped: required identity sequence is missing';
    END IF;
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
      target_sequence
    );
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', target_sequence);
  END LOOP;
END
$sequence_grants$;

CREATE OR REPLACE FUNCTION agricoop_app.guard_profile_verification_user_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, agricoop_app, auth
AS $function$
DECLARE
  actor_id integer;
  allowed_change boolean := false;
  personal_details_changed boolean;
  verification_state_changed boolean;
BEGIN
  personal_details_changed :=
    NEW."birthdate" IS DISTINCT FROM OLD."birthdate"
    OR NEW."phone" IS DISTINCT FROM OLD."phone"
    OR NEW."address" IS DISTINCT FROM OLD."address";
  verification_state_changed :=
    NEW."verificationStatus" IS DISTINCT FROM OLD."verificationStatus"
    OR NEW."verificationNote" IS DISTINCT FROM OLD."verificationNote"
    OR NEW."verifiedBy" IS DISTINCT FROM OLD."verifiedBy"
    OR NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt";

  IF NOT personal_details_changed AND NOT verification_state_changed THEN
    RETURN NEW;
  END IF;

  SELECT actor."id"
    INTO actor_id
    FROM agricoop_app.users AS actor
   WHERE actor."openId" = (SELECT auth.uid())::text;

  IF personal_details_changed AND actor_id IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'Only the applicant may update personal verification details';
  END IF;

  IF NOT verification_state_changed THEN
    RETURN NEW;
  ELSIF actor_id = OLD."id" THEN
    allowed_change :=
      NEW."verificationStatus" = 'pending'
      AND OLD."verificationStatus" IN ('unverified', 'rejected')
      AND NEW."verifiedBy" IS NULL
      AND NEW."verifiedAt" IS NULL
      AND EXISTS (
        SELECT 1
        FROM agricoop_app."profileVerificationSubmissions" AS submission
        WHERE submission."userId" = OLD."id"
          AND submission."status" = 'pending'
          AND submission."submissionNote" IS NOT DISTINCT FROM NEW."verificationNote"
      );
  ELSIF actor_id IS NOT NULL
    AND agricoop_app.can_review_profile_verification_user(OLD."id") THEN
    allowed_change :=
      OLD."verificationStatus" = 'pending'
      AND
      NEW."verificationStatus" IN ('approved', 'rejected')
      AND NEW."verifiedBy" = actor_id
      AND NEW."verifiedAt" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM agricoop_app."profileVerificationSubmissions" AS submission
        WHERE submission."userId" = OLD."id"
          AND submission."status" = NEW."verificationStatus"
          AND submission."reviewedBy" = actor_id
          AND submission."reviewedAt" = NEW."verifiedAt"
          AND submission."reviewNote" IS NOT DISTINCT FROM NEW."verificationNote"
      );
  END IF;

  IF NOT allowed_change THEN
    RAISE EXCEPTION 'Profile verification state changes must use an authorized submission or review';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION agricoop_app.guard_profile_verification_user_update()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION agricoop_app.write_profile_verification_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, agricoop_app, auth
AS $function$
DECLARE
  actor_id integer;
  target_cooperative_id integer;
  event_action text;
  event_metadata jsonb;
BEGIN
  SELECT actor."id"
    INTO actor_id
    FROM agricoop_app.users AS actor
   WHERE actor."openId" = (SELECT auth.uid())::text;

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Profile verification audit requires an authenticated application user';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."userId" <> actor_id
      OR NEW."status" <> 'pending'
      OR NEW."reviewedBy" IS NOT NULL
      OR NEW."reviewedAt" IS NOT NULL
      OR NEW."reviewNote" IS NOT NULL THEN
      RAISE EXCEPTION 'Profile verification submission audit does not match an applicant submission';
    END IF;
    event_action := 'profile_verification_submitted';
    event_metadata := jsonb_build_object(
      'mimeType', NEW."mimeType",
      'fileSizeBytes', NEW."fileSizeBytes"
    );
    target_cooperative_id := (
      SELECT target."cooperativeId"
      FROM agricoop_app.users AS target
      WHERE target."id" = NEW."userId"
    );
  ELSIF TG_OP = 'UPDATE' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" <> 'pending'
      OR NEW."status" NOT IN ('approved', 'rejected')
      OR NEW."reviewedBy" IS DISTINCT FROM actor_id
      OR NEW."reviewedAt" IS NULL
      OR (NEW."status" = 'rejected' AND NULLIF(btrim(NEW."reviewNote"), '') IS NULL)
      OR NOT agricoop_app.can_review_profile_verification_user(NEW."userId") THEN
      RAISE EXCEPTION 'Profile verification review audit requires an authorized cooperative reviewer';
    END IF;
    event_action := 'profile_verification_' || NEW."status"::text;
    event_metadata := jsonb_build_object(
      'decision', NEW."status"::text,
      'userId', NEW."userId"
    );
    target_cooperative_id := (
      SELECT target."cooperativeId"
      FROM agricoop_app.users AS target
      WHERE target."id" = NEW."userId"
    );
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO agricoop_app."auditLogs" (
    "actorUserId",
    "action",
    "entityType",
    "entityId",
    "cooperativeId",
    "metadata"
  ) VALUES (
    actor_id,
    event_action,
    'profile_verification_submission',
    NEW."id",
    target_cooperative_id,
    event_metadata::text
  );

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION agricoop_app.write_profile_verification_audit_event()
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE agricoop_app."profileVerificationSubmissions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agricoop_profile_verification_admin_select ON agricoop_app.users;
DROP POLICY IF EXISTS agricoop_profile_verification_admin_update ON agricoop_app.users;
DROP POLICY IF EXISTS agricoop_profile_verification_self_select ON agricoop_app."profileVerificationSubmissions";
DROP POLICY IF EXISTS agricoop_profile_verification_admin_read ON agricoop_app."profileVerificationSubmissions";
DROP POLICY IF EXISTS agricoop_profile_verification_self_insert ON agricoop_app."profileVerificationSubmissions";
DROP POLICY IF EXISTS agricoop_profile_verification_admin_update ON agricoop_app."profileVerificationSubmissions";
DROP POLICY IF EXISTS agricoop_profile_verification_notification_insert ON agricoop_app.notifications;
DROP POLICY IF EXISTS agricoop_notifications_self_read ON agricoop_app.notifications;
DROP POLICY IF EXISTS agricoop_notifications_self_mark_read ON agricoop_app.notifications;
DROP TRIGGER IF EXISTS agricoop_profile_verification_guard ON agricoop_app.users;
DROP TRIGGER IF EXISTS agricoop_profile_verification_audit_event ON agricoop_app."profileVerificationSubmissions";

CREATE POLICY agricoop_profile_verification_admin_select
  ON agricoop_app.users FOR SELECT TO authenticated
  USING (agricoop_app.can_review_profile_verification_user("id"));

CREATE POLICY agricoop_profile_verification_admin_update
  ON agricoop_app.users FOR UPDATE TO authenticated
  USING (agricoop_app.can_review_profile_verification_user("id"))
  WITH CHECK (agricoop_app.can_review_profile_verification_user("id"));

CREATE POLICY agricoop_profile_verification_self_select
  ON agricoop_app."profileVerificationSubmissions" FOR SELECT TO authenticated
  USING (
    "userId" = (
      SELECT id FROM agricoop_app.users
      WHERE "openId" = (SELECT auth.uid())::text
    )
  );

CREATE POLICY agricoop_profile_verification_admin_read
  ON agricoop_app."profileVerificationSubmissions" FOR SELECT TO authenticated
  USING (agricoop_app.can_review_profile_verification_user("userId"));

CREATE POLICY agricoop_profile_verification_self_insert
  ON agricoop_app."profileVerificationSubmissions" FOR INSERT TO authenticated
  WITH CHECK (
    "status" = 'pending'
    AND "reviewedBy" IS NULL
    AND "reviewedAt" IS NULL
    AND "reviewNote" IS NULL
    AND "userId" = (
      SELECT id FROM agricoop_app.users
      WHERE "openId" = (SELECT auth.uid())::text
    )
    AND "storagePath" LIKE
      'profile-verification-documents/' || "userId"::text || '/%'
    AND current_setting('agricoop.profile_verification_upload_verified', true) = '1'
  );

CREATE POLICY agricoop_profile_verification_admin_update
  ON agricoop_app."profileVerificationSubmissions" FOR UPDATE TO authenticated
  USING (
    agricoop_app.can_review_profile_verification_user("userId")
    AND "status" = 'pending'
  )
  WITH CHECK (
    agricoop_app.can_review_profile_verification_user("userId")
    AND "status" IN ('approved', 'rejected')
    AND "reviewedBy" = (
      SELECT id FROM agricoop_app.users
      WHERE "openId" = (SELECT auth.uid())::text
    )
    AND "reviewedAt" IS NOT NULL
    AND ("status" <> 'rejected' OR NULLIF(btrim("reviewNote"), '') IS NOT NULL)
  );

CREATE POLICY agricoop_profile_verification_notification_insert
  ON agricoop_app.notifications FOR INSERT TO authenticated
  WITH CHECK (
    "relatedEntityType" = 'profile_verification_submission'
    AND "type" IN (
      'profile_verification_submitted',
      'profile_verification_approved',
      'profile_verification_rejected'
    )
    AND EXISTS (
      SELECT 1
      FROM agricoop_app."profileVerificationSubmissions" AS submission
      WHERE submission."id" = "relatedEntityId"
        AND submission."userId" = "userId"
        AND (
          (
            "type" = 'profile_verification_submitted'
            AND submission."status" = 'pending'
            AND submission."userId" = (
              SELECT id FROM agricoop_app.users
              WHERE "openId" = (SELECT auth.uid())::text
            )
          )
          OR (
            "type" IN ('profile_verification_approved', 'profile_verification_rejected')
            AND submission."status"::text = split_part("type", 'profile_verification_', 2)
            AND agricoop_app.can_review_profile_verification_user(submission."userId")
          )
        )
    )
  );

CREATE POLICY agricoop_notifications_self_read
  ON agricoop_app.notifications FOR SELECT TO authenticated
  USING (
    "userId" = (
      SELECT id FROM agricoop_app.users
      WHERE "openId" = (SELECT auth.uid())::text
    )
  );

CREATE POLICY agricoop_notifications_self_mark_read
  ON agricoop_app.notifications FOR UPDATE TO authenticated
  USING (
    "userId" = (
      SELECT id FROM agricoop_app.users
      WHERE "openId" = (SELECT auth.uid())::text
    )
  )
  WITH CHECK (
    "userId" = (
      SELECT id FROM agricoop_app.users
      WHERE "openId" = (SELECT auth.uid())::text
    )
    AND "isRead" IN (0, 1)
  );

CREATE TRIGGER agricoop_profile_verification_guard
  BEFORE UPDATE OF "verificationStatus", "verificationNote", "verifiedBy", "verifiedAt", "birthdate", "phone", "address"
  ON agricoop_app.users
  FOR EACH ROW
  EXECUTE FUNCTION agricoop_app.guard_profile_verification_user_update();

CREATE TRIGGER agricoop_profile_verification_audit_event
  AFTER INSERT OR UPDATE OF "status"
  ON agricoop_app."profileVerificationSubmissions"
  FOR EACH ROW
  EXECUTE FUNCTION agricoop_app.write_profile_verification_audit_event();

DO $postflight$
BEGIN
  IF NOT has_schema_privilege('authenticated', 'agricoop_app', 'USAGE')
     OR NOT has_table_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'userId', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'storagePath', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'mimeType', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'fileSizeBytes', 'INSERT')
     OR has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'status', 'INSERT')
     OR has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'reviewedBy', 'INSERT')
     OR has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'reviewedAt', 'INSERT')
     OR has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'reviewNote', 'INSERT')
     OR has_table_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'INSERT')
     OR has_table_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'UPDATE')
     OR has_table_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'DELETE')
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'agricoop_app'
         AND tablename = 'profileVerificationSubmissions'
         AND policyname = 'agricoop_profile_verification_self_insert'
         AND with_check LIKE '%agricoop.profile_verification_upload_verified%'
     )
     OR NOT has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'status', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'verificationStatus', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'verifiedBy', 'UPDATE')
     OR has_any_column_privilege('authenticated', 'agricoop_app."auditLogs"', 'INSERT')
     OR NOT has_any_column_privilege('authenticated', 'agricoop_app.notifications', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'agricoop_app.notifications', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.notifications', 'isRead', 'UPDATE')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'agricoop_app."profileVerificationSubmissions"'::regclass)
     OR NOT has_function_privilege('authenticated', 'agricoop_app.can_review_profile_verification_user(integer)', 'EXECUTE')
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger
       WHERE tgrelid = 'agricoop_app."profileVerificationSubmissions"'::regclass
         AND tgname = 'agricoop_profile_verification_audit_event'
         AND tgenabled = 'O'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'Profile-verification migration postcondition failed: required grants or RLS are missing';
  END IF;
END
$postflight$;

COMMIT;

-- Manual rollback only after confirming the table has no submissions:
-- DROP POLICY agricoop_profile_verification_admin_update ON agricoop_app."profileVerificationSubmissions";
-- DROP POLICY agricoop_notifications_self_mark_read ON agricoop_app.notifications;
-- DROP POLICY agricoop_notifications_self_read ON agricoop_app.notifications;
-- DROP POLICY agricoop_profile_verification_notification_insert ON agricoop_app.notifications;
-- DROP POLICY agricoop_profile_verification_self_insert ON agricoop_app."profileVerificationSubmissions";
-- DROP POLICY agricoop_profile_verification_admin_read ON agricoop_app."profileVerificationSubmissions";
-- DROP POLICY agricoop_profile_verification_self_select ON agricoop_app."profileVerificationSubmissions";
-- DROP POLICY agricoop_profile_verification_admin_update ON agricoop_app.users;
-- DROP POLICY agricoop_profile_verification_admin_select ON agricoop_app.users;
-- DROP TABLE agricoop_app."profileVerificationSubmissions";
-- DROP FUNCTION agricoop_app.can_review_profile_verification_user(integer);
-- DROP TRIGGER agricoop_profile_verification_guard ON agricoop_app.users;
-- DROP TRIGGER agricoop_profile_verification_audit_event ON agricoop_app."profileVerificationSubmissions";
-- DROP FUNCTION agricoop_app.write_profile_verification_audit_event();
-- DROP FUNCTION agricoop_app.guard_profile_verification_user_update();
-- Revoke only the exact grants above after comparing them with a pre-change ACL snapshot.
```

---

## BLOCK 5: `20261117130000_app_security_helpers.sql`

```sql
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
```

---

## BLOCK 6: `20261117131000_marketplace_rls_grants.sql`

```sql
-- PURPOSE: Least-privilege GRANTs + RLS for existing marketplace tables and the 8 active-application tables.
-- DEPENDENCIES: 20261117100000 (auth), 20261117105000 (new tables), 20261117110000 (txn option),
--               20261117120000 (verification), 20261117130000 (helpers).
-- TOUCHES: ENABLE RLS, REVOKE broad privileges, GRANT column/table privileges, CREATE POLICY.
-- DOES NOT TOUCH: Storage, enum ADD VALUE, get_my_role(), row data, profile-verification policies (kept).
-- SKIP drafts: none of the four November drafts — run them first if not applied.
-- OWNER-RUN ONLY after catalog preflight + backup/PITR.

BEGIN;

DO $preflight$
DECLARE
  missing text[];
BEGIN
  IF to_regprocedure('agricoop_app.current_app_user_id()') IS NULL
     OR to_regprocedure('agricoop_app.shares_cooperative(integer)') IS NULL THEN
    RAISE EXCEPTION 'Marketplace RLS stopped: run 20261117130000 helpers first';
  END IF;

  SELECT array_agg(t) INTO missing
  FROM unnest(ARRAY[
    'agricoop_app.cooperatives',
    'agricoop_app.users',
    'agricoop_app.products',
    'agricoop_app.orders',
    'agricoop_app."orderItems"',
    'agricoop_app."orderEvents"',
    'agricoop_app.transactions',
    'agricoop_app."paymentOptions"',
    'agricoop_app."paymentProofs"',
    'agricoop_app.quotations',
    'agricoop_app.conversations',
    'agricoop_app."conversationMessages"',
    'agricoop_app."cooperativeAssociationRequests"',
    'agricoop_app."productImages"',
    'agricoop_app.payments',
    'agricoop_app."paymentEvents"',
    'agricoop_app.notifications',
    'agricoop_app."supportTickets"',
    'agricoop_app."supportTicketMessages"',
    'agricoop_app."auditLogs"'
  ]) AS t
  WHERE to_regclass(t) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Marketplace RLS stopped: missing tables %', missing;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'Marketplace RLS stopped: anon/authenticated roles missing';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- Enable RLS on marketplace tables (idempotent)
-- ---------------------------------------------------------------------------
DO $enable_rls$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'agricoop_app.cooperatives',
    'agricoop_app.products',
    'agricoop_app."productImages"',
    'agricoop_app.quotations',
    'agricoop_app.orders',
    'agricoop_app."orderItems"',
    'agricoop_app."orderEvents"',
    'agricoop_app.transactions',
    'agricoop_app."paymentOptions"',
    'agricoop_app."paymentProofs"',
    'agricoop_app.conversations',
    'agricoop_app."conversationMessages"',
    'agricoop_app."cooperativeAssociationRequests"',
    'agricoop_app.payments',
    'agricoop_app."paymentEvents"',
    'agricoop_app.notifications',
    'agricoop_app."supportTickets"',
    'agricoop_app."supportTicketMessages"',
    'agricoop_app."auditLogs"'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  END LOOP;
END
$enable_rls$;

-- ---------------------------------------------------------------------------
-- Revoke broad table privileges then grant least privilege
-- ---------------------------------------------------------------------------
DO $revoke_all$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'agricoop_app.cooperatives',
    'agricoop_app.products',
    'agricoop_app."productImages"',
    'agricoop_app.quotations',
    'agricoop_app.orders',
    'agricoop_app."orderItems"',
    'agricoop_app."orderEvents"',
    'agricoop_app.transactions',
    'agricoop_app."paymentOptions"',
    'agricoop_app."paymentProofs"',
    'agricoop_app.conversations',
    'agricoop_app."conversationMessages"',
    'agricoop_app."cooperativeAssociationRequests"',
    'agricoop_app.payments',
    'agricoop_app."paymentEvents"',
    'agricoop_app.notifications',
    'agricoop_app."supportTickets"',
    'agricoop_app."supportTicketMessages"',
    'agricoop_app."auditLogs"'
  ]
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC, anon, authenticated, service_role', target);
  END LOOP;
END
$revoke_all$;

-- Schema usage for anon marketplace browse
GRANT USAGE ON SCHEMA agricoop_app TO anon, authenticated;

-- cooperatives
GRANT SELECT ON TABLE agricoop_app.cooperatives TO anon, authenticated;
GRANT INSERT ("name", "normalizedName", "description", "location", "status") ON TABLE agricoop_app.cooperatives TO authenticated;
GRANT UPDATE ("name", "normalizedName", "description", "location", "status") ON TABLE agricoop_app.cooperatives TO authenticated;

-- products
GRANT SELECT ON TABLE agricoop_app.products TO anon, authenticated;
GRANT INSERT (
  "sellerId", "cooperativeId", "name", "category", "variety", "description", "unit",
  "priceCents", "stockQty", "minOrderQty", "qualityGrade", "status", "verificationStatus",
  "visibility", "rejectionReason", "primaryImageUrl"
) ON TABLE agricoop_app.products TO authenticated;
GRANT UPDATE (
  "name", "category", "variety", "description", "unit", "priceCents", "stockQty", "minOrderQty",
  "qualityGrade", "status", "verificationStatus", "visibility", "rejectionReason", "primaryImageUrl",
  "cooperativeId", "updatedAt"
) ON TABLE agricoop_app.products TO authenticated;

-- productImages
GRANT SELECT ON TABLE agricoop_app."productImages" TO anon, authenticated;
GRANT INSERT ("productId", "imageUrl", "displayOrder") ON TABLE agricoop_app."productImages" TO authenticated;
GRANT UPDATE ("imageUrl", "displayOrder") ON TABLE agricoop_app."productImages" TO authenticated;
GRANT DELETE ON TABLE agricoop_app."productImages" TO authenticated;

-- quotations
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app.quotations TO authenticated;

-- orders / items / events / transactions
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app.orders TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app."orderItems" TO authenticated;
GRANT SELECT, INSERT ON TABLE agricoop_app."orderEvents" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app.transactions TO authenticated;

-- payment options / proofs / payments / events
GRANT SELECT ON TABLE agricoop_app."paymentOptions" TO authenticated;
GRANT INSERT (
  "cooperativeId", "paymentMethod", "displayName", "accountName", "accountNumber",
  "qrImagePath", "instructions", "isActive", "createdBy"
) ON TABLE agricoop_app."paymentOptions" TO authenticated;
GRANT UPDATE (
  "paymentMethod", "displayName", "accountName", "accountNumber", "qrImagePath",
  "instructions", "isActive", "updatedAt"
) ON TABLE agricoop_app."paymentOptions" TO authenticated;
GRANT DELETE ON TABLE agricoop_app."paymentOptions" TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app."paymentProofs" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app.payments TO authenticated;
GRANT SELECT, INSERT ON TABLE agricoop_app."paymentEvents" TO authenticated;

-- conversations
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app.conversations TO authenticated;
GRANT SELECT, INSERT ON TABLE agricoop_app."conversationMessages" TO authenticated;

-- association requests
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app."cooperativeAssociationRequests" TO authenticated;

-- notifications: SELECT/UPDATE only — INSERT via SECURITY DEFINER (next migration)
GRANT SELECT ON TABLE agricoop_app.notifications TO authenticated;
GRANT UPDATE ("isRead") ON TABLE agricoop_app.notifications TO authenticated;

-- support
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app."supportTickets" TO authenticated;
GRANT SELECT, INSERT ON TABLE agricoop_app."supportTicketMessages" TO authenticated;

-- auditLogs: SELECT only for staff — INSERT via SECURITY DEFINER / trigger
GRANT SELECT ON TABLE agricoop_app."auditLogs" TO authenticated;

-- Sequence grants for serial tables used by authenticated writers
DO $seq_grants$
DECLARE
  target_table text;
  target_sequence text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'agricoop_app.cooperatives',
    'agricoop_app.products',
    'agricoop_app."productImages"',
    'agricoop_app.quotations',
    'agricoop_app.orders',
    'agricoop_app."orderItems"',
    'agricoop_app."orderEvents"',
    'agricoop_app.transactions',
    'agricoop_app."paymentOptions"',
    'agricoop_app.payments',
    'agricoop_app."paymentEvents"',
    'agricoop_app.conversations',
    'agricoop_app."conversationMessages"',
    'agricoop_app."cooperativeAssociationRequests"',
    'agricoop_app.notifications',
    'agricoop_app."supportTickets"',
    'agricoop_app."supportTicketMessages"',
    'agricoop_app."auditLogs"'
  ]
  LOOP
    target_sequence := pg_get_serial_sequence(target_table, 'id');
    IF target_sequence IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', target_sequence);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', target_sequence);
  END LOOP;
END
$seq_grants$;

-- Public marketplace joins need seller display name for anon browse
GRANT SELECT ("id", "name", "approvalStatus", "role") ON TABLE agricoop_app.users TO anon;

-- Extra users column grants for staff-managed protected fields (guarded by policies + app authz)
GRANT SELECT (
  "id", "openId", "name", "email", "role", "approvalStatus", "verificationStatus",
  "verificationNote", "verifiedBy", "verifiedAt", "profileImageUrl", "birthdate", "phone",
  "address", "cooperativeId", "contactNumber", "createdAt", "updatedAt", "lastSignedIn", "loginMethod"
) ON TABLE agricoop_app.users TO authenticated;
GRANT UPDATE (
  "role", "approvalStatus", "cooperativeId", "verificationStatus", "verificationNote",
  "verifiedBy", "verifiedAt", "birthdate", "phone", "address", "name", "email",
  "loginMethod", "lastSignedIn", "contactNumber", "updatedAt"
) ON TABLE agricoop_app.users TO authenticated;

-- ---------------------------------------------------------------------------
-- Drop conflicting marketplace policies if re-run (repeatable names)
-- ---------------------------------------------------------------------------
DO $drop_policies$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'agricoop_app'
      AND policyname LIKE 'agricoop_mkt_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END
$drop_policies$;

-- cooperatives
CREATE POLICY agricoop_mkt_cooperatives_anon_read
  ON agricoop_app.cooperatives FOR SELECT TO anon, authenticated
  USING ("status" = 'active' OR agricoop_app.is_staff());

CREATE POLICY agricoop_mkt_cooperatives_superadmin_write
  ON agricoop_app.cooperatives FOR ALL TO authenticated
  USING (agricoop_app.is_superadmin())
  WITH CHECK (agricoop_app.is_superadmin());

-- products: public catalog + seller/staff
CREATE POLICY agricoop_mkt_products_public_read
  ON agricoop_app.products FOR SELECT TO anon, authenticated
  USING (
    (
      "status" = 'published'
      AND "verificationStatus" = 'approved'
      AND "visibility" = 'visible'
      AND EXISTS (
        SELECT 1 FROM agricoop_app.users s
        WHERE s.id = products."sellerId" AND s."approvalStatus" = 'approved'
      )
    )
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  );

CREATE POLICY agricoop_mkt_products_seller_insert
  ON agricoop_app.products FOR INSERT TO authenticated
  WITH CHECK (
    "sellerId" = agricoop_app.current_app_user_id()
    AND agricoop_app.current_app_role() IN ('seller', 'admin', 'superadmin')
  );

CREATE POLICY agricoop_mkt_products_seller_update
  ON agricoop_app.products FOR UPDATE TO authenticated
  USING (
    "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  )
  WITH CHECK (
    "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  );

-- productImages
CREATE POLICY agricoop_mkt_product_images_read
  ON agricoop_app."productImages" FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agricoop_app.products p
      WHERE p.id = "productId"
        AND (
          (p."status" = 'published' AND p."verificationStatus" = 'approved' AND p."visibility" = 'visible')
          OR p."sellerId" = agricoop_app.current_app_user_id()
          OR agricoop_app.shares_cooperative(p."cooperativeId")
          OR agricoop_app.is_superadmin()
        )
    )
  );

CREATE POLICY agricoop_mkt_product_images_write
  ON agricoop_app."productImages" FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agricoop_app.products p
      WHERE p.id = "productId" AND p."sellerId" = agricoop_app.current_app_user_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agricoop_app.products p
      WHERE p.id = "productId" AND p."sellerId" = agricoop_app.current_app_user_id()
    )
  );

-- quotations
CREATE POLICY agricoop_mkt_quotations_access
  ON agricoop_app.quotations FOR SELECT TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.is_superadmin()
  );

CREATE POLICY agricoop_mkt_quotations_insert
  ON agricoop_app.quotations FOR INSERT TO authenticated
  WITH CHECK ("buyerId" = agricoop_app.current_app_user_id());

CREATE POLICY agricoop_mkt_quotations_update
  ON agricoop_app.quotations FOR UPDATE TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
  )
  WITH CHECK (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
  );

-- orders
CREATE POLICY agricoop_mkt_orders_select
  ON agricoop_app.orders FOR SELECT TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  );

CREATE POLICY agricoop_mkt_orders_insert
  ON agricoop_app.orders FOR INSERT TO authenticated
  WITH CHECK ("buyerId" = agricoop_app.current_app_user_id());

CREATE POLICY agricoop_mkt_orders_update
  ON agricoop_app.orders FOR UPDATE TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  )
  WITH CHECK (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  );

-- orderItems / orderEvents / transactions follow parent order access
CREATE POLICY agricoop_mkt_order_items_select
  ON agricoop_app."orderItems" FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId"
        AND (
          o."buyerId" = agricoop_app.current_app_user_id()
          OR o."sellerId" = agricoop_app.current_app_user_id()
          OR agricoop_app.shares_cooperative(o."cooperativeId")
          OR agricoop_app.is_superadmin()
        )
    )
  );

CREATE POLICY agricoop_mkt_order_items_insert
  ON agricoop_app."orderItems" FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId" AND o."buyerId" = agricoop_app.current_app_user_id()
    )
  );

CREATE POLICY agricoop_mkt_order_items_update
  ON agricoop_app."orderItems" FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId"
        AND (agricoop_app.shares_cooperative(o."cooperativeId") OR agricoop_app.is_superadmin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId"
        AND (agricoop_app.shares_cooperative(o."cooperativeId") OR agricoop_app.is_superadmin())
    )
  );

CREATE POLICY agricoop_mkt_order_events_select
  ON agricoop_app."orderEvents" FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId"
        AND (
          o."buyerId" = agricoop_app.current_app_user_id()
          OR o."sellerId" = agricoop_app.current_app_user_id()
          OR agricoop_app.shares_cooperative(o."cooperativeId")
          OR agricoop_app.is_superadmin()
        )
    )
  );

CREATE POLICY agricoop_mkt_order_events_insert
  ON agricoop_app."orderEvents" FOR INSERT TO authenticated
  WITH CHECK (
    "actorUserId" = agricoop_app.current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId"
        AND (
          o."buyerId" = agricoop_app.current_app_user_id()
          OR o."sellerId" = agricoop_app.current_app_user_id()
          OR agricoop_app.shares_cooperative(o."cooperativeId")
          OR agricoop_app.is_superadmin()
        )
    )
  );

CREATE POLICY agricoop_mkt_transactions_select
  ON agricoop_app.transactions FOR SELECT TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId"
        AND (agricoop_app.shares_cooperative(o."cooperativeId") OR agricoop_app.is_superadmin())
    )
  );

CREATE POLICY agricoop_mkt_transactions_insert
  ON agricoop_app.transactions FOR INSERT TO authenticated
  WITH CHECK ("buyerId" = agricoop_app.current_app_user_id());

CREATE POLICY agricoop_mkt_transactions_update
  ON agricoop_app.transactions FOR UPDATE TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = transactions."orderId"
        AND (agricoop_app.shares_cooperative(o."cooperativeId") OR agricoop_app.is_superadmin())
    )
  )
  WITH CHECK (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = transactions."orderId"
        AND (agricoop_app.shares_cooperative(o."cooperativeId") OR agricoop_app.is_superadmin())
    )
  );

-- paymentOptions
CREATE POLICY agricoop_mkt_payment_options_select
  ON agricoop_app."paymentOptions" FOR SELECT TO authenticated
  USING (
    ("isActive" = true)
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
    OR ("cooperativeId" IS NULL AND agricoop_app.is_staff())
  );

CREATE POLICY agricoop_mkt_payment_options_write
  ON agricoop_app."paymentOptions" FOR ALL TO authenticated
  USING (
    agricoop_app.is_superadmin()
    OR agricoop_app.shares_cooperative("cooperativeId")
  )
  WITH CHECK (
    agricoop_app.is_superadmin()
    OR agricoop_app.shares_cooperative("cooperativeId")
  );

-- paymentProofs
CREATE POLICY agricoop_mkt_payment_proofs_select
  ON agricoop_app."paymentProofs" FOR SELECT TO authenticated
  USING (
    "uploadedBy" = agricoop_app.current_app_user_id()
    OR (
      agricoop_app.is_staff()
      AND EXISTS (
        SELECT 1 FROM agricoop_app.orders o
        WHERE o.id = "orderId"
          AND o."buyerId" <> agricoop_app.current_app_user_id()
          AND o."sellerId" <> agricoop_app.current_app_user_id()
          AND (agricoop_app.is_superadmin() OR agricoop_app.shares_cooperative(o."cooperativeId"))
      )
    )
  );

CREATE POLICY agricoop_mkt_payment_proofs_insert
  ON agricoop_app."paymentProofs" FOR INSERT TO authenticated
  WITH CHECK (
    "uploadedBy" = agricoop_app.current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId" AND o."buyerId" = agricoop_app.current_app_user_id()
    )
  );

CREATE POLICY agricoop_mkt_payment_proofs_update
  ON agricoop_app."paymentProofs" FOR UPDATE TO authenticated
  USING (
    agricoop_app.is_staff()
    AND EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId"
        AND o."buyerId" <> agricoop_app.current_app_user_id()
        AND o."sellerId" <> agricoop_app.current_app_user_id()
        AND (agricoop_app.is_superadmin() OR agricoop_app.shares_cooperative(o."cooperativeId"))
    )
  )
  WITH CHECK (
    agricoop_app.is_staff()
    AND EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId"
        AND (agricoop_app.is_superadmin() OR agricoop_app.shares_cooperative(o."cooperativeId"))
    )
  );

-- payments / paymentEvents
CREATE POLICY agricoop_mkt_payments_select
  ON agricoop_app.payments FOR SELECT TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  );

CREATE POLICY agricoop_mkt_payments_insert
  ON agricoop_app.payments FOR INSERT TO authenticated
  WITH CHECK (
    "buyerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.is_staff()
  );

CREATE POLICY agricoop_mkt_payments_update
  ON agricoop_app.payments FOR UPDATE TO authenticated
  USING (
    agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
    OR "sellerId" = agricoop_app.current_app_user_id()
  )
  WITH CHECK (
    agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
    OR "sellerId" = agricoop_app.current_app_user_id()
  );

CREATE POLICY agricoop_mkt_payment_events_select
  ON agricoop_app."paymentEvents" FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agricoop_app.payments p
      WHERE p.id = "paymentId"
        AND (
          p."buyerId" = agricoop_app.current_app_user_id()
          OR p."sellerId" = agricoop_app.current_app_user_id()
          OR agricoop_app.shares_cooperative(p."cooperativeId")
          OR agricoop_app.is_superadmin()
        )
    )
  );

CREATE POLICY agricoop_mkt_payment_events_insert
  ON agricoop_app."paymentEvents" FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agricoop_app.payments p
      WHERE p.id = "paymentId"
        AND (
          agricoop_app.shares_cooperative(p."cooperativeId")
          OR agricoop_app.is_superadmin()
          OR p."sellerId" = agricoop_app.current_app_user_id()
          OR p."buyerId" = agricoop_app.current_app_user_id()
        )
    )
  );

-- conversations / messages
CREATE POLICY agricoop_mkt_conversations_select
  ON agricoop_app.conversations FOR SELECT TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.is_superadmin()
    OR (
      agricoop_app.current_app_role() = 'admin'
      AND "sellerId" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM agricoop_app.users s
        WHERE s.id = "sellerId"
          AND s."cooperativeId" = agricoop_app.current_app_cooperative_id()
      )
    )
  );

CREATE POLICY agricoop_mkt_conversations_insert
  ON agricoop_app.conversations FOR INSERT TO authenticated
  WITH CHECK ("buyerId" = agricoop_app.current_app_user_id());

CREATE POLICY agricoop_mkt_conversations_update
  ON agricoop_app.conversations FOR UPDATE TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.is_staff()
  )
  WITH CHECK (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.is_staff()
  );

CREATE POLICY agricoop_mkt_conversation_messages_select
  ON agricoop_app."conversationMessages" FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agricoop_app.conversations c
      WHERE c.id = "conversationId"
        AND (
          c."buyerId" = agricoop_app.current_app_user_id()
          OR c."sellerId" = agricoop_app.current_app_user_id()
          OR agricoop_app.is_superadmin()
          OR (
            agricoop_app.current_app_role() = 'admin'
            AND c."sellerId" IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM agricoop_app.users s
              WHERE s.id = c."sellerId"
                AND s."cooperativeId" = agricoop_app.current_app_cooperative_id()
            )
          )
        )
    )
  );

CREATE POLICY agricoop_mkt_conversation_messages_insert
  ON agricoop_app."conversationMessages" FOR INSERT TO authenticated
  WITH CHECK (
    "senderId" = agricoop_app.current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM agricoop_app.conversations c
      WHERE c.id = "conversationId"
        AND (
          c."buyerId" = agricoop_app.current_app_user_id()
          OR c."sellerId" = agricoop_app.current_app_user_id()
          OR agricoop_app.is_staff()
        )
    )
  );

-- cooperative association requests
CREATE POLICY agricoop_mkt_assoc_select
  ON agricoop_app."cooperativeAssociationRequests" FOR SELECT TO authenticated
  USING (
    "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  );

CREATE POLICY agricoop_mkt_assoc_insert
  ON agricoop_app."cooperativeAssociationRequests" FOR INSERT TO authenticated
  WITH CHECK (
    "sellerId" = agricoop_app.current_app_user_id()
    AND agricoop_app.current_app_role() = 'seller'
  );

CREATE POLICY agricoop_mkt_assoc_update
  ON agricoop_app."cooperativeAssociationRequests" FOR UPDATE TO authenticated
  USING (
    agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  )
  WITH CHECK (
    agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  );

-- notifications self read/mark-read (insert via definer fn)
CREATE POLICY agricoop_mkt_notifications_self_select
  ON agricoop_app.notifications FOR SELECT TO authenticated
  USING ("userId" = agricoop_app.current_app_user_id());

CREATE POLICY agricoop_mkt_notifications_self_update
  ON agricoop_app.notifications FOR UPDATE TO authenticated
  USING ("userId" = agricoop_app.current_app_user_id())
  WITH CHECK ("userId" = agricoop_app.current_app_user_id() AND "isRead" IN (0, 1));

-- support tickets
CREATE POLICY agricoop_mkt_support_tickets_select
  ON agricoop_app."supportTickets" FOR SELECT TO authenticated
  USING (
    "userId" = agricoop_app.current_app_user_id()
    OR agricoop_app.is_superadmin()
    OR agricoop_app.shares_cooperative("cooperativeId")
  );

CREATE POLICY agricoop_mkt_support_tickets_insert
  ON agricoop_app."supportTickets" FOR INSERT TO authenticated
  WITH CHECK ("userId" = agricoop_app.current_app_user_id());

CREATE POLICY agricoop_mkt_support_tickets_update
  ON agricoop_app."supportTickets" FOR UPDATE TO authenticated
  USING (
    agricoop_app.is_superadmin()
    OR agricoop_app.shares_cooperative("cooperativeId")
  )
  WITH CHECK (
    agricoop_app.is_superadmin()
    OR agricoop_app.shares_cooperative("cooperativeId")
  );

CREATE POLICY agricoop_mkt_support_messages_select
  ON agricoop_app."supportTicketMessages" FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agricoop_app."supportTickets" t
      WHERE t.id = "ticketId"
        AND (
          t."userId" = agricoop_app.current_app_user_id()
          OR agricoop_app.is_superadmin()
          OR agricoop_app.shares_cooperative(t."cooperativeId")
        )
    )
  );

CREATE POLICY agricoop_mkt_support_messages_insert
  ON agricoop_app."supportTicketMessages" FOR INSERT TO authenticated
  WITH CHECK (
    "senderId" = agricoop_app.current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM agricoop_app."supportTickets" t
      WHERE t.id = "ticketId"
        AND (
          t."userId" = agricoop_app.current_app_user_id()
          OR agricoop_app.is_superadmin()
          OR agricoop_app.shares_cooperative(t."cooperativeId")
        )
    )
  );

-- auditLogs SELECT for staff (INSERT denied at table grant; definer fn used)
CREATE POLICY agricoop_mkt_audit_logs_select
  ON agricoop_app."auditLogs" FOR SELECT TO authenticated
  USING (
    agricoop_app.is_superadmin()
    OR (
      agricoop_app.current_app_role() = 'admin'
      AND "cooperativeId" IS NOT NULL
      AND "cooperativeId" = agricoop_app.current_app_cooperative_id()
    )
  );

-- users: anon sees only public seller display fields for approved sellers
CREATE POLICY agricoop_mkt_users_anon_public_seller
  ON agricoop_app.users FOR SELECT TO anon
  USING ("approvalStatus" = 'approved' AND "role" IN ('seller', 'admin', 'superadmin'));

-- users: staff can read/update peers within scope (self policies from auth migration remain)
CREATE POLICY agricoop_mkt_users_staff_select
  ON agricoop_app.users FOR SELECT TO authenticated
  USING (
    agricoop_app.is_superadmin()
    OR (
      agricoop_app.current_app_role() = 'admin'
      AND "cooperativeId" IS NOT NULL
      AND "cooperativeId" = agricoop_app.current_app_cooperative_id()
    )
    OR (
      -- marketplace joins need seller name for approved sellers of visible products
      "approvalStatus" = 'approved'
      AND "role" IN ('seller', 'admin', 'superadmin')
    )
  );

CREATE POLICY agricoop_mkt_users_staff_update
  ON agricoop_app.users FOR UPDATE TO authenticated
  USING (
    agricoop_app.is_superadmin()
    OR (
      agricoop_app.current_app_role() = 'admin'
      AND "cooperativeId" IS NOT NULL
      AND "cooperativeId" = agricoop_app.current_app_cooperative_id()
      AND "role" <> 'superadmin'
      AND "id" <> agricoop_app.current_app_user_id()
    )
  )
  WITH CHECK (
    agricoop_app.is_superadmin()
    OR (
      agricoop_app.current_app_role() = 'admin'
      AND "cooperativeId" = agricoop_app.current_app_cooperative_id()
      AND "role" <> 'superadmin'
      AND "id" <> agricoop_app.current_app_user_id()
    )
  );

-- Guard: block self-service promotion / coop self-assignment on users
CREATE OR REPLACE FUNCTION agricoop_app.guard_users_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  actor_id integer := agricoop_app.current_app_user_id();
  actor_role text := agricoop_app.current_app_role();
BEGIN
  IF NEW."role" IS DISTINCT FROM OLD."role"
     OR NEW."approvalStatus" IS DISTINCT FROM OLD."approvalStatus"
     OR NEW."cooperativeId" IS DISTINCT FROM OLD."cooperativeId"
     OR NEW."verificationStatus" IS DISTINCT FROM OLD."verificationStatus"
     OR NEW."verifiedBy" IS DISTINCT FROM OLD."verifiedBy"
     OR NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt" THEN
    IF actor_id IS NULL THEN
      RAISE EXCEPTION 'Protected user fields require an authenticated application user';
    END IF;
    -- Self may change verification fields only when verification upload flag set (existing trigger)
    -- or when staff. Never allow self role/approval/coop changes.
    IF actor_id = OLD.id THEN
      IF NEW."role" IS DISTINCT FROM OLD."role"
         OR NEW."approvalStatus" IS DISTINCT FROM OLD."approvalStatus"
         OR NEW."cooperativeId" IS DISTINCT FROM OLD."cooperativeId" THEN
        RAISE EXCEPTION 'Users cannot change their own role, approval status, or cooperative';
      END IF;
    ELSIF actor_role NOT IN ('admin', 'superadmin') THEN
      RAISE EXCEPTION 'Only Admin or SuperAdmin can change protected user fields';
    ELSIF actor_role = 'admin'
          AND (
            OLD."cooperativeId" IS DISTINCT FROM agricoop_app.current_app_cooperative_id()
            OR NEW."cooperativeId" IS DISTINCT FROM agricoop_app.current_app_cooperative_id()
            OR NEW."role" = 'superadmin'
            OR OLD."role" = 'superadmin'
          ) THEN
      RAISE EXCEPTION 'Admin cannot change users outside their cooperative or promote SuperAdmin';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION agricoop_app.guard_users_protected_columns() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS agricoop_users_protected_columns_guard ON agricoop_app.users;
CREATE TRIGGER agricoop_users_protected_columns_guard
  BEFORE UPDATE OF "role", "approvalStatus", "cooperativeId", "verificationStatus", "verifiedBy", "verifiedAt"
  ON agricoop_app.users
  FOR EACH ROW
  EXECUTE FUNCTION agricoop_app.guard_users_protected_columns();

DO $postflight$
BEGIN
  IF NOT has_table_privilege('authenticated', 'agricoop_app.products', 'SELECT')
     OR NOT has_table_privilege('anon', 'agricoop_app.products', 'SELECT')
     OR has_table_privilege('authenticated', 'agricoop_app."auditLogs"', 'INSERT')
     OR has_table_privilege('authenticated', 'agricoop_app."auditLogs"', 'UPDATE')
     OR has_table_privilege('authenticated', 'agricoop_app."auditLogs"', 'DELETE') THEN
    RAISE EXCEPTION 'Marketplace RLS postflight failed: grants do not match least-privilege expectations';
  END IF;
END
$postflight$;

COMMIT;

-- Verification samples (read-only after run):
-- SELECT tablename, policyname, cmd, roles FROM pg_policies
--  WHERE schemaname = 'agricoop_app' AND policyname LIKE 'agricoop_mkt_%' ORDER BY 1,2;
-- SELECT has_table_privilege('authenticated','agricoop_app."auditLogs"','INSERT'); -- expect false

-- ROLLBACK outline:
-- DROP TRIGGER IF EXISTS agricoop_users_protected_columns_guard ON agricoop_app.users;
-- DROP FUNCTION IF EXISTS agricoop_app.guard_users_protected_columns();
-- DROP POLICY ... (all agricoop_mkt_*); REVOKE granted privileges; restore prior grants from catalog backup.
```

---

## BLOCK 7: `20261117132000_secure_audit_notification_writes.sql`

```sql
-- PURPOSE: Replace open notification INSERT and ordinary audit INSERT with SECURITY DEFINER writers.
-- DEPENDENCIES: 20261117105000, 20261117120000 (may have created verification-only notification INSERT policy),
--               20261117130000 helpers, 20261117131000 marketplace grants (SELECT on audit/notifications).
-- TOUCHES: DROP narrow notification INSERT policy; CREATE definer functions; optional INSERT policy for definer owner only is NOT used —
--          functions run as owner and bypass RLS; table INSERT remains revoked from authenticated.
-- DOES NOT TOUCH: Storage, enums, get_my_role(), verification audit trigger.
-- OWNER-RUN ONLY.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('agricoop_app."auditLogs"') IS NULL
     OR to_regclass('agricoop_app.notifications') IS NULL THEN
    RAISE EXCEPTION 'Secure writers stopped: auditLogs/notifications missing';
  END IF;
  IF to_regprocedure('agricoop_app.current_app_user_id()') IS NULL THEN
    RAISE EXCEPTION 'Secure writers stopped: helpers missing (run 20261117130000)';
  END IF;
  IF has_table_privilege('authenticated', 'agricoop_app."auditLogs"', 'INSERT') THEN
    RAISE EXCEPTION 'Secure writers stopped: authenticated still has auditLogs INSERT; reconcile grants first';
  END IF;
END
$preflight$;

-- Drop verification-only / marketplace notification INSERT policies so clients cannot INSERT directly.
DROP POLICY IF EXISTS agricoop_profile_verification_notification_insert ON agricoop_app.notifications;
DROP POLICY IF EXISTS agricoop_mkt_notifications_insert ON agricoop_app.notifications;

-- Keep self read/mark-read from either migration name set.
-- (If both exist, both are OR'd; harmless.)

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
  -- Allow-list of application audit actions used by routers.ts
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
    'cooperative_activated'
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

CREATE OR REPLACE FUNCTION agricoop_app.create_notification(
  p_user_id integer,
  p_type varchar,
  p_title varchar,
  p_content text,
  p_link varchar DEFAULT NULL,
  p_related_entity_id integer DEFAULT NULL,
  p_related_entity_type varchar DEFAULT NULL
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
  allowed boolean := false;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Notification write requires an authenticated application user';
  END IF;
  IF p_user_id IS NULL OR p_type IS NULL OR p_title IS NULL OR p_content IS NULL THEN
    RAISE EXCEPTION 'Notification payload is incomplete';
  END IF;
  IF length(p_type) > 50 OR length(p_title) > 255 THEN
    RAISE EXCEPTION 'Notification fields exceed allowed length';
  END IF;

  IF p_type NOT IN (
    'profile_verification_submitted',
    'profile_verification_approved',
    'profile_verification_rejected',
    'payment_proof_submitted',
    'payment_proof_verified',
    'payment_proof_rejected',
    'cash_payment_received',
    'cooperative_association_request',
    'cooperative_association_approved',
    'cooperative_association_rejected',
    'account_approval_status',
    'account_access_updated',
    'product_approved',
    'product_rejected',
    'support_ticket_created',
    'support_ticket_assigned',
    'support_ticket_reply',
    'support_ticket_status',
    'order_status_updated',
    'quotation_updated',
    'new_message'
  ) THEN
    RAISE EXCEPTION 'Notification type is not permitted';
  END IF;

  -- Relationship checks by type family
  IF p_type LIKE 'profile_verification_%' THEN
    allowed := (
      (p_type = 'profile_verification_submitted' AND p_user_id = actor_id)
      OR (p_type IN ('profile_verification_approved', 'profile_verification_rejected') AND actor_role IN ('admin', 'superadmin'))
    );
  ELSIF p_type LIKE 'payment_proof_%' OR p_type = 'cash_payment_received' THEN
    allowed := EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = p_related_entity_id
        AND o."buyerId" = p_user_id
        AND (
          o."buyerId" = actor_id
          OR o."sellerId" = actor_id
          OR agricoop_app.shares_cooperative(o."cooperativeId")
          OR agricoop_app.is_superadmin()
        )
    );
  ELSIF p_type LIKE 'cooperative_association_%' THEN
    allowed := (
      (p_type = 'cooperative_association_request' AND actor_role = 'seller' AND EXISTS (
        SELECT 1 FROM agricoop_app."cooperativeAssociationRequests" r
        WHERE r.id = p_related_entity_id AND r."sellerId" = actor_id AND p_user_id <> actor_id
      ))
      OR (p_type IN ('cooperative_association_approved', 'cooperative_association_rejected')
          AND actor_role IN ('admin', 'superadmin')
          AND EXISTS (
            SELECT 1 FROM agricoop_app."cooperativeAssociationRequests" r
            WHERE r.id = p_related_entity_id AND r."sellerId" = p_user_id
              AND (agricoop_app.shares_cooperative(r."cooperativeId") OR agricoop_app.is_superadmin())
          ))
    );
  ELSIF p_type IN ('account_approval_status', 'account_access_updated') THEN
    allowed := actor_role IN ('admin', 'superadmin') AND p_user_id <> actor_id;
  ELSIF p_type IN ('product_approved', 'product_rejected') THEN
    allowed := actor_role IN ('admin', 'superadmin') AND EXISTS (
      SELECT 1 FROM agricoop_app.products p
      WHERE p.id = p_related_entity_id AND p."sellerId" = p_user_id
        AND (agricoop_app.shares_cooperative(p."cooperativeId") OR agricoop_app.is_superadmin())
    );
  ELSIF p_type LIKE 'support_ticket_%' THEN
    allowed := EXISTS (
      SELECT 1 FROM agricoop_app."supportTickets" t
      WHERE (p_related_entity_id IS NULL OR t.id = p_related_entity_id)
        AND (
          (p_type = 'support_ticket_created' AND t."userId" = actor_id)
          OR actor_role IN ('admin', 'superadmin')
          OR t."userId" = actor_id
        )
    ) OR (p_type = 'support_ticket_created' AND p_user_id <> actor_id AND actor_id IS NOT NULL);
  ELSIF p_type IN ('order_status_updated', 'quotation_updated', 'new_message') THEN
    allowed := actor_id IS NOT NULL;
  ELSE
    allowed := false;
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Notification relationship check failed for type %', p_type;
  END IF;

  INSERT INTO agricoop_app.notifications (
    "userId", "type", "title", "content", "link", "relatedEntityId", "relatedEntityType"
  ) VALUES (
    p_user_id, p_type, p_title, p_content, p_link, p_related_entity_id, p_related_entity_type
  ) RETURNING id INTO new_id;

  RETURN new_id;
END
$fn$;

REVOKE ALL ON FUNCTION agricoop_app.write_audit_log(varchar, varchar, integer, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION agricoop_app.create_notification(integer, varchar, varchar, text, varchar, integer, varchar)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION agricoop_app.write_audit_log(varchar, varchar, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION agricoop_app.create_notification(integer, varchar, varchar, text, varchar, integer, varchar) TO authenticated;

-- Ensure authenticated cannot INSERT notifications directly (definer only)
REVOKE INSERT ON TABLE agricoop_app.notifications FROM PUBLIC, anon, authenticated, service_role;

DO $postflight$
BEGIN
  IF has_any_column_privilege('authenticated', 'agricoop_app.notifications', 'INSERT')
     OR has_any_column_privilege('authenticated', 'agricoop_app."auditLogs"', 'INSERT') THEN
    RAISE EXCEPTION 'Secure writers postflight failed: client INSERT still granted';
  END IF;
  IF to_regprocedure('agricoop_app.write_audit_log(varchar,varchar,integer,integer,text)') IS NULL
     OR to_regprocedure('agricoop_app.create_notification(integer,varchar,varchar,text,varchar,integer,varchar)') IS NULL THEN
    RAISE EXCEPTION 'Secure writers postflight failed: functions missing';
  END IF;
END
$postflight$;

COMMIT;

-- Verification:
-- SELECT has_any_column_privilege('authenticated','agricoop_app.notifications','INSERT'); -- false
-- SELECT has_function_privilege('authenticated','agricoop_app.create_notification(integer,varchar,varchar,text,varchar,integer,varchar)','EXECUTE'); -- true

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS agricoop_app.create_notification(integer,varchar,varchar,text,varchar,integer,varchar);
-- DROP FUNCTION IF EXISTS agricoop_app.write_audit_log(varchar,varchar,integer,integer,text);
-- Recreate agricoop_profile_verification_notification_insert from 20261117120000 if needed.
```

---

## BLOCK 8: `20261117133000_payment_proofs_id_default.sql`

```sql
-- PURPOSE: Additive default for paymentProofs.id when production has no sequence/identity (B8),
--          plus partial unique index for one active pending/verified proof per order.
-- LIVE CHECK (2026-11-17): production already has nextval('agricoop_app."paymentProofs_id_seq"');
--          the sequence/default section will NOTICE-skip; unique index still applies.
-- DEPENDENCIES: agricoop_app."paymentProofs" exists.
-- TOUCHES: CREATE SEQUENCE IF NOT EXISTS only if missing; OWNED BY; SET DEFAULT; setval; partial unique index.
-- DOES NOT TOUCH: existing proof rows' ids; payment-proofs bucket; other tables.
-- Compatible with app code that still uses advisory lock + max(id)+1 (both can coexist).
-- OWNER-RUN ONLY (paste via docs/MANUAL_SQL.md). Never executed by the agent.

BEGIN;

DO $preflight$
DECLARE
  dup_count integer;
BEGIN
  IF to_regclass('agricoop_app."paymentProofs"') IS NULL THEN
    RAISE EXCEPTION 'paymentProofs id migration stopped: table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'agricoop_app."paymentProofs"'::regclass
      AND attname = 'id'
      AND atttypid = 'integer'::regtype
      AND attnotnull
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'paymentProofs id migration stopped: id must be NOT NULL integer';
  END IF;

  -- Abort if active pending/verified duplicates would break the unique index
  SELECT count(*) INTO dup_count
  FROM (
    SELECT "orderId"
    FROM agricoop_app."paymentProofs"
    WHERE "verificationStatus" IN ('pending', 'verified')
    GROUP BY "orderId"
    HAVING count(*) > 1
  ) dups;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'paymentProofs id migration stopped: % orderId(s) have duplicate pending/verified proofs; reconcile manually', dup_count;
  END IF;
END
$preflight$;

DO $add_default$
DECLARE
  max_id integer;
  seq_name text := 'agricoop_app."paymentProofs_id_seq"';
BEGIN
  IF pg_get_serial_sequence('agricoop_app."paymentProofs"', 'id') IS NOT NULL THEN
    -- Already has a default sequence/identity — do not overwrite
    RAISE NOTICE 'paymentProofs.id already has a sequence default; skipping sequence create';
  ELSE
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %s AS integer', seq_name);
    EXECUTE format('ALTER SEQUENCE %s OWNED BY agricoop_app."paymentProofs".id', seq_name);
    SELECT coalesce(max(id), 0) INTO max_id FROM agricoop_app."paymentProofs";
    IF max_id = 0 THEN
      EXECUTE format('SELECT setval(%L::regclass, 1, false)', seq_name);
    ELSE
      EXECUTE format('SELECT setval(%L::regclass, %s, true)', seq_name, max_id);
    END IF;
    -- Only set DEFAULT when none exists
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = 'agricoop_app."paymentProofs"'::regclass
        AND attname = 'id'
        AND atthasdef
        AND NOT attisdropped
    ) THEN
      EXECUTE format(
        'ALTER TABLE agricoop_app."paymentProofs" ALTER COLUMN id SET DEFAULT nextval(%L)',
        seq_name
      );
    END IF;
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', seq_name);
  END IF;
END
$add_default$;

CREATE UNIQUE INDEX IF NOT EXISTS "paymentProofs_one_active_order_idx"
  ON agricoop_app."paymentProofs" ("orderId")
  WHERE "verificationStatus" IN ('pending', 'verified');

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'agricoop_app'
      AND indexname = 'paymentProofs_one_active_order_idx'
  ) THEN
    RAISE EXCEPTION 'paymentProofs id migration postflight failed: unique index missing';
  END IF;
END
$postflight$;

COMMIT;

-- Verification:
-- SELECT column_default FROM information_schema.columns
--  WHERE table_schema='agricoop_app' AND table_name='paymentProofs' AND column_name='id';
-- SELECT indexname, indexdef FROM pg_indexes
--  WHERE schemaname='agricoop_app' AND indexname='paymentProofs_one_active_order_idx';

-- ROLLBACK:
-- DROP INDEX IF EXISTS agricoop_app."paymentProofs_one_active_order_idx";
-- ALTER TABLE agricoop_app."paymentProofs" ALTER COLUMN id DROP DEFAULT;
-- -- only drop sequence if owned solely by this column and unused
```

---

## BLOCK 9: `supabase/storage/profile_verification_bucket.sql` (Storage)

```sql
-- Manual setup draft for the profile-verification document bucket.
-- Do not run until the project owner approves the target and confirms this
-- bucket does not contain existing data requiring a different configuration.
-- Application uploads/downloads are mediated by server-issued short-lived
-- capabilities (service role). Service role bypasses Storage RLS.
-- This script intentionally creates no client Storage policies (default-deny
-- for anon/authenticated direct object access is acceptable). Do not UPSERT-
-- overwrite product-images or payment-proofs from other templates.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'Storage setup stopped: storage.buckets is unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'storage.buckets'::regclass
      AND attname IN ('id', 'name', 'public', 'file_size_limit', 'allowed_mime_types')
      AND NOT attisdropped
    GROUP BY attrelid
    HAVING count(*) = 5
  ) THEN
    RAISE EXCEPTION 'Storage setup stopped: storage.buckets has an unexpected catalog shape';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'profile-verification-documents'
       OR name = 'profile-verification-documents'
  ) AND NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'profile-verification-documents'
      AND name = 'profile-verification-documents'
      AND public IS FALSE
      AND file_size_limit = 5242880
      AND allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
  ) THEN
    RAISE EXCEPTION 'Storage setup stopped: existing bucket configuration differs; reconcile it manually';
  END IF;
END
$preflight$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT
  'profile-verification-documents',
  'profile-verification-documents',
  FALSE,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
WHERE NOT EXISTS (
  SELECT 1
  FROM storage.buckets
  WHERE id = 'profile-verification-documents'
);

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'profile-verification-documents'
      AND name = 'profile-verification-documents'
      AND public IS FALSE
      AND file_size_limit = 5242880
      AND allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
  ) THEN
    RAISE EXCEPTION 'Storage setup verification failed: bucket is not private with the required limits';
  END IF;
END
$postflight$;

COMMIT;

-- Read-only verification after an approved run:
SELECT
  id = 'profile-verification-documents'
  AND name = 'profile-verification-documents' AS expected_bucket,
  public IS FALSE AS is_private,
  file_size_limit = 5242880 AS has_expected_size_limit,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[] AS has_expected_mime_types
FROM storage.buckets
WHERE id = 'profile-verification-documents';
```

## BLOCK 9: `20261117140000_anon_marketplace_browse_perf.sql`

```sql
-- PURPOSE: Unblock anon marketplace browse under RLS + add browse indexes / reserved-qty helper.
-- IDEMPOTENT / ADDITIVE ONLY.

BEGIN;

GRANT EXECUTE ON FUNCTION agricoop_app.shares_cooperative(integer) TO anon;
GRANT EXECUTE ON FUNCTION agricoop_app.is_superadmin() TO anon;
GRANT EXECUTE ON FUNCTION agricoop_app.is_staff() TO anon;

GRANT SELECT ("id", "name", "approvalStatus", "role") ON TABLE agricoop_app.users TO anon;

CREATE OR REPLACE FUNCTION agricoop_app.reserved_quantities_for_products(product_ids integer[])
RETURNS TABLE(product_id integer, quantity integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = agricoop_app, public
AS $fn$
  SELECT oi."productId" AS product_id,
         COALESCE(SUM(oi.quantity), 0)::integer AS quantity
  FROM agricoop_app."orderItems" oi
  INNER JOIN agricoop_app.orders o ON o.id = oi."orderId"
  WHERE oi."productId" = ANY(product_ids)
    AND o.status IN (
      'submitted'::agricoop_app.order_status,
      'confirmed'::agricoop_app.order_status,
      'ready'::agricoop_app.order_status
    )
  GROUP BY oi."productId";
$fn$;

REVOKE ALL ON FUNCTION agricoop_app.reserved_quantities_for_products(integer[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION agricoop_app.reserved_quantities_for_products(integer[]) TO anon, authenticated;

CREATE INDEX IF NOT EXISTS products_marketplace_browse_idx
  ON agricoop_app.products (status, "verificationStatus", visibility, "priceCents");

CREATE INDEX IF NOT EXISTS product_images_product_id_order_idx
  ON agricoop_app."productImages" ("productId", "displayOrder", id);

COMMIT;

-- Verification:
-- SELECT has_function_privilege('anon','agricoop_app.shares_cooperative(integer)','EXECUTE');
-- SELECT has_function_privilege('anon','agricoop_app.reserved_quantities_for_products(integer[])','EXECUTE');
-- SELECT indexname FROM pg_indexes WHERE indexname IN ('products_marketplace_browse_idx','product_images_product_id_order_idx');
```

## BLOCK 10: `20261117150000_orders_demo_seed_key.sql`

```sql
-- PURPOSE: Add missing orders.demoSeedKey so Drizzle order selects stop failing.
-- IDEMPOTENT / ADDITIVE ONLY.

BEGIN;

ALTER TABLE agricoop_app.orders
  ADD COLUMN IF NOT EXISTS "demoSeedKey" character varying(80);

CREATE UNIQUE INDEX IF NOT EXISTS orders_demo_seed_key_idx
  ON agricoop_app.orders ("demoSeedKey");

COMMIT;

-- Verification:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='agricoop_app' AND table_name='orders' AND column_name='demoSeedKey';
```

## BLOCK 11: Role reconciliation data fix (previewed, narrowly scoped)

```sql
-- PURPOSE: Align one mismatched profile role to the application users.role source of truth.
-- Preview first:
-- SELECT u.id, u.email, u.role, r.role_name
-- FROM agricoop_app.users u
-- JOIN public.profiles p ON p.user_id::text = u."openId"
-- JOIN public.roles r ON r.role_id = p.role_id
-- WHERE u.id = 2 AND u.email = 'heyyejayy1@gmail.com';

UPDATE public.profiles
SET role_id = 2
WHERE user_id = '35dcf280-c098-483a-91da-7e96662efc3b'
  AND role_id = 4
  AND email = 'heyyejayy1@gmail.com';

-- After: conflicts should be 0.
```

## BLOCK 12: `20261117180000_ux_inbox_and_indexes.sql`

```sql
-- PURPOSE: threadStates inbox metadata, soft-delete columns, marketplace indexes.
-- Applied via Supabase apply_migration name=ux_inbox_and_indexes
-- Verification: to_regclass('agricoop_app."threadStates"') is not null;
-- supportTickets has archivedAt, deletedAt, pinnedAt.
```

## BLOCK 12: `20261117180000_ux_inbox_and_indexes.sql` (applied via Supabase MCP as `ux_inbox_and_indexes`)

```sql
-- PURPOSE: Per-user inbox state + soft-delete columns + marketplace indexes.
-- IDEMPOTENT / ADDITIVE ONLY. Verified: to_regclass('agricoop_app."threadStates"') present.

CREATE TABLE IF NOT EXISTS agricoop_app."threadStates" (
  id serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES agricoop_app.users(id),
  channel varchar(32) NOT NULL,
  "threadId" integer NOT NULL,
  "isRead" integer NOT NULL DEFAULT 0,
  "pinnedAt" timestamp without time zone,
  "archivedAt" timestamp without time zone,
  "deletedAt" timestamp without time zone,
  "createdAt" timestamp without time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT thread_states_channel_check CHECK (channel IN ('conversation', 'ticket', 'support')),
  CONSTRAINT thread_states_user_channel_thread_uidx UNIQUE ("userId", channel, "threadId")
);

-- Plus ADD COLUMN IF NOT EXISTS archivedAt/deletedAt on conversations, notifications;
-- pinnedAt/archivedAt/deletedAt on supportTickets; product/conversation indexes;
-- RLS policy agricoop_thread_states_own for authenticated.
```

Verification (2026-11-17):
- `to_regclass('agricoop_app."threadStates"')` ? `agricoop_app."threadStates"`
- conversations / supportTickets soft-delete columns present

## BLOCK 13: `20261117200000_avatars_and_profile_image_grants.sql` (applied via Supabase MCP as `avatars_and_profile_image_grants`)

**Root cause (profile upload):** `authenticated` had SELECT-only on `agricoop_app.users."profileImageUrl"`, so Storage uploads succeeded (service role) but the subsequent `UPDATE users SET profileImageUrl` failed.

`sql
-- PURPOSE: Grant profile photo column writes + public avatars bucket + owner-scoped policies.
-- IDEMPOTENT / ADDITIVE ONLY.

GRANT UPDATE ("profileImageUrl") ON TABLE agricoop_app.users TO authenticated;
GRANT INSERT ("profileImageUrl") ON TABLE agricoop_app.users TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies (IF NOT EXISTS via DO blocks): avatars_public_read, avatars_owner_insert,
-- avatars_owner_update, avatars_owner_delete � path prefix = auth.uid()::text.
`

Verification (2026-11-17):
- `storage.buckets` contains `avatars` (public, 2 MB, jpeg/png/webp)
- Policies `avatars_%` present on `storage.objects`
- Column privileges: `authenticated` UPDATE/INSERT on `profileImageUrl`

## BLOCK 14: `20261117210000_payment_fulfillment_coop_orders.sql` (applied via MCP as `payment_fulfillment_coop_orders`)

**Preview (2026-11-17):** sellers with null coop = 0; products with null coop = 0.
Existing coop id=2 is named `Sutafaco (Sumilihon-Taguibo Cooperative` � left unchanged. Inserted exact name `SUTAFACO Cooperative` (normalizedName `sutafacocooperative`).

`sql
-- PURPOSE: listing pickup/delivery/online flags; orders.fulfillmentMethod;
-- seller QR columns; orderHistory + RLS; SUTAFACO Cooperative; seller-payment-qr bucket.
-- IDEMPOTENT / ADDITIVE ONLY. See supabase/migrations/20261117210000_payment_fulfillment_coop_orders.sql
`

Verification:
- `orderHistory` present; product flags default pickup+delivery true, online false
- `SUTAFACO Cooperative` row present; null coop backfill was no-op (0 rows)
- bucket `seller-payment-qr` private

## BLOCK 15: `20261117211000_payment_fulfillment_column_grants.sql` (applied via MCP as `payment_fulfillment_column_grants`)

New columns from BLOCK 14 did not inherit column-level marketplace GRANTs, which broke `marketplace.list`.

```sql
GRANT SELECT ("allowsPickup", "allowsDelivery", "acceptsOnlinePayment")
  ON TABLE agricoop_app.products TO anon, authenticated;
GRANT SELECT ("onlinePaymentQrPath", "onlinePaymentAccountName", "onlinePaymentAccountNumber", "onlinePaymentLabel")
  ON TABLE agricoop_app.users TO authenticated;
GRANT UPDATE ("onlinePaymentQrPath", "onlinePaymentAccountName", "onlinePaymentAccountNumber", "onlinePaymentLabel")
  ON TABLE agricoop_app.users TO authenticated;
GRANT SELECT ("onlinePaymentQrPath") ON TABLE agricoop_app.users TO anon;
GRANT SELECT ("fulfillmentMethod") ON TABLE agricoop_app.orders TO authenticated;
```

Verification (2026-11-17): `marketplace.list` returns 200 with `sellerHasOnlineQr` + listing flags.

Postflight (same migration file): `has_column_privilege` asserts anon/authenticated SELECT on product flags, authenticated SELECT/UPDATE on seller QR account columns, anon SELECT only on `onlinePaymentQrPath` (not account name/number/label), and authenticated SELECT on `orders.fulfillmentMethod`.

## BLOCK 16: `20261117220000_write_grants_and_profile_role_sync.sql` (applied via MCP as `write_grants_and_profile_role_sync`)

Root cause of listing create/update and payment-option create failures after BLOCK 14/15: new product flag columns and Drizzle serial/default columns lacked INSERT/UPDATE grants. Role sync failed because `public.profiles` has no authenticated UPDATE policy.

```sql
GRANT INSERT ("id", "createdAt", "allowsPickup", "allowsDelivery", "acceptsOnlinePayment")
  ON TABLE agricoop_app.products TO authenticated;
GRANT UPDATE ("allowsPickup", "allowsDelivery", "acceptsOnlinePayment")
  ON TABLE agricoop_app.products TO authenticated;
GRANT INSERT ("id", "createdAt") ON TABLE agricoop_app."productImages" TO authenticated;
GRANT INSERT ("id", "createdAt", "updatedAt") ON TABLE agricoop_app."paymentOptions" TO authenticated;
-- plus SECURITY DEFINER agricoop_app.sync_profile_role_from_app(text, text)
```

Verification (2026-11-17): authenticated INSERT/UPDATE on product flags; paymentOptions id INSERT; EXECUTE on sync_profile_role_from_app.

## BLOCK 17: `20261118022138_system_payment_admin_only.sql` (applied via MCP as `system_payment_admin_only`)

**Purpose:** Move online payment to Admin/SuperAdmin system settings. Additive only: seller `onlinePayment*` columns and the `seller-payment-qr` bucket are kept. Seller column grants and seller-owned storage policies are revoked.

```sql
-- PURPOSE: systemPaymentSettings, systemOnlinePaymentAccounts, systemPaymentSettingsAudit,
-- private system-payment-qr bucket, staff-only RLS, REVOKE seller payment column grants.
-- IDEMPOTENT / ADDITIVE ONLY. Does not DROP COLUMN.
-- Full script: supabase/migrations/20261118022138_system_payment_admin_only.sql

CREATE TABLE IF NOT EXISTS agricoop_app."systemPaymentSettings" (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  "cashPickupEnabled" boolean NOT NULL DEFAULT true,
  "cashDeliveryEnabled" boolean NOT NULL DEFAULT true,
  "onlineEnabled" boolean NOT NULL DEFAULT false,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "updatedBy" integer REFERENCES agricoop_app.users(id)
);

CREATE TABLE IF NOT EXISTS agricoop_app."systemOnlinePaymentAccounts" (
  id serial PRIMARY KEY,
  label varchar(150) NOT NULL,
  "accountName" varchar(150) NOT NULL,
  "accountNumber" varchar(100) NOT NULL,
  instructions text,
  "qrImagePath" text,
  "isActive" boolean NOT NULL DEFAULT false,
  "archivedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "createdBy" integer REFERENCES agricoop_app.users(id),
  "updatedBy" integer REFERENCES agricoop_app.users(id)
);

CREATE TABLE IF NOT EXISTS agricoop_app."systemPaymentSettingsAudit" (
  id bigserial PRIMARY KEY,
  "actorUserId" integer NOT NULL REFERENCES agricoop_app.users(id),
  "actorRole" text NOT NULL,
  action text NOT NULL,
  details jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- Staff RLS (agricoop_app.is_staff()) on all three tables.
-- Bucket system-payment-qr private, 5 MB, jpeg/png/webp. No client storage policies.

REVOKE SELECT ("onlinePaymentQrPath") ON TABLE agricoop_app.users FROM anon;
REVOKE SELECT (
  "onlinePaymentQrPath",
  "onlinePaymentAccountName",
  "onlinePaymentAccountNumber",
  "onlinePaymentLabel"
) ON TABLE agricoop_app.users FROM authenticated;
REVOKE UPDATE (
  "onlinePaymentQrPath",
  "onlinePaymentAccountName",
  "onlinePaymentAccountNumber",
  "onlinePaymentLabel"
) ON TABLE agricoop_app.users FROM authenticated;

DROP POLICY IF EXISTS seller_payment_qr_owner_insert ON storage.objects;
DROP POLICY IF EXISTS seller_payment_qr_owner_update ON storage.objects;
DROP POLICY IF EXISTS seller_payment_qr_owner_select ON storage.objects;
```

Verification: three `systemPayment*` tables present; bucket `system-payment-qr` private; seller online-payment column grants revoked; seller QR storage policies dropped; columns not dropped.

## BLOCK 18 — Login lookup must not select revoked seller payment columns

**Root cause (production login outage):** After BLOCK 17 revoked `authenticated`/`anon` SELECT on
`agricoop_app.users.onlinePaymentQrPath` (and related seller payment columns), the post-sign-in
application lookup (`getUserByVerifiedAuthId` → `loadAuthIdentityRecords`) still selected
`onlinePaymentQrPath` under `set_config('role','authenticated')`. Postgres raised `42501`, which
the app mapped to `application_database_access_denied` for every role.

**Fix:** Code-only — omit seller `onlinePayment*` columns from the login SELECT. Do **not** re-GRANT
those columns (sellers must still be unable to read seller payment data via the app DB role).

**Migration:** `supabase/migrations/20261118041000_login_lookup_no_payment_columns.sql` (notice-only guard; no privilege restore).

```sql
-- Informational guard only (no GRANT restore of payment columns)
DO $$
BEGIN
  IF has_column_privilege('authenticated', 'agricoop_app.users', 'onlinePaymentQrPath', 'SELECT')
     OR has_column_privilege('anon', 'agricoop_app.users', 'onlinePaymentQrPath', 'SELECT') THEN
    RAISE NOTICE 'BLOCK 18 note: onlinePaymentQrPath is still SELECT-able by authenticated/anon; keep seller payment data closed.';
  ELSE
    RAISE NOTICE 'BLOCK 18 ok: onlinePaymentQrPath remains revoked for authenticated/anon.';
  END IF;
END $$;
```

**Verification:** `has_column_privilege` remains false for payment columns; login SELECT columns (`openId`, `role`, `profileImageUrl`, …) remain true for `authenticated`; real login succeeds for Buyer/Seller/Admin/SuperAdmin.

## BLOCK 18b — Registration: create Auth user without blocking on SMTP

**Root cause (create-account failures):** Production/runtime logs showed `auth.register` hitting the Vercel 30s timeout while Supabase Auth `/signup` either:
1. completed slowly then left provisioning stranded on a broken preview alias without `DATABASE_URL`, or
2. returned `429 over_email_send_rate_limit` (email rate limit), which the app previously mapped to a generic “Unable to start registration” with no correlation ID.

**Fix (code):**
1. `auth.register` uses `supabaseAdmin.auth.admin.createUser({ email_confirm: false })`, provisions the application user + `public.profiles` row, then best-effort `auth.resend({ type: "signup" })`.
2. **Critical:** exclude `auth.register` / `auth.resendVerification` from the publicProcedure DB middleware so provisioning does not nest a second `withRequestDatabaseScope` under the anon scope (postgres `max: 1` deadlock → Vercel 30s timeout). Auth createUser succeeded in ~187ms while the function still timed out waiting on the nested DB transaction.
3. Correlation ID `(ref: reg_…)` on failure paths; rate-limited confirmation is deferred (not a hard fail).

**Dashboard (if emails stay deferred):** Supabase Auth → Rate Limits / SMTP — raise email send rate or configure custom SMTP. Env vars involved by name only: `APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

## BLOCK 19 — Registration upsert must omit revoked payment columns

**Root cause (after deadlock fix):** `upsertUser` used Drizzle `insert(users).values(...)`, which expands to every `agricoop_app.users` column (including `onlinePayment*` as `DEFAULT`). BLOCK 17 revoked authenticated INSERT/SELECT on those columns → Postgres `42501` during provisioning. Correlation showed the expanded INSERT in logs.

**Fix (code):**
1. `upsertUser` uses an explicit SQL column list:
   `openId, name, email, loginMethod, role, approvalStatus, cooperativeId, lastSignedIn` only.
2. `applyRequestDatabaseSettings` now runs `SET LOCAL ROLE authenticated|anon` after `set_config('role', ...)`. Column-level GRANTs only apply to the active role; without `SET LOCAL ROLE`, registration hit `permission denied for table users` while marketplace SELECTs still worked under the login role.

**Migration:** `supabase/migrations/20261118043000_registration_insert_column_contract.sql` (notice guard; no payment GRANT restore).

---

## BLOCK 20: `20261118120000_part2_registration_applications_order_archive.sql`

**Part 2 (A-D):** cooperative provenance, Cooperative Admin applications, private `coop-admin-applications` storage (object key `{auth_uid}/{uuid}.ext`), notification allowlist, `create_user_cooperative`. Additive only.

```sql
-- BLOCK 20: Part 2 — cooperative provenance, Cooperative Admin applications,
-- private application document bucket, notification allowlist, buyer order archive via threadStates.
-- Additive + idempotent. No DROP / TRUNCATE / unscoped DELETE.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Cooperatives: createdBy + source (user | staff | seed)
-- ---------------------------------------------------------------------------
ALTER TABLE agricoop_app.cooperatives
  ADD COLUMN IF NOT EXISTS "createdBy" integer REFERENCES agricoop_app.users(id);
ALTER TABLE agricoop_app.cooperatives
  ADD COLUMN IF NOT EXISTS source varchar(32) NOT NULL DEFAULT 'seed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cooperatives_source_check'
      AND conrelid = 'agricoop_app.cooperatives'::regclass
  ) THEN
    ALTER TABLE agricoop_app.cooperatives
      ADD CONSTRAINT cooperatives_source_check
      CHECK (source IN ('user', 'staff', 'seed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cooperatives_created_by_idx
  ON agricoop_app.cooperatives ("createdBy");

-- ---------------------------------------------------------------------------
-- 2) Users: requestedRole for Cooperative Admin applicants (never grants privilege alone)
-- ---------------------------------------------------------------------------
ALTER TABLE agricoop_app.users
  ADD COLUMN IF NOT EXISTS "requestedRole" agricoop_app.user_role;

-- ---------------------------------------------------------------------------
-- 3) Cooperative Admin applications
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regtype('agricoop_app.coop_admin_application_status') IS NULL THEN
    CREATE TYPE agricoop_app.coop_admin_application_status AS ENUM (
      'awaiting_documents',
      'pending',
      'approved',
      'rejected'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agricoop_app."cooperativeAdminApplications" (
  id serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES agricoop_app.users(id),
  "fullName" varchar(180) NOT NULL,
  "cooperativeId" integer NOT NULL REFERENCES agricoop_app.cooperatives(id),
  "positionTitle" varchar(180) NOT NULL DEFAULT '',
  "idDocumentPath" text,
  "proofDocumentPath" text,
  status agricoop_app.coop_admin_application_status NOT NULL DEFAULT 'awaiting_documents',
  "rejectionReason" text,
  "reviewedBy" integer REFERENCES agricoop_app.users(id),
  "reviewedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coop_admin_apps_user_idx
  ON agricoop_app."cooperativeAdminApplications" ("userId");
CREATE INDEX IF NOT EXISTS coop_admin_apps_status_idx
  ON agricoop_app."cooperativeAdminApplications" (status);
CREATE UNIQUE INDEX IF NOT EXISTS coop_admin_apps_one_open_per_user_uidx
  ON agricoop_app."cooperativeAdminApplications" ("userId")
  WHERE status IN ('awaiting_documents', 'pending');

ALTER TABLE agricoop_app."cooperativeAdminApplications" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE agricoop_app."cooperativeAdminApplications" FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, "userId", "fullName", "cooperativeId", "positionTitle",
  "idDocumentPath", "proofDocumentPath", status, "rejectionReason",
  "reviewedBy", "reviewedAt", "createdAt", "updatedAt"
) ON TABLE agricoop_app."cooperativeAdminApplications" TO authenticated;
GRANT INSERT (
  "userId", "fullName", "cooperativeId", "positionTitle",
  "idDocumentPath", "proofDocumentPath", status
) ON TABLE agricoop_app."cooperativeAdminApplications" TO authenticated;
GRANT UPDATE (
  "fullName", "cooperativeId", "positionTitle",
  "idDocumentPath", "proofDocumentPath", status, "rejectionReason",
  "reviewedBy", "reviewedAt", "updatedAt"
) ON TABLE agricoop_app."cooperativeAdminApplications" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE agricoop_app."cooperativeAdminApplications_id_seq" TO authenticated;

DROP POLICY IF EXISTS coop_admin_apps_select ON agricoop_app."cooperativeAdminApplications";
CREATE POLICY coop_admin_apps_select
  ON agricoop_app."cooperativeAdminApplications"
  FOR SELECT TO authenticated
  USING (
    "userId" = agricoop_app.current_app_user_id()
    OR agricoop_app.is_superadmin()
  );

DROP POLICY IF EXISTS coop_admin_apps_insert ON agricoop_app."cooperativeAdminApplications";
CREATE POLICY coop_admin_apps_insert
  ON agricoop_app."cooperativeAdminApplications"
  FOR INSERT TO authenticated
  WITH CHECK (
    "userId" = agricoop_app.current_app_user_id()
    AND status IN ('awaiting_documents', 'pending')
  );

DROP POLICY IF EXISTS coop_admin_apps_update_own ON agricoop_app."cooperativeAdminApplications";
CREATE POLICY coop_admin_apps_update_own
  ON agricoop_app."cooperativeAdminApplications"
  FOR UPDATE TO authenticated
  USING (
    ("userId" = agricoop_app.current_app_user_id() AND status IN ('awaiting_documents', 'rejected'))
    OR agricoop_app.is_superadmin()
  )
  WITH CHECK (
    ("userId" = agricoop_app.current_app_user_id() AND status IN ('awaiting_documents', 'pending', 'rejected'))
    OR agricoop_app.is_superadmin()
  );

-- Keep anon read-only. Authenticated may INSERT user/staff-proposed cooperatives under RLS
-- (public visitors never hold a JWT → no direct write).
REVOKE INSERT ON TABLE agricoop_app.cooperatives FROM anon;
GRANT SELECT ("createdBy", source) ON TABLE agricoop_app.cooperatives TO anon, authenticated;
GRANT INSERT (
  "name", "normalizedName", description, location, status, "createdBy", source
) ON TABLE agricoop_app.cooperatives TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE agricoop_app.cooperatives_id_seq TO authenticated;

DROP POLICY IF EXISTS cooperatives_authenticated_insert ON agricoop_app.cooperatives;
CREATE POLICY cooperatives_authenticated_insert
  ON agricoop_app.cooperatives
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      source = 'user'
      AND "createdBy" = agricoop_app.current_app_user_id()
    )
    OR (
      source = 'staff'
      AND agricoop_app.is_superadmin()
    )
  );

-- SECURITY DEFINER helper so registration can create user-proposed cooperatives
-- after the applicant user row exists (sets createdBy from current_app_user_id).
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
DECLARE
  actor_id integer := agricoop_app.current_app_user_id();
  new_id integer;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Cooperative creation requires an authenticated application user';
  END IF;
  INSERT INTO agricoop_app.cooperatives (
    name, "normalizedName", location, description, status, source, "createdBy"
  ) VALUES (
    p_name, p_normalized_name, p_location, p_description, 'active', 'user', actor_id
  )
  ON CONFLICT ("normalizedName") DO UPDATE
    SET name = agricoop_app.cooperatives.name
  RETURNING id INTO new_id;
  RETURN new_id;
END
$fn$;

REVOKE ALL ON FUNCTION agricoop_app.create_user_cooperative(varchar, varchar, varchar, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION agricoop_app.create_user_cooperative(varchar, varchar, varchar, text)
  TO authenticated;

-- requestedRole column grants for authenticated self-read + registration insert
GRANT SELECT ("requestedRole") ON TABLE agricoop_app.users TO authenticated;
GRANT INSERT ("requestedRole") ON TABLE agricoop_app.users TO authenticated;
GRANT UPDATE ("requestedRole") ON TABLE agricoop_app.users TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Private storage bucket for application documents
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'coop-admin-applications',
  'coop-admin-applications',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'coop_admin_apps_owner_insert'
  ) THEN
    CREATE POLICY coop_admin_apps_owner_insert
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'coop-admin-applications'
        AND split_part(name, '/', 1) = (SELECT auth.uid()::text)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'coop_admin_apps_owner_update'
  ) THEN
    CREATE POLICY coop_admin_apps_owner_update
      ON storage.objects FOR UPDATE TO authenticated
      USING (
        bucket_id = 'coop-admin-applications'
        AND split_part(name, '/', 1) = (SELECT auth.uid()::text)
      )
      WITH CHECK (
        bucket_id = 'coop-admin-applications'
        AND split_part(name, '/', 1) = (SELECT auth.uid()::text)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'coop_admin_apps_owner_select'
  ) THEN
    CREATE POLICY coop_admin_apps_owner_select
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'coop-admin-applications'
        AND split_part(name, '/', 1) = (SELECT auth.uid()::text)
      );
  END IF;
END $$;

-- SuperAdmin storage reads go through service-role signed URLs after server authz
-- (no Officer Admin / buyer / seller read policy on this bucket).

-- ---------------------------------------------------------------------------
-- 5) Notification allowlist: Cooperative Admin application events
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION agricoop_app.create_notification(
  p_user_id integer,
  p_type varchar,
  p_title varchar,
  p_content text,
  p_link varchar DEFAULT NULL,
  p_related_entity_id integer DEFAULT NULL,
  p_related_entity_type varchar DEFAULT NULL
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
  allowed boolean := false;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Notification write requires an authenticated application user';
  END IF;
  IF p_user_id IS NULL OR p_type IS NULL OR p_title IS NULL OR p_content IS NULL THEN
    RAISE EXCEPTION 'Notification payload is incomplete';
  END IF;
  IF length(p_type) > 50 OR length(p_title) > 255 THEN
    RAISE EXCEPTION 'Notification fields exceed allowed length';
  END IF;

  IF p_type NOT IN (
    'profile_verification_submitted',
    'profile_verification_approved',
    'profile_verification_rejected',
    'payment_proof_submitted',
    'payment_proof_verified',
    'payment_proof_rejected',
    'cash_payment_received',
    'cooperative_association_request',
    'cooperative_association_approved',
    'cooperative_association_rejected',
    'cooperative_admin_application_submitted',
    'cooperative_admin_application_approved',
    'cooperative_admin_application_rejected',
    'account_approval_status',
    'account_access_updated',
    'product_approved',
    'product_rejected',
    'support_ticket_created',
    'support_ticket_assigned',
    'support_ticket_reply',
    'support_ticket_status',
    'order_status_updated',
    'quotation_updated',
    'new_message'
  ) THEN
    RAISE EXCEPTION 'Notification type is not permitted';
  END IF;

  IF p_type LIKE 'profile_verification_%' THEN
    allowed := (
      (p_type = 'profile_verification_submitted' AND p_user_id = actor_id)
      OR (p_type IN ('profile_verification_approved', 'profile_verification_rejected') AND actor_role IN ('admin', 'superadmin'))
    );
  ELSIF p_type LIKE 'payment_proof_%' OR p_type = 'cash_payment_received' THEN
    allowed := EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = p_related_entity_id
        AND o."buyerId" = p_user_id
        AND (
          o."buyerId" = actor_id
          OR o."sellerId" = actor_id
          OR agricoop_app.shares_cooperative(o."cooperativeId")
          OR agricoop_app.is_superadmin()
        )
    );
  ELSIF p_type LIKE 'cooperative_association_%' THEN
    allowed := (
      (p_type = 'cooperative_association_request' AND actor_role = 'seller' AND EXISTS (
        SELECT 1 FROM agricoop_app."cooperativeAssociationRequests" r
        WHERE r.id = p_related_entity_id AND r."sellerId" = actor_id AND p_user_id <> actor_id
      ))
      OR (p_type IN ('cooperative_association_approved', 'cooperative_association_rejected')
          AND actor_role IN ('admin', 'superadmin')
          AND EXISTS (
            SELECT 1 FROM agricoop_app."cooperativeAssociationRequests" r
            WHERE r.id = p_related_entity_id AND r."sellerId" = p_user_id
              AND (agricoop_app.shares_cooperative(r."cooperativeId") OR agricoop_app.is_superadmin())
          ))
    );
  ELSIF p_type LIKE 'cooperative_admin_application_%' THEN
    allowed := (
      (p_type = 'cooperative_admin_application_submitted'
        AND EXISTS (
          SELECT 1 FROM agricoop_app."cooperativeAdminApplications" a
          WHERE a.id = p_related_entity_id AND a."userId" = actor_id
        )
        AND (
          p_user_id = actor_id
          OR EXISTS (
            SELECT 1 FROM agricoop_app.users u
            WHERE u.id = p_user_id AND u.role = 'superadmin' AND u."approvalStatus" = 'approved'
          )
        ))
      OR (p_type IN ('cooperative_admin_application_approved', 'cooperative_admin_application_rejected')
          AND actor_role = 'superadmin'
          AND EXISTS (
            SELECT 1 FROM agricoop_app."cooperativeAdminApplications" a
            WHERE a.id = p_related_entity_id AND a."userId" = p_user_id
          ))
    );
  ELSIF p_type IN ('account_approval_status', 'account_access_updated') THEN
    allowed := actor_role IN ('admin', 'superadmin') AND p_user_id <> actor_id;
  ELSIF p_type IN ('product_approved', 'product_rejected') THEN
    allowed := actor_role IN ('admin', 'superadmin') AND EXISTS (
      SELECT 1 FROM agricoop_app.products p
      WHERE p.id = p_related_entity_id AND p."sellerId" = p_user_id
        AND (agricoop_app.shares_cooperative(p."cooperativeId") OR agricoop_app.is_superadmin())
    );
  ELSIF p_type LIKE 'support_ticket_%' THEN
    allowed := EXISTS (
      SELECT 1 FROM agricoop_app."supportTickets" t
      WHERE (p_related_entity_id IS NULL OR t.id = p_related_entity_id)
        AND (
          (p_type = 'support_ticket_created' AND t."userId" = actor_id)
          OR actor_role IN ('admin', 'superadmin')
          OR t."userId" = actor_id
        )
    ) OR (p_type = 'support_ticket_created' AND p_user_id <> actor_id AND actor_id IS NOT NULL);
  ELSIF p_type IN ('order_status_updated', 'quotation_updated', 'new_message') THEN
    allowed := actor_id IS NOT NULL;
  ELSE
    allowed := false;
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Notification relationship check failed for type %', p_type;
  END IF;

  INSERT INTO agricoop_app.notifications (
    "userId", type, title, content, link, "relatedEntityId", "relatedEntityType"
  ) VALUES (
    p_user_id, p_type, p_title, p_content, p_link, p_related_entity_id, p_related_entity_type
  ) RETURNING id INTO new_id;

  RETURN new_id;
END
$fn$;

REVOKE ALL ON FUNCTION agricoop_app.create_notification(integer, varchar, varchar, text, varchar, integer, varchar)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION agricoop_app.create_notification(integer, varchar, varchar, text, varchar, integer, varchar)
  TO authenticated;

COMMIT;
```

---

## BLOCK 24: `20261118141000_registration_coop_assign_guard_fallthrough.sql`

**Bug:** BLOCK 23 used `NULL;` inside the allow branch; PL/pgSQL still continued to `RAISE`, so GUC-gated assignment still returned `P0001`. Replace with `IF NOT (allow…) THEN RAISE`.

(See migration file for full function body.)

---

## BLOCK 23: `20261118140000_registration_cooperative_assign_guard.sql`

**Production blocker (A):** buyer/seller registration linked an existing cooperative via `UPDATE users.cooperativeId` after insert. Trigger `guard_users_protected_columns` rejected self-updates (`P0001`). RLS `agricoop_auth_users_self_insert` also requires `cooperativeId IS NULL` on INSERT, so assignment must be a post-insert UPDATE. Registration sets session GUC `agricoop.allow_registration_coop_assign=1` and the guard allows only NULL → value under that GUC.

```sql
-- PURPOSE: One-time registration cooperative assignment under GUC.
-- ADDITIVE ONLY (CREATE OR REPLACE function body).

CREATE OR REPLACE FUNCTION agricoop_app.guard_users_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  actor_id integer := agricoop_app.current_app_user_id();
  actor_role text := agricoop_app.current_app_role();
  allow_reg_coop text := nullif(current_setting('agricoop.allow_registration_coop_assign', true), '');
BEGIN
  IF NEW."role" IS DISTINCT FROM OLD."role"
     OR NEW."approvalStatus" IS DISTINCT FROM OLD."approvalStatus"
     OR NEW."cooperativeId" IS DISTINCT FROM OLD."cooperativeId"
     OR NEW."verificationStatus" IS DISTINCT FROM OLD."verificationStatus"
     OR NEW."verifiedBy" IS DISTINCT FROM OLD."verifiedBy"
     OR NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt" THEN
    IF actor_id IS NULL THEN
      RAISE EXCEPTION 'Protected user fields require an authenticated application user';
    END IF;

    IF actor_id = OLD.id THEN
      IF NEW."role" IS DISTINCT FROM OLD."role"
         OR NEW."approvalStatus" IS DISTINCT FROM OLD."approvalStatus" THEN
        RAISE EXCEPTION 'Users cannot change their own role, approval status, or cooperative';
      END IF;
      IF NEW."cooperativeId" IS DISTINCT FROM OLD."cooperativeId" THEN
        IF NOT (
          allow_reg_coop = '1'
          AND OLD."cooperativeId" IS NULL
          AND NEW."cooperativeId" IS NOT NULL
          AND NEW."role" IS NOT DISTINCT FROM OLD."role"
          AND NEW."approvalStatus" IS NOT DISTINCT FROM OLD."approvalStatus"
        ) THEN
          RAISE EXCEPTION 'Users cannot change their own role, approval status, or cooperative';
        END IF;
      END IF;
    ELSIF actor_role NOT IN ('admin', 'superadmin') THEN
      RAISE EXCEPTION 'Only Admin or SuperAdmin can change protected user fields';
    ELSIF actor_role = 'admin'
          AND (
            OLD."cooperativeId" IS DISTINCT FROM agricoop_app.current_app_cooperative_id()
            OR NEW."cooperativeId" IS DISTINCT FROM agricoop_app.current_app_cooperative_id()
            OR NEW."role" = 'superadmin'
            OR OLD."role" = 'superadmin'
          ) THEN
      RAISE EXCEPTION 'Admin cannot change users outside their cooperative or promote SuperAdmin';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
```

---

## BLOCK 22: `20261118130000_part2_insert_grants_apps_and_products.sql`

**Production blockers (A/E):** registration `cooperativeAdminApplications` inserts must stay column-scoped; Drizzle product inserts need `updatedAt` INSERT when ORM lists DEFAULT columns.

```sql
-- PURPOSE: Align INSERT grants with explicit SQL in registration and products.create.
-- ADDITIVE ONLY.

BEGIN;

GRANT INSERT (
  "userId", "fullName", "cooperativeId", "positionTitle",
  "idDocumentPath", "proofDocumentPath", status
) ON TABLE agricoop_app."cooperativeAdminApplications" TO authenticated;

GRANT INSERT ("updatedAt") ON TABLE agricoop_app.products TO authenticated;

COMMIT;

DO $postflight$
BEGIN
  IF NOT has_column_privilege(
        'authenticated',
        'agricoop_app."cooperativeAdminApplications"',
        'userId',
        'INSERT'
     )
     OR NOT has_column_privilege('authenticated', 'agricoop_app.products', 'updatedAt', 'INSERT')
  THEN
    RAISE EXCEPTION 'part2_insert_grants_apps_and_products postflight failed';
  END IF;
END
$postflight$;
```

---

## BLOCK 21: `20261118121000_buyer_order_archive_channel.sql`

**Part 2 (C):** extends `threadStates.channel` check to include `order` for per-buyer archive.

```sql
-- PURPOSE: Allow per-buyer order archive state via threadStates.channel = 'order'.
-- ADDITIVE ONLY. Does not alter orders rows or seller/admin views.

BEGIN;

ALTER TABLE agricoop_app."threadStates"
  DROP CONSTRAINT IF EXISTS thread_states_channel_check;

ALTER TABLE agricoop_app."threadStates"
  ADD CONSTRAINT thread_states_channel_check
  CHECK (channel IN ('conversation', 'ticket', 'support', 'order'));

COMMIT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'thread_states_channel_check'
      AND conrelid = 'agricoop_app."threadStates"'::regclass
  ) THEN
    RAISE EXCEPTION 'thread_states_channel_check missing after buyer order archive migration';
  END IF;
END $$;
```
