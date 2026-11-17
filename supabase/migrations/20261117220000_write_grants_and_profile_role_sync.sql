-- BLOCK 16: restore write privileges for payment/fulfillment columns and serial defaults;
-- add SECURITY DEFINER profile-role sync (public.profiles has no UPDATE policy for officers).

-- Products: new buyer flags need INSERT/UPDATE; serial/default columns appear in Drizzle INSERT lists.
GRANT INSERT (
  "id",
  "createdAt",
  "allowsPickup",
  "allowsDelivery",
  "acceptsOnlinePayment"
) ON TABLE agricoop_app.products TO authenticated;

GRANT UPDATE (
  "allowsPickup",
  "allowsDelivery",
  "acceptsOnlinePayment"
) ON TABLE agricoop_app.products TO authenticated;

-- productImages serial/default columns
GRANT INSERT ("id", "createdAt") ON TABLE agricoop_app."productImages" TO authenticated;

-- paymentOptions serial/default columns used by Drizzle insert/update
GRANT INSERT ("id", "createdAt", "updatedAt") ON TABLE agricoop_app."paymentOptions" TO authenticated;

-- Canonical profile role sync for admin role changes (bypasses public.profiles RLS safely).
CREATE OR REPLACE FUNCTION agricoop_app.sync_profile_role_from_app(
  p_auth_user_id text,
  p_app_role text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, agricoop_app
AS $fn$
DECLARE
  v_role_name text;
  v_role_id integer;
  v_updated integer;
BEGIN
  IF p_auth_user_id IS NULL OR length(trim(p_auth_user_id)) = 0 THEN
    RAISE EXCEPTION 'auth user id is required';
  END IF;

  v_role_name := CASE p_app_role
    WHEN 'buyer' THEN 'buyer'
    WHEN 'seller' THEN 'seller'
    WHEN 'admin' THEN 'coop_officer'
    WHEN 'superadmin' THEN 'system_admin'
    ELSE NULL
  END;

  IF v_role_name IS NULL THEN
    RAISE EXCEPTION 'unsupported application role: %', p_app_role;
  END IF;

  SELECT r.role_id INTO v_role_id
  FROM public.roles r
  WHERE r.role_name = v_role_name
  LIMIT 1;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'canonical public role "%" is missing', v_role_name;
  END IF;

  UPDATE public.profiles p
  SET role_id = v_role_id
  WHERE p.user_id::text = p_auth_user_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'canonical profile row is missing for this Auth identity';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION agricoop_app.sync_profile_role_from_app(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agricoop_app.sync_profile_role_from_app(text, text) TO authenticated;

DO $postflight$
BEGIN
  IF NOT has_column_privilege('authenticated', 'agricoop_app.products', 'allowsPickup', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.products', 'allowsPickup', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.products', 'allowsDelivery', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.products', 'allowsDelivery', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.products', 'acceptsOnlinePayment', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.products', 'acceptsOnlinePayment', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.products', 'id', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app."paymentOptions"', 'id', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app."paymentOptions"', 'createdAt', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app."productImages"', 'id', 'INSERT')
     OR to_regprocedure('agricoop_app.sync_profile_role_from_app(text, text)') IS NULL
  THEN
    RAISE EXCEPTION 'write_grants_and_profile_role_sync postflight failed';
  END IF;
END
$postflight$;
