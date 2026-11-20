-- 1) notifications.remove soft-deletes via deletedAt, but authenticated only
--    had UPDATE ("isRead") granted and the self-update policy did not cover
--    inbox-state columns. Grant the missing column privileges.
GRANT UPDATE ("deletedAt", "archivedAt") ON agricoop_app.notifications TO authenticated;

-- Widen the self-update policy check so soft-delete/restore writes pass.
DROP POLICY IF EXISTS agricoop_mkt_notifications_self_update ON agricoop_app.notifications;
CREATE POLICY agricoop_mkt_notifications_self_update
  ON agricoop_app.notifications FOR UPDATE TO authenticated
  USING ("userId" = agricoop_app.current_app_user_id())
  WITH CHECK ("userId" = agricoop_app.current_app_user_id() AND "isRead" IN (0, 1));

-- 2) conversations.send marks the counterparty's threadState unread, but
--    threadStates RLS only exposes own rows — the insert/update for the other
--    participant always failed and rolled back the message. SECURITY DEFINER
--    helper performs the cross-user update without weakening RLS.
CREATE OR REPLACE FUNCTION agricoop_app.mark_counterparty_thread_unread(
  p_channel text,
  p_thread_id integer,
  p_actor_id integer
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = agricoop_app, pg_temp
AS $$
  UPDATE agricoop_app."threadStates"
  SET "isRead" = 0, "updatedAt" = now()
  WHERE "userId" <> p_actor_id
    AND "channel" = p_channel
    AND "threadId" = p_thread_id;
$$;

REVOKE ALL ON FUNCTION agricoop_app.mark_counterparty_thread_unread(text, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION agricoop_app.mark_counterparty_thread_unread(text, integer, integer) TO authenticated;

-- 3) Publish operational tables for Supabase Realtime postgres_changes.
--    RLS still applies: clients only receive rows they may SELECT.
DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY[
      'notifications', 'orders', 'orderHistory', 'orderEvents', 'transactions',
      'paymentProofs', 'conversations', 'conversationMessages', 'quotations',
      'products', 'users', 'cooperatives', 'threadStates'
    ] LOOP
      BEGIN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE agricoop_app.%I', t);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END;
    END LOOP;
  END IF;
END $$;
