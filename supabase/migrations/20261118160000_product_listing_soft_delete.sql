-- BLOCK 26: Product listing soft-delete columns (additive, idempotent).
-- Sellers / admins soft-delete listings without hard DELETE. Marketplace and
-- Active/Archived tabs exclude rows where deletedAt IS NOT NULL.

BEGIN;

ALTER TABLE agricoop_app.products
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp without time zone;

ALTER TABLE agricoop_app.products
  ADD COLUMN IF NOT EXISTS "deletedBy" integer REFERENCES agricoop_app.users(id);

GRANT UPDATE ("deletedAt", "deletedBy") ON TABLE agricoop_app.products TO authenticated;

CREATE INDEX IF NOT EXISTS products_deleted_at_idx
  ON agricoop_app.products ("deletedAt")
  WHERE "deletedAt" IS NOT NULL;

COMMIT;
