-- Performance indexes for hot admin/analytics sort+filter paths.
-- All tables are small today; plain CREATE INDEX is safe (no CONCURRENTLY
-- inside the migration runner's transaction).
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON agricoop_app.orders ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS transactions_created_at_idx ON agricoop_app.transactions ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS transactions_completed_at_idx ON agricoop_app.transactions ("completedAt" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS users_created_at_idx ON agricoop_app.users ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON agricoop_app.notifications ("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS quotations_created_at_idx ON agricoop_app.quotations ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS products_created_at_idx ON agricoop_app.products ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS cooperatives_created_at_idx ON agricoop_app.cooperatives ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS conversation_messages_created_idx ON agricoop_app."conversationMessages" ("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS order_history_order_created_idx ON agricoop_app."orderHistory" ("orderId", "createdAt");
