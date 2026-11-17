-- REVIEW ONLY: do not execute without DBA approval in an isolated staging database.
-- Confirm the application schema owner, grants, RLS policy, and Storage bucket policies first.
CREATE TABLE agricoop_app."productImages" (
  id serial PRIMARY KEY,
  "productId" integer NOT NULL
    REFERENCES agricoop_app.products(id) ON DELETE CASCADE,
  "imageUrl" varchar(1000) NOT NULL,
  "displayOrder" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX "productImages_product_order_idx"
  ON agricoop_app."productImages" ("productId", "displayOrder");
