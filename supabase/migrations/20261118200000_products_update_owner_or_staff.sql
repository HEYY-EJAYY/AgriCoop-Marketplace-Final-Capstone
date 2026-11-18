-- BLOCK 30: Tighten products UPDATE so same-coop sellers/buyers cannot mutate others' listings.
-- Owner, SuperAdmin, or Admin (with shares_cooperative) only.

DROP POLICY IF EXISTS agricoop_mkt_products_seller_update ON agricoop_app.products;
CREATE POLICY agricoop_mkt_products_seller_update ON agricoop_app.products
  FOR UPDATE TO authenticated
  USING (
    ("sellerId" = agricoop_app.current_app_user_id())
    OR agricoop_app.is_superadmin()
    OR (
      agricoop_app.current_app_role() = 'admin'
      AND agricoop_app.shares_cooperative("cooperativeId")
    )
  )
  WITH CHECK (
    ("sellerId" = agricoop_app.current_app_user_id())
    OR agricoop_app.is_superadmin()
    OR (
      agricoop_app.current_app_role() = 'admin'
      AND agricoop_app.shares_cooperative("cooperativeId")
    )
  );
