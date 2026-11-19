-- Permit the marketplace's seller soft-delete filter without exposing deleted sellers.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('agricoop_app.users') IS NULL
     OR (SELECT relrowsecurity FROM pg_class WHERE oid = 'agricoop_app.users'::regclass) IS DISTINCT FROM true
     OR (
       SELECT count(*)
       FROM information_schema.columns
       WHERE table_schema = 'agricoop_app'
         AND table_name = 'users'
         AND column_name IN (
           'id', 'name', 'role', 'approvalStatus', 'deletedAt', 'email', 'phone',
           'address', 'contactNumber', 'onlinePaymentQrPath'
         )
     ) <> 10 THEN
    RAISE EXCEPTION 'Anonymous seller visibility precondition failed: expected users RLS and the public/private user columns';
  END IF;
END;
$preflight$;

GRANT SELECT ("deletedAt") ON TABLE agricoop_app.users TO anon;

DROP POLICY IF EXISTS agricoop_mkt_users_anon_public_seller
  ON agricoop_app.users;
CREATE POLICY agricoop_mkt_users_anon_public_seller
  ON agricoop_app.users FOR SELECT TO anon
  USING (
    "approvalStatus" = 'approved'
    AND "role" IN ('seller', 'admin', 'superadmin')
    AND "deletedAt" IS NULL
  );

DO $postflight$
BEGIN
  IF NOT has_column_privilege(
       'anon',
       'agricoop_app.users',
       'deletedAt',
       'SELECT'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy
       WHERE polrelid = 'agricoop_app.users'::regclass
         AND polname = 'agricoop_mkt_users_anon_public_seller'
         AND pg_get_expr(polqual, polrelid) LIKE '%"deletedAt" IS NULL%'
     )
     OR has_table_privilege('anon', 'agricoop_app.users', 'SELECT')
     OR NOT has_column_privilege('anon', 'agricoop_app.users', 'id', 'SELECT')
     OR NOT has_column_privilege('anon', 'agricoop_app.users', 'name', 'SELECT')
     OR NOT has_column_privilege('anon', 'agricoop_app.users', 'role', 'SELECT')
     OR NOT has_column_privilege('anon', 'agricoop_app.users', 'approvalStatus', 'SELECT')
     OR has_column_privilege('anon', 'agricoop_app.users', 'email', 'SELECT')
     OR has_column_privilege('anon', 'agricoop_app.users', 'phone', 'SELECT')
     OR has_column_privilege('anon', 'agricoop_app.users', 'address', 'SELECT')
     OR has_column_privilege('anon', 'agricoop_app.users', 'contactNumber', 'SELECT')
     OR has_column_privilege('anon', 'agricoop_app.users', 'onlinePaymentQrPath', 'SELECT') THEN
    RAISE EXCEPTION 'Anonymous marketplace seller soft-delete access verification failed';
  END IF;
END
$postflight$;

COMMIT;
