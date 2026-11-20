-- orders.create appends audit rows to agricoop_app."orderHistory", but the table
-- only had a SELECT policy, so RLS denied every insert and order placement failed
-- with an internal error. Mirror the existing orderEvents INSERT policy: an
-- authenticated party may append history for orders they participate in.

CREATE POLICY agricoop_mkt_order_history_insert
ON agricoop_app."orderHistory"
FOR INSERT
WITH CHECK (
  "actorUserId" = agricoop_app.current_app_user_id()
  AND EXISTS (
    SELECT 1
    FROM agricoop_app.orders o
    WHERE o.id = "orderHistory"."orderId"
      AND (
        o."buyerId" = agricoop_app.current_app_user_id()
        OR o."sellerId" = agricoop_app.current_app_user_id()
        OR agricoop_app.shares_cooperative(o."cooperativeId")
        OR agricoop_app.is_superadmin()
      )
  )
);

GRANT INSERT ON agricoop_app."orderHistory" TO authenticated;
