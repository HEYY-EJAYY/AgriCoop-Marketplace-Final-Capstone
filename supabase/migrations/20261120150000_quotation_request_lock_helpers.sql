-- quotations.request performs internal SELECT ... FOR UPDATE reads on products
-- and users (sellers). Under the request-scoped RLS role a buyer cannot take
-- UPDATE locks on rows owned by other users, so FOR UPDATE silently filters
-- every row out and quotation requests always fail with
-- "The selected product is not currently listed."
--
-- These SECURITY DEFINER helpers restore the intended row locks for the
-- quotation request critical section. Each requires the transaction-local
-- marker agricoop.quotation_request_scope = 'on', which only server-side
-- quotation requests set, so the helpers cannot be used to bypass RLS from
-- any other code path. Purchase eligibility is still enforced in application
-- code via productPurchaseBlockReason after the locked read.

CREATE OR REPLACE FUNCTION agricoop_app.quotation_request_lock_product(p_id integer)
RETURNS SETOF agricoop_app.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF current_setting('agricoop.quotation_request_scope', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'quotation request lock scope required';
  END IF;
  RETURN QUERY
    SELECT p.*
    FROM agricoop_app.products p
    WHERE p.id = p_id
    FOR UPDATE;
END;
$fn$;

CREATE OR REPLACE FUNCTION agricoop_app.quotation_request_lock_seller(p_id integer)
RETURNS TABLE("id" integer, "approvalStatus" agricoop_app.user_approval_status, "deletedAt" timestamp)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF current_setting('agricoop.quotation_request_scope', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'quotation request lock scope required';
  END IF;
  RETURN QUERY
    SELECT u.id, u."approvalStatus", u."deletedAt"
    FROM agricoop_app.users u
    WHERE u.id = p_id
    FOR UPDATE;
END;
$fn$;

REVOKE ALL ON FUNCTION agricoop_app.quotation_request_lock_product(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION agricoop_app.quotation_request_lock_seller(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION agricoop_app.quotation_request_lock_product(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION agricoop_app.quotation_request_lock_seller(integer) TO authenticated;
