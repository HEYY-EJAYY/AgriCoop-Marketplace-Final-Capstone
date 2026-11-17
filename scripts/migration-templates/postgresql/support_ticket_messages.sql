-- REVIEW ONLY: do not execute without DBA approval in an isolated staging database.
-- Confirm application-schema ownership, grants, RLS policy, and ticket access scopes first.
CREATE TABLE agricoop_app."supportTicketMessages" (
  id serial PRIMARY KEY,
  "ticketId" integer NOT NULL
    REFERENCES agricoop_app."supportTickets"(id) ON DELETE CASCADE,
  "senderId" integer NOT NULL REFERENCES agricoop_app.users(id),
  body text NOT NULL,
  "createdAt" timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX "supportTicketMessages_ticket_created_idx"
  ON agricoop_app."supportTicketMessages" ("ticketId", "createdAt");
