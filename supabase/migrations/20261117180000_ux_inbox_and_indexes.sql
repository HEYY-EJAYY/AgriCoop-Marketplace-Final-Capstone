-- PURPOSE: Soft-delete / pin / archive inbox state + additive marketplace indexes.
-- IDEMPOTENT / ADDITIVE ONLY.

BEGIN;

CREATE TABLE IF NOT EXISTS agricoop_app."threadStates" (
  id serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES agricoop_app.users(id),
  channel varchar(32) NOT NULL,
  "threadId" integer NOT NULL,
  "isRead" integer NOT NULL DEFAULT 0,
  "pinnedAt" timestamp without time zone,
  "archivedAt" timestamp without time zone,
  "deletedAt" timestamp without time zone,
  "createdAt" timestamp without time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT thread_states_channel_check CHECK (channel IN ('conversation', 'ticket', 'support')),
  CONSTRAINT thread_states_user_channel_thread_uidx UNIQUE ("userId", channel, "threadId")
);

CREATE INDEX IF NOT EXISTS thread_states_user_channel_idx
  ON agricoop_app."threadStates" ("userId", channel);

CREATE INDEX IF NOT EXISTS thread_states_user_deleted_idx
  ON agricoop_app."threadStates" ("userId", "deletedAt");

ALTER TABLE agricoop_app.notifications
  ADD COLUMN IF NOT EXISTS "archivedAt" timestamp without time zone;

ALTER TABLE agricoop_app.notifications
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp without time zone;

ALTER TABLE agricoop_app."supportTickets"
  ADD COLUMN IF NOT EXISTS "archivedAt" timestamp without time zone;

ALTER TABLE agricoop_app."supportTickets"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp without time zone;

ALTER TABLE agricoop_app."supportTickets"
  ADD COLUMN IF NOT EXISTS "pinnedAt" timestamp without time zone;

ALTER TABLE agricoop_app.conversations
  ADD COLUMN IF NOT EXISTS "archivedAt" timestamp without time zone;

ALTER TABLE agricoop_app.conversations
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp without time zone;

CREATE INDEX IF NOT EXISTS products_category_idx ON agricoop_app.products (category);
CREATE INDEX IF NOT EXISTS products_price_cents_idx ON agricoop_app.products ("priceCents");
CREATE INDEX IF NOT EXISTS products_stock_qty_idx ON agricoop_app.products ("stockQty");
CREATE INDEX IF NOT EXISTS products_cooperative_id_idx ON agricoop_app.products ("cooperativeId");
CREATE INDEX IF NOT EXISTS conversations_order_id_idx ON agricoop_app.conversations ("orderId");
CREATE INDEX IF NOT EXISTS conversations_buyer_id_idx ON agricoop_app.conversations ("buyerId");
CREATE INDEX IF NOT EXISTS conversations_seller_id_idx ON agricoop_app.conversations ("sellerId");

ALTER TABLE agricoop_app."threadStates" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE agricoop_app."threadStates" FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app."threadStates" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE agricoop_app."threadStates_id_seq" TO authenticated;

DROP POLICY IF EXISTS agricoop_thread_states_own ON agricoop_app."threadStates";
CREATE POLICY agricoop_thread_states_own ON agricoop_app."threadStates"
  FOR ALL
  TO authenticated
  USING ("userId" = agricoop_app.current_app_user_id())
  WITH CHECK ("userId" = agricoop_app.current_app_user_id());

COMMIT;

DO $$
BEGIN
  IF to_regclass('agricoop_app."threadStates"') IS NULL THEN
    RAISE EXCEPTION 'threadStates missing after migration';
  END IF;
END $$;
