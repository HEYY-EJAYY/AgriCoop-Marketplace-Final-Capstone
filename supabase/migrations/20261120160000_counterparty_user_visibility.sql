-- Marketplace counterparties must see each other's basic profile for
-- fulfillment and quotation workflows. agricoop_app.users SELECT policies
-- only expose self, platform staff, and same-cooperative members, so buyers
-- (who have no cooperativeId) were invisible to sellers and officers. That
-- silently emptied seller order/quotation queues (innerJoin on users) and
-- hid buyer details from OfficerAdmin order views.
--
-- This policy exposes a user row only to authenticated users who share a
-- concrete marketplace relationship: an order or a quotation request.
-- OfficerAdmins additionally see buyers/sellers on orders inside their own
-- cooperative. No new columns or grants are added.
--
-- NOTE: conversations is intentionally excluded — its SELECT policy already
-- references agricoop_app.users, so a users policy referencing conversations
-- creates infinite RLS recursion and breaks all user lookups (including auth
-- resolution).

DROP POLICY IF EXISTS agricoop_mkt_users_counterparty_select ON agricoop_app.users;

CREATE POLICY agricoop_mkt_users_counterparty_select
  ON agricoop_app.users FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE (o."buyerId" = users.id AND o."sellerId" = agricoop_app.current_app_user_id())
         OR (o."sellerId" = users.id AND o."buyerId" = agricoop_app.current_app_user_id())
    )
    OR EXISTS (
      SELECT 1 FROM agricoop_app.quotations q
      WHERE (q."buyerId" = users.id AND q."sellerId" = agricoop_app.current_app_user_id())
         OR (q."sellerId" = users.id AND q."buyerId" = agricoop_app.current_app_user_id())
    )
    OR (
      agricoop_app.current_app_role() = 'admin'
      AND agricoop_app.current_app_cooperative_id() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM agricoop_app.orders o
        WHERE o."cooperativeId" = agricoop_app.current_app_cooperative_id()
          AND (o."buyerId" = users.id OR o."sellerId" = users.id)
      )
    )
  );
