-- Restrict legacy public-schema writes and inventory reads to visible products.
-- No application rows are changed.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.activity_logs') IS NULL
     OR to_regclass('public.inventory') IS NULL
     OR to_regclass('public.products') IS NULL
     OR to_regprocedure('public.get_my_role()') IS NULL
     OR (
       SELECT count(*)
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'activity_logs'
         AND column_name IN ('log_id', 'user_id', 'action_performed', 'log_date')
     ) <> 4
     OR (
       SELECT count(*)
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'products'
         AND column_name IN ('product_id', 'seller_id', 'status')
     ) <> 3
     OR (
       SELECT count(*)
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'inventory'
         AND column_name IN ('product_id', 'stock_quantity')
     ) <> 2
     OR NOT (
       SELECT relrowsecurity
       FROM pg_class
       WHERE oid = 'public.activity_logs'::regclass
     )
     OR NOT (
       SELECT relrowsecurity
       FROM pg_class
       WHERE oid = 'public.inventory'::regclass
     )
     OR NOT (
       SELECT relrowsecurity
       FROM pg_class
       WHERE oid = 'public.products'::regclass
     ) THEN
    RAISE EXCEPTION
      'Legacy public RLS hardening stopped: expected activity_logs, inventory, products, and RLS';
  END IF;
END;
$preflight$;

REVOKE INSERT ON TABLE public.activity_logs
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT (log_id, user_id, action_performed, log_date)
  ON TABLE public.activity_logs
  FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "system inserts logs" ON public.activity_logs;

DROP POLICY IF EXISTS "view inventory" ON public.inventory;
DROP POLICY IF EXISTS "view marketplace inventory" ON public.inventory;
CREATE POLICY "view marketplace inventory"
  ON public.inventory FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.products AS product
      WHERE product.product_id = inventory.product_id
        AND (
          product.status = 'active'
          OR product.seller_id = auth.uid()
          OR public.get_my_role() = ANY (
            ARRAY['coop_officer'::text, 'system_admin'::text]
          )
        )
    )
  );

DO $postflight$
BEGIN
  IF has_table_privilege('anon', 'public.activity_logs', 'INSERT')
     OR has_table_privilege('authenticated', 'public.activity_logs', 'INSERT')
     OR has_column_privilege('anon', 'public.activity_logs', 'action_performed', 'INSERT')
     OR has_column_privilege('authenticated', 'public.activity_logs', 'action_performed', 'INSERT')
     OR EXISTS (
       SELECT 1
       FROM pg_policy
       WHERE polrelid = 'public.activity_logs'::regclass
         AND polcmd IN ('a', '*')
     )
     OR EXISTS (
       SELECT 1
       FROM pg_policy
       WHERE polrelid = 'public.inventory'::regclass
         AND polcmd IN ('r', '*')
         AND polpermissive
         AND polname <> 'view marketplace inventory'
         AND NOT (
           polname = 'sellers/officers manage inventory'
           AND position('products.seller_id' IN pg_get_expr(polqual, polrelid)) > 0
           AND position('auth.uid()' IN pg_get_expr(polqual, polrelid)) > 0
           AND position('get_my_role()' IN pg_get_expr(polqual, polrelid)) > 0
         )
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy
       WHERE polrelid = 'public.inventory'::regclass
         AND polname = 'view marketplace inventory'
         AND position('product.status' IN pg_get_expr(polqual, polrelid)) > 0
         AND position('active' IN pg_get_expr(polqual, polrelid)) > 0
         AND position('product.seller_id' IN pg_get_expr(polqual, polrelid)) > 0
         AND position('auth.uid()' IN pg_get_expr(polqual, polrelid)) > 0
     ) THEN
    RAISE EXCEPTION 'Legacy public RLS hardening verification failed';
  END IF;
END;
$postflight$;

COMMIT;
