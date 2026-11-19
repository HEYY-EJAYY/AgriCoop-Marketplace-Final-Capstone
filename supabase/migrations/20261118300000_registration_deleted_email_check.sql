-- Registration runs before a Supabase Auth user exists, so the deleted-account
-- check executes under the `anon` request role which cannot SELECT
-- agricoop_app.users. This SECURITY DEFINER helper exposes only a boolean for
-- the exact email being registered; it reveals nothing beyond the
-- already-public "contact admin" registration denial.
CREATE OR REPLACE FUNCTION agricoop_app.email_has_deleted_user(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM agricoop_app.users AS u
    WHERE u.email IS NOT NULL
      AND lower(u.email) = lower(p_email)
      AND u."deletedAt" IS NOT NULL
  )
$fn$;

REVOKE ALL ON FUNCTION agricoop_app.email_has_deleted_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agricoop_app.email_has_deleted_user(text) TO anon, authenticated;
