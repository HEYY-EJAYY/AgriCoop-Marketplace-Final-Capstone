-- BLOCK 28: Persistent buyer cart items (additive, RLS).
-- Marketplace "Your order", cart badge, and checkout share this table.

CREATE TABLE IF NOT EXISTS agricoop_app."cartItems" (
  id serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES agricoop_app.users(id),
  "productId" integer NOT NULL REFERENCES agricoop_app.products(id),
  quantity integer NOT NULL,
  "createdAt" timestamp without time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT cart_items_quantity_positive CHECK (quantity > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS cart_items_user_product_uidx
  ON agricoop_app."cartItems" ("userId", "productId");

CREATE INDEX IF NOT EXISTS cart_items_user_id_idx
  ON agricoop_app."cartItems" ("userId");

ALTER TABLE agricoop_app."cartItems" ENABLE ROW LEVEL SECURITY;

GRANT SELECT ("id", "userId", "productId", quantity, "createdAt", "updatedAt")
  ON TABLE agricoop_app."cartItems" TO authenticated;
GRANT INSERT ("userId", "productId", quantity, "createdAt", "updatedAt")
  ON TABLE agricoop_app."cartItems" TO authenticated;
GRANT UPDATE (quantity, "updatedAt")
  ON TABLE agricoop_app."cartItems" TO authenticated;
GRANT DELETE ON TABLE agricoop_app."cartItems" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE agricoop_app."cartItems_id_seq" TO authenticated;

DROP POLICY IF EXISTS agricoop_cart_items_owner_select ON agricoop_app."cartItems";
CREATE POLICY agricoop_cart_items_owner_select ON agricoop_app."cartItems"
  FOR SELECT TO authenticated
  USING ("userId" = agricoop_app.current_app_user_id());

DROP POLICY IF EXISTS agricoop_cart_items_owner_insert ON agricoop_app."cartItems";
CREATE POLICY agricoop_cart_items_owner_insert ON agricoop_app."cartItems"
  FOR INSERT TO authenticated
  WITH CHECK ("userId" = agricoop_app.current_app_user_id());

DROP POLICY IF EXISTS agricoop_cart_items_owner_update ON agricoop_app."cartItems";
CREATE POLICY agricoop_cart_items_owner_update ON agricoop_app."cartItems"
  FOR UPDATE TO authenticated
  USING ("userId" = agricoop_app.current_app_user_id())
  WITH CHECK ("userId" = agricoop_app.current_app_user_id());

DROP POLICY IF EXISTS agricoop_cart_items_owner_delete ON agricoop_app."cartItems";
CREATE POLICY agricoop_cart_items_owner_delete ON agricoop_app."cartItems"
  FOR DELETE TO authenticated
  USING ("userId" = agricoop_app.current_app_user_id());
