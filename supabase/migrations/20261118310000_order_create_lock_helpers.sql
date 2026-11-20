-- orders.create performs internal SELECT ... FOR UPDATE reads on products, users
-- (sellers), paymentOptions, and quotations. Under the request-scoped RLS role
-- (SET LOCAL ROLE authenticated) a buyer cannot take UPDATE locks on rows owned by
-- other users, so FOR UPDATE silently filters every row out and order placement
-- always fails with "A product in this order could not be found."
--
-- These SECURITY DEFINER helpers restore the intended row locks for the order
-- creation critical section. Each requires the transaction-local marker
-- agricoop.order_create_scope = 'on', which only server-side order creation sets,
-- so the helpers cannot be used to bypass RLS from any other code path.

CREATE OR REPLACE FUNCTION agricoop_app.order_create_lock_products(p_ids integer[])
RETURNS SETOF agricoop_app.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF current_setting('agricoop.order_create_scope', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'order create lock scope required';
  END IF;
  RETURN QUERY
    SELECT p.*
    FROM agricoop_app.products p
    WHERE p.id = ANY(p_ids)
    ORDER BY p.id
    FOR UPDATE;
END;
$fn$;

CREATE OR REPLACE FUNCTION agricoop_app.order_create_lock_sellers(p_ids integer[])
RETURNS TABLE("id" integer, "approvalStatus" agricoop_app.user_approval_status, "deletedAt" timestamp)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF current_setting('agricoop.order_create_scope', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'order create lock scope required';
  END IF;
  RETURN QUERY
    SELECT u.id, u."approvalStatus", u."deletedAt"
    FROM agricoop_app.users u
    WHERE u.id = ANY(p_ids)
    ORDER BY u.id
    FOR UPDATE;
END;
$fn$;

CREATE OR REPLACE FUNCTION agricoop_app.order_create_lock_payment_option(p_id integer)
RETURNS TABLE("id" integer, "cooperativeId" integer, "paymentMethod" text, "isActive" boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF current_setting('agricoop.order_create_scope', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'order create lock scope required';
  END IF;
  RETURN QUERY
    SELECT o.id, o."cooperativeId", o."paymentMethod"::text, o."isActive"
    FROM agricoop_app."paymentOptions" o
    WHERE o.id = p_id
    FOR UPDATE;
END;
$fn$;

CREATE OR REPLACE FUNCTION agricoop_app.order_create_lock_quotation(p_id integer)
RETURNS SETOF agricoop_app.quotations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF current_setting('agricoop.order_create_scope', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'order create lock scope required';
  END IF;
  RETURN QUERY
    SELECT q.*
    FROM agricoop_app.quotations q
    WHERE q.id = p_id
    FOR UPDATE;
END;
$fn$;

REVOKE ALL ON FUNCTION agricoop_app.order_create_lock_products(integer[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION agricoop_app.order_create_lock_sellers(integer[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION agricoop_app.order_create_lock_payment_option(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION agricoop_app.order_create_lock_quotation(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION agricoop_app.order_create_lock_products(integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION agricoop_app.order_create_lock_sellers(integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION agricoop_app.order_create_lock_payment_option(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION agricoop_app.order_create_lock_quotation(integer) TO authenticated;
