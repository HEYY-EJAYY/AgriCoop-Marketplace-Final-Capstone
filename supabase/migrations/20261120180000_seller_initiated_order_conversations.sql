-- Allow the seller on an order to open the order conversation thread.
-- conversation.buyerId remains the order's buyer (canonical participant);
-- previously INSERT required buyerId = current user, so seller-initiated
-- "Message" on an order always failed under RLS.
DROP POLICY IF EXISTS agricoop_mkt_conversations_insert ON agricoop_app.conversations;
CREATE POLICY agricoop_mkt_conversations_insert
  ON agricoop_app.conversations FOR INSERT TO authenticated
  WITH CHECK (
    "buyerId" = agricoop_app.current_app_user_id()
    OR (
      "orderId" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM agricoop_app.orders o
        WHERE o.id = "orderId"
          AND (o."buyerId" = agricoop_app.current_app_user_id()
               OR o."sellerId" = agricoop_app.current_app_user_id())
      )
    )
  );
