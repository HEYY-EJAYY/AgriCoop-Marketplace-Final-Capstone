-- BLOCK 29: Soft-delete columns on agricoop_app.users (additive).
ALTER TABLE agricoop_app.users
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp without time zone,
  ADD COLUMN IF NOT EXISTS "deletedBy" integer REFERENCES agricoop_app.users(id),
  ADD COLUMN IF NOT EXISTS "deletedByRole" varchar(32);

CREATE INDEX IF NOT EXISTS users_deleted_at_idx
  ON agricoop_app.users ("deletedAt")
  WHERE "deletedAt" IS NOT NULL;

GRANT SELECT ("deletedAt", "deletedBy", "deletedByRole") ON TABLE agricoop_app.users TO authenticated;
GRANT UPDATE ("deletedAt", "deletedBy", "deletedByRole") ON TABLE agricoop_app.users TO authenticated;
