-- Allow ticket owners (buyers/sellers) to update their own support ticket row.
-- The reply flow selects the ticket FOR UPDATE and may reopen a resolved ticket,
-- which requires UPDATE privileges under RLS. Previously only superadmins and
-- cooperative-sharing admins could update, so owner replies failed with
-- "Support ticket not found."
CREATE POLICY agricoop_mkt_support_tickets_owner_update
  ON agricoop_app."supportTickets" FOR UPDATE TO authenticated
  USING ("userId" = agricoop_app.current_app_user_id())
  WITH CHECK ("userId" = agricoop_app.current_app_user_id());
