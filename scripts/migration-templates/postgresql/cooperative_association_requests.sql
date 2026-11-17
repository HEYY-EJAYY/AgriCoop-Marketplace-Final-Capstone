-- REVIEW ONLY: do not execute without DBA approval in an isolated staging database.
-- Confirm application-schema ownership, grants, RLS policy, and role scopes first.
CREATE TYPE agricoop_app.association_request_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE agricoop_app."cooperativeAssociationRequests" (
  id serial PRIMARY KEY,
  "sellerId" integer NOT NULL REFERENCES agricoop_app.users(id),
  "cooperativeId" integer NOT NULL REFERENCES agricoop_app.cooperatives(id),
  status agricoop_app.association_request_status NOT NULL DEFAULT 'pending',
  message text,
  "reviewNote" text,
  "reviewedBy" integer REFERENCES agricoop_app.users(id),
  "createdAt" timestamp without time zone NOT NULL DEFAULT now(),
  "reviewedAt" timestamp without time zone
);

CREATE INDEX "cooperativeAssociationRequests_seller_status_idx"
  ON agricoop_app."cooperativeAssociationRequests" ("sellerId", status);
CREATE INDEX "cooperativeAssociationRequests_cooperative_status_idx"
  ON agricoop_app."cooperativeAssociationRequests" ("cooperativeId", status);
CREATE UNIQUE INDEX "cooperativeAssociationRequests_one_pending_seller_idx"
  ON agricoop_app."cooperativeAssociationRequests" ("sellerId")
  WHERE status = 'pending';
