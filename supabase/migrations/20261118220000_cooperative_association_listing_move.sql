-- PURPOSE: Persist the reviewer's opt-in for moving a Seller's existing listings.
-- Adds a narrowly scoped SECURITY DEFINER helper for that approved request only.
-- ADDITIVE AND IDEMPOTENT. No existing product rows are rewritten by this migration.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('agricoop_app."cooperativeAssociationRequests"') IS NULL
     OR to_regclass('agricoop_app.users') IS NULL
     OR to_regclass('agricoop_app.products') IS NULL
     OR to_regprocedure('agricoop_app.guard_users_protected_columns()') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger
       WHERE tgrelid = 'agricoop_app.users'::regclass
         AND tgname = 'agricoop_users_protected_columns_guard'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'Association approval migration precondition failed: expected protected users trigger and marketplace tables';
  END IF;
END;
$preflight$;

ALTER TABLE agricoop_app."cooperativeAssociationRequests"
  ADD COLUMN IF NOT EXISTS "moveExistingListings" boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION agricoop_app.guard_users_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  actor_id integer := agricoop_app.current_app_user_id();
  actor_role text := agricoop_app.current_app_role();
BEGIN
  IF NEW."role" IS DISTINCT FROM OLD."role"
     OR NEW."approvalStatus" IS DISTINCT FROM OLD."approvalStatus"
     OR NEW."cooperativeId" IS DISTINCT FROM OLD."cooperativeId"
     OR NEW."verificationStatus" IS DISTINCT FROM OLD."verificationStatus"
     OR NEW."verifiedBy" IS DISTINCT FROM OLD."verifiedBy"
     OR NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt" THEN
    IF actor_id IS NULL THEN
      RAISE EXCEPTION 'Protected user fields require an authenticated application user';
    END IF;
    IF actor_id = OLD.id THEN
      IF NEW."role" IS DISTINCT FROM OLD."role"
         OR NEW."approvalStatus" IS DISTINCT FROM OLD."approvalStatus"
         OR NEW."cooperativeId" IS DISTINCT FROM OLD."cooperativeId" THEN
        RAISE EXCEPTION 'Users cannot change their own role, approval status, or cooperative';
      END IF;
    ELSIF actor_role NOT IN ('admin', 'superadmin') THEN
      RAISE EXCEPTION 'Only Admin or SuperAdmin can change protected user fields';
    ELSIF actor_role = 'admin'
          AND (
            OLD."cooperativeId" IS DISTINCT FROM agricoop_app.current_app_cooperative_id()
            OR NEW."cooperativeId" IS DISTINCT FROM agricoop_app.current_app_cooperative_id()
            OR NEW."role" = 'superadmin'
            OR OLD."role" = 'superadmin'
          )
          AND NOT (
            OLD."role" = 'seller'
            AND NEW."role" = 'seller'
            AND OLD."approvalStatus" IS NOT DISTINCT FROM NEW."approvalStatus"
            AND OLD."verificationStatus" IS NOT DISTINCT FROM NEW."verificationStatus"
            AND OLD."verifiedBy" IS NOT DISTINCT FROM NEW."verifiedBy"
            AND OLD."verifiedAt" IS NOT DISTINCT FROM NEW."verifiedAt"
            AND OLD."cooperativeId" IS DISTINCT FROM NEW."cooperativeId"
            AND NEW."cooperativeId" = agricoop_app.current_app_cooperative_id()
            AND EXISTS (
              SELECT 1
              FROM agricoop_app."cooperativeAssociationRequests" AS request
              WHERE request."sellerId" = OLD.id
                AND request."cooperativeId" = NEW."cooperativeId"
                AND request."status" = 'approved'
                AND request."reviewedBy" = actor_id
                AND request."reviewedAt" = transaction_timestamp()
            )
          ) THEN
      RAISE EXCEPTION 'Admin cannot change users outside their cooperative or promote SuperAdmin';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION agricoop_app.approve_cooperative_association_request(
  p_request_id integer,
  p_review_note text,
  p_move_existing_listings boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id integer;
  actor_role text;
  actor_cooperative_id integer;
  seller_id integer;
  target_cooperative_id integer;
  request_status text;
  cooperative_status text;
  cooperative_deleted boolean;
  seller_role text;
  seller_approval_status text;
  seller_deleted boolean;
  seller_cooperative_id integer;
  changed_count integer;
BEGIN
  actor_id := agricoop_app.current_app_user_id();
  actor_role := agricoop_app.current_app_role();
  actor_cooperative_id := agricoop_app.current_app_cooperative_id();

  IF actor_id IS NULL OR actor_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Only Admin or SuperAdmin can approve an association request'
      USING ERRCODE = '42501';
  END IF;
  IF p_review_note IS NULL OR length(btrim(p_review_note)) = 0 OR length(btrim(p_review_note)) > 600 THEN
    RAISE EXCEPTION 'A review note of 1 to 600 characters is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT request."sellerId", request."cooperativeId", request.status::text
  INTO seller_id, target_cooperative_id, request_status
  FROM agricoop_app."cooperativeAssociationRequests" AS request
  WHERE request.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR request_status <> 'pending' THEN
    RAISE EXCEPTION 'This association request is no longer pending'
      USING ERRCODE = '23514';
  END IF;
  IF actor_role = 'admin'
     AND (actor_cooperative_id IS NULL OR actor_cooperative_id <> target_cooperative_id) THEN
    RAISE EXCEPTION 'Admin cannot approve requests for another cooperative'
      USING ERRCODE = '42501';
  END IF;

  SELECT cooperative.status::text, cooperative."deletedAt" IS NOT NULL
  INTO cooperative_status, cooperative_deleted
  FROM agricoop_app.cooperatives AS cooperative
  WHERE cooperative.id = target_cooperative_id
  FOR UPDATE;
  IF NOT FOUND OR cooperative_deleted OR cooperative_status <> 'active' THEN
    RAISE EXCEPTION 'An inactive or deleted cooperative cannot accept new Sellers'
      USING ERRCODE = '23514';
  END IF;

  SELECT seller."role"::text, seller."approvalStatus"::text,
         seller."deletedAt" IS NOT NULL, seller."cooperativeId"
  INTO seller_role, seller_approval_status, seller_deleted, seller_cooperative_id
  FROM agricoop_app.users AS seller
  WHERE seller.id = seller_id
  FOR UPDATE;
  IF NOT FOUND
     OR seller_role <> 'seller'
     OR seller_approval_status = 'suspended'
     OR seller_deleted
     OR seller_cooperative_id IS NOT DISTINCT FROM target_cooperative_id THEN
    RAISE EXCEPTION 'The Seller account changed and this request can no longer be approved'
      USING ERRCODE = '23514';
  END IF;

  UPDATE agricoop_app."cooperativeAssociationRequests"
  SET status = 'approved',
      "reviewedBy" = actor_id,
      "reviewNote" = btrim(p_review_note),
      "moveExistingListings" = p_move_existing_listings,
      "reviewedAt" = now()
  WHERE id = p_request_id AND status = 'pending';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 1 THEN
    RAISE EXCEPTION 'This association request changed while being reviewed'
      USING ERRCODE = '23514';
  END IF;

  UPDATE agricoop_app.users
  SET "cooperativeId" = target_cooperative_id
  WHERE id = seller_id
    AND role = 'seller'
    AND "approvalStatus" <> 'suspended'
    AND "deletedAt" IS NULL;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 1 THEN
    RAISE EXCEPTION 'The Seller assignment changed before this request completed'
      USING ERRCODE = '23514';
  END IF;

  IF p_move_existing_listings THEN
    UPDATE agricoop_app.products
    SET "cooperativeId" = target_cooperative_id
    WHERE "sellerId" = seller_id
      AND "cooperativeId" IS DISTINCT FROM target_cooperative_id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION agricoop_app.approve_cooperative_association_request(integer, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION agricoop_app.approve_cooperative_association_request(integer, text, boolean)
  TO authenticated;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'agricoop_app'
      AND table_name = 'cooperativeAssociationRequests'
      AND column_name = 'moveExistingListings'
      AND data_type = 'boolean'
      AND is_nullable = 'NO'
  ) OR to_regprocedure('agricoop_app.approve_cooperative_association_request(integer,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Association listing move migration verification failed';
  END IF;
END;
$verify$;

COMMIT;
