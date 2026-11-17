-- Additive: anon marketplace browse grants + reserved-qty helper + browse indexes.
-- Idempotent. No DROP / TRUNCATE / data mutation.

BEGIN;

-- RLS policies for products/cooperatives call these helpers for every row check.
GRANT EXECUTE ON FUNCTION agricoop_app.shares_cooperative(integer) TO anon;
GRANT EXECUTE ON FUNCTION agricoop_app.is_superadmin() TO anon;
GRANT EXECUTE ON FUNCTION agricoop_app.is_staff() TO anon;

-- Public seller display fields for marketplace joins
GRANT SELECT ("id", "name", "approvalStatus", "role") ON TABLE agricoop_app.users TO anon;

-- SECURITY DEFINER aggregate so anon browse can subtract open-order reservations
-- without SELECT on orders / orderItems.
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

DO $postflight$
BEGIN
  IF NOT has_function_privilege('anon', 'agricoop_app.shares_cooperative(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon missing EXECUTE on shares_cooperative';
  END IF;
  IF NOT has_function_privilege('anon', 'agricoop_app.reserved_quantities_for_products(integer[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon missing EXECUTE on reserved_quantities_for_products';
  END IF;
  IF to_regclass('agricoop_app.products_marketplace_browse_idx') IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_indexes
       WHERE schemaname = 'agricoop_app' AND indexname = 'products_marketplace_browse_idx'
     ) THEN
    RAISE EXCEPTION 'products_marketplace_browse_idx missing';
  END IF;
END
$postflight$;

COMMIT;
