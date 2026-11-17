-- Additive profile-verification storage metadata and cooperative-scoped access.
-- Manual review only. Do not run until the complete production catalog/ACL/RLS
-- snapshot and the required private Storage bucket have been reviewed.
-- This file has not been executed against any database.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('agricoop_app.users') IS NULL
     OR to_regclass('agricoop_app.cooperatives') IS NULL
     OR to_regclass('agricoop_app."auditLogs"') IS NULL
     OR to_regclass('agricoop_app.notifications') IS NULL THEN
    RAISE EXCEPTION 'Profile-verification precondition failed: required application tables are missing';
  END IF;

  -- Idempotent: if the submission table already exists, remaining DDL uses
  -- IF NOT EXISTS / DROP POLICY IF EXISTS patterns below.
  IF to_regclass('agricoop_app."profileVerificationSubmissions"') IS NOT NULL THEN
    RAISE NOTICE 'Profile-verification: profileVerificationSubmissions already present; continuing idempotently';
  END IF;

  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Profile-verification precondition failed: auth.uid() is unavailable';
  END IF;

  IF (
    SELECT array_agg(enumlabel::text ORDER BY enumlabel::text)
    FROM pg_enum
    WHERE enumtypid = to_regtype('agricoop_app.user_verification_status')
  ) IS DISTINCT FROM ARRAY['approved', 'pending', 'rejected', 'unverified']::text[] THEN
    RAISE EXCEPTION 'Profile-verification precondition failed: user_verification_status labels differ from the confirmed enum';
  END IF;

  IF NOT (
    SELECT relrowsecurity FROM pg_class WHERE oid = 'agricoop_app.users'::regclass
  ) THEN
    RAISE EXCEPTION 'Profile-verification precondition failed: users RLS must remain enabled';
  END IF;

  IF NOT (
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'agricoop_app."auditLogs"'::regclass)
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'agricoop_app.notifications'::regclass)
  ) THEN
    RAISE EXCEPTION 'Profile-verification precondition failed: auditLogs and notifications RLS must remain enabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'agricoop_app'
      AND tablename = 'users'
      AND policyname NOT IN (
        'agricoop_auth_users_self_select',
        'agricoop_auth_users_self_insert',
        'agricoop_auth_users_self_update',
        'agricoop_profile_verification_admin_select',
        'agricoop_profile_verification_admin_update'
      )
  ) THEN
    RAISE EXCEPTION 'Profile-verification migration stopped: unexpected users policies require manual review';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'agricoop_app'
      AND tablename = 'users'
      AND policyname = 'agricoop_auth_users_self_select'
      AND cmd = 'SELECT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'agricoop_app'
      AND tablename = 'users'
      AND policyname = 'agricoop_auth_users_self_update'
      AND cmd = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'Profile-verification precondition failed: reviewed auth self-select/update policies must be installed first';
  END IF;

  -- Helpers/triggers/policies may already exist after a partial apply; recreate safely below.

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid IN (
      'agricoop_app.users'::regclass,
      'agricoop_app."auditLogs"'::regclass
    )
      AND relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
    GROUP BY relowner
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'Profile-verification migration stopped: executor cannot own the protected audit trigger';
  END IF;
END
$preflight$;

CREATE TABLE IF NOT EXISTS agricoop_app."profileVerificationSubmissions" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES agricoop_app.users("id") ON DELETE CASCADE,
  "storagePath" text NOT NULL UNIQUE,
  "mimeType" varchar(100) NOT NULL,
  "fileSizeBytes" bigint NOT NULL,
  "submissionNote" text,
  "status" agricoop_app.user_verification_status NOT NULL DEFAULT 'pending',
  "submittedAt" timestamp NOT NULL DEFAULT now(),
  "reviewedBy" integer REFERENCES agricoop_app.users("id") ON DELETE SET NULL,
  "reviewedAt" timestamp,
  "reviewNote" text,
  CONSTRAINT "profileVerificationSubmissionsFileSizeCheck"
    CHECK ("fileSizeBytes" BETWEEN 1 AND 5242880),
  CONSTRAINT "profileVerificationSubmissionsMimeTypeCheck"
    CHECK ("mimeType" IN ('image/jpeg', 'image/png', 'image/webp'))
);

CREATE INDEX IF NOT EXISTS "profileVerificationSubmissionsUserSubmittedIdx"
  ON agricoop_app."profileVerificationSubmissions" ("userId", "submittedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "profileVerificationSubmissionsOnePendingUserIdx"
  ON agricoop_app."profileVerificationSubmissions" ("userId")
  WHERE "status" = 'pending';

REVOKE ALL PRIVILEGES ON TABLE agricoop_app."profileVerificationSubmissions"
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION agricoop_app.can_review_profile_verification_user(target_user_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, agricoop_app, auth
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM agricoop_app.users AS actor
    JOIN agricoop_app.users AS target ON target."id" = target_user_id
    WHERE actor."openId" = (SELECT auth.uid())::text
      AND actor."approvalStatus" = 'approved'
      AND actor."id" <> target."id"
      AND target."role" IN ('buyer', 'seller')
      AND (
        actor."role" = 'superadmin'
        OR (
          actor."role" = 'admin'
          AND actor."cooperativeId" IS NOT NULL
          AND actor."cooperativeId" = target."cooperativeId"
        )
      )
  )
$function$;

REVOKE ALL ON FUNCTION agricoop_app.can_review_profile_verification_user(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA agricoop_app, auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT EXECUTE ON FUNCTION agricoop_app.can_review_profile_verification_user(integer) TO authenticated;
GRANT SELECT ("id", "openId", "role", "cooperativeId", "verificationStatus", "name", "birthdate", "phone", "address")
  ON TABLE agricoop_app.users TO authenticated;
GRANT UPDATE ("verificationStatus", "verificationNote", "verifiedBy", "verifiedAt", "birthdate", "phone", "address")
  ON TABLE agricoop_app.users TO authenticated;
GRANT SELECT ON TABLE agricoop_app."profileVerificationSubmissions" TO authenticated;
GRANT INSERT ("userId", "storagePath", "mimeType", "fileSizeBytes", "submissionNote")
  ON TABLE agricoop_app."profileVerificationSubmissions" TO authenticated;
GRANT UPDATE ("status", "reviewedBy", "reviewedAt", "reviewNote")
  ON TABLE agricoop_app."profileVerificationSubmissions" TO authenticated;
GRANT SELECT ON TABLE agricoop_app.notifications TO authenticated;
GRANT UPDATE ("isRead") ON TABLE agricoop_app.notifications TO authenticated;
GRANT INSERT ("userId", "type", "title", "content", "link", "relatedEntityId", "relatedEntityType")
  ON TABLE agricoop_app.notifications TO authenticated;

DO $sequence_grants$
DECLARE
  target_table text;
  target_sequence regclass;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'agricoop_app."profileVerificationSubmissions"',
    'agricoop_app.notifications'
  ]
  LOOP
    target_sequence := pg_get_serial_sequence(target_table, 'id');
    IF target_sequence IS NULL THEN
      RAISE EXCEPTION 'Profile-verification migration stopped: required identity sequence is missing';
    END IF;
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
      target_sequence
    );
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', target_sequence);
  END LOOP;
END
$sequence_grants$;

CREATE OR REPLACE FUNCTION agricoop_app.guard_profile_verification_user_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, agricoop_app, auth
AS $function$
DECLARE
  actor_id integer;
  allowed_change boolean := false;
  personal_details_changed boolean;
  verification_state_changed boolean;
BEGIN
  personal_details_changed :=
    NEW."birthdate" IS DISTINCT FROM OLD."birthdate"
    OR NEW."phone" IS DISTINCT FROM OLD."phone"
    OR NEW."address" IS DISTINCT FROM OLD."address";
  verification_state_changed :=
    NEW."verificationStatus" IS DISTINCT FROM OLD."verificationStatus"
    OR NEW."verificationNote" IS DISTINCT FROM OLD."verificationNote"
    OR NEW."verifiedBy" IS DISTINCT FROM OLD."verifiedBy"
    OR NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt";

  IF NOT personal_details_changed AND NOT verification_state_changed THEN
    RETURN NEW;
  END IF;

  SELECT actor."id"
    INTO actor_id
    FROM agricoop_app.users AS actor
   WHERE actor."openId" = (SELECT auth.uid())::text;

  IF personal_details_changed AND actor_id IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'Only the applicant may update personal verification details';
  END IF;

  IF NOT verification_state_changed THEN
    RETURN NEW;
  ELSIF actor_id = OLD."id" THEN
    allowed_change :=
      NEW."verificationStatus" = 'pending'
      AND OLD."verificationStatus" IN ('unverified', 'rejected')
      AND NEW."verifiedBy" IS NULL
      AND NEW."verifiedAt" IS NULL
      AND EXISTS (
        SELECT 1
        FROM agricoop_app."profileVerificationSubmissions" AS submission
        WHERE submission."userId" = OLD."id"
          AND submission."status" = 'pending'
          AND submission."submissionNote" IS NOT DISTINCT FROM NEW."verificationNote"
      );
  ELSIF actor_id IS NOT NULL
    AND agricoop_app.can_review_profile_verification_user(OLD."id") THEN
    allowed_change :=
      OLD."verificationStatus" = 'pending'
      AND
      NEW."verificationStatus" IN ('approved', 'rejected')
      AND NEW."verifiedBy" = actor_id
      AND NEW."verifiedAt" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM agricoop_app."profileVerificationSubmissions" AS submission
        WHERE submission."userId" = OLD."id"
          AND submission."status" = NEW."verificationStatus"
          AND submission."reviewedBy" = actor_id
          AND submission."reviewedAt" = NEW."verifiedAt"
          AND submission."reviewNote" IS NOT DISTINCT FROM NEW."verificationNote"
      );
  END IF;

  IF NOT allowed_change THEN
    RAISE EXCEPTION 'Profile verification state changes must use an authorized submission or review';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION agricoop_app.guard_profile_verification_user_update()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION agricoop_app.write_profile_verification_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, agricoop_app, auth
AS $function$
DECLARE
  actor_id integer;
  target_cooperative_id integer;
  event_action text;
  event_metadata jsonb;
BEGIN
  SELECT actor."id"
    INTO actor_id
    FROM agricoop_app.users AS actor
   WHERE actor."openId" = (SELECT auth.uid())::text;

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Profile verification audit requires an authenticated application user';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."userId" <> actor_id
      OR NEW."status" <> 'pending'
      OR NEW."reviewedBy" IS NOT NULL
      OR NEW."reviewedAt" IS NOT NULL
      OR NEW."reviewNote" IS NOT NULL THEN
      RAISE EXCEPTION 'Profile verification submission audit does not match an applicant submission';
    END IF;
    event_action := 'profile_verification_submitted';
    event_metadata := jsonb_build_object(
      'mimeType', NEW."mimeType",
      'fileSizeBytes', NEW."fileSizeBytes"
    );
    target_cooperative_id := (
      SELECT target."cooperativeId"
      FROM agricoop_app.users AS target
      WHERE target."id" = NEW."userId"
    );
  ELSIF TG_OP = 'UPDATE' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" <> 'pending'
      OR NEW."status" NOT IN ('approved', 'rejected')
      OR NEW."reviewedBy" IS DISTINCT FROM actor_id
      OR NEW."reviewedAt" IS NULL
      OR (NEW."status" = 'rejected' AND NULLIF(btrim(NEW."reviewNote"), '') IS NULL)
      OR NOT agricoop_app.can_review_profile_verification_user(NEW."userId") THEN
      RAISE EXCEPTION 'Profile verification review audit requires an authorized cooperative reviewer';
    END IF;
    event_action := 'profile_verification_' || NEW."status"::text;
    event_metadata := jsonb_build_object(
      'decision', NEW."status"::text,
      'userId', NEW."userId"
    );
    target_cooperative_id := (
      SELECT target."cooperativeId"
      FROM agricoop_app.users AS target
      WHERE target."id" = NEW."userId"
    );
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO agricoop_app."auditLogs" (
    "actorUserId",
    "action",
    "entityType",
    "entityId",
    "cooperativeId",
    "metadata"
  ) VALUES (
    actor_id,
    event_action,
    'profile_verification_submission',
    NEW."id",
    target_cooperative_id,
    event_metadata::text
  );

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION agricoop_app.write_profile_verification_audit_event()
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE agricoop_app."profileVerificationSubmissions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agricoop_profile_verification_admin_select ON agricoop_app.users;
DROP POLICY IF EXISTS agricoop_profile_verification_admin_update ON agricoop_app.users;
DROP POLICY IF EXISTS agricoop_profile_verification_self_select ON agricoop_app."profileVerificationSubmissions";
DROP POLICY IF EXISTS agricoop_profile_verification_admin_read ON agricoop_app."profileVerificationSubmissions";
DROP POLICY IF EXISTS agricoop_profile_verification_self_insert ON agricoop_app."profileVerificationSubmissions";
DROP POLICY IF EXISTS agricoop_profile_verification_admin_update ON agricoop_app."profileVerificationSubmissions";
DROP POLICY IF EXISTS agricoop_profile_verification_notification_insert ON agricoop_app.notifications;
DROP POLICY IF EXISTS agricoop_notifications_self_read ON agricoop_app.notifications;
DROP POLICY IF EXISTS agricoop_notifications_self_mark_read ON agricoop_app.notifications;
DROP TRIGGER IF EXISTS agricoop_profile_verification_guard ON agricoop_app.users;
DROP TRIGGER IF EXISTS agricoop_profile_verification_audit_event ON agricoop_app."profileVerificationSubmissions";

CREATE POLICY agricoop_profile_verification_admin_select
  ON agricoop_app.users FOR SELECT TO authenticated
  USING (agricoop_app.can_review_profile_verification_user("id"));

CREATE POLICY agricoop_profile_verification_admin_update
  ON agricoop_app.users FOR UPDATE TO authenticated
  USING (agricoop_app.can_review_profile_verification_user("id"))
  WITH CHECK (agricoop_app.can_review_profile_verification_user("id"));

CREATE POLICY agricoop_profile_verification_self_select
  ON agricoop_app."profileVerificationSubmissions" FOR SELECT TO authenticated
  USING (
    "userId" = (
      SELECT id FROM agricoop_app.users
      WHERE "openId" = (SELECT auth.uid())::text
    )
  );

CREATE POLICY agricoop_profile_verification_admin_read
  ON agricoop_app."profileVerificationSubmissions" FOR SELECT TO authenticated
  USING (agricoop_app.can_review_profile_verification_user("userId"));

CREATE POLICY agricoop_profile_verification_self_insert
  ON agricoop_app."profileVerificationSubmissions" FOR INSERT TO authenticated
  WITH CHECK (
    "status" = 'pending'
    AND "reviewedBy" IS NULL
    AND "reviewedAt" IS NULL
    AND "reviewNote" IS NULL
    AND "userId" = (
      SELECT id FROM agricoop_app.users
      WHERE "openId" = (SELECT auth.uid())::text
    )
    AND "storagePath" LIKE
      'profile-verification-documents/' || "userId"::text || '/%'
    AND current_setting('agricoop.profile_verification_upload_verified', true) = '1'
  );

CREATE POLICY agricoop_profile_verification_admin_update
  ON agricoop_app."profileVerificationSubmissions" FOR UPDATE TO authenticated
  USING (
    agricoop_app.can_review_profile_verification_user("userId")
    AND "status" = 'pending'
  )
  WITH CHECK (
    agricoop_app.can_review_profile_verification_user("userId")
    AND "status" IN ('approved', 'rejected')
    AND "reviewedBy" = (
      SELECT id FROM agricoop_app.users
      WHERE "openId" = (SELECT auth.uid())::text
    )
    AND "reviewedAt" IS NOT NULL
    AND ("status" <> 'rejected' OR NULLIF(btrim("reviewNote"), '') IS NOT NULL)
  );

CREATE POLICY agricoop_profile_verification_notification_insert
  ON agricoop_app.notifications FOR INSERT TO authenticated
  WITH CHECK (
    "relatedEntityType" = 'profile_verification_submission'
    AND "type" IN (
      'profile_verification_submitted',
      'profile_verification_approved',
      'profile_verification_rejected'
    )
    AND EXISTS (
      SELECT 1
      FROM agricoop_app."profileVerificationSubmissions" AS submission
      WHERE submission."id" = "relatedEntityId"
        AND submission."userId" = "userId"
        AND (
          (
            "type" = 'profile_verification_submitted'
            AND submission."status" = 'pending'
            AND submission."userId" = (
              SELECT id FROM agricoop_app.users
              WHERE "openId" = (SELECT auth.uid())::text
            )
          )
          OR (
            "type" IN ('profile_verification_approved', 'profile_verification_rejected')
            AND submission."status"::text = split_part("type", 'profile_verification_', 2)
            AND agricoop_app.can_review_profile_verification_user(submission."userId")
          )
        )
    )
  );

CREATE POLICY agricoop_notifications_self_read
  ON agricoop_app.notifications FOR SELECT TO authenticated
  USING (
    "userId" = (
      SELECT id FROM agricoop_app.users
      WHERE "openId" = (SELECT auth.uid())::text
    )
  );

CREATE POLICY agricoop_notifications_self_mark_read
  ON agricoop_app.notifications FOR UPDATE TO authenticated
  USING (
    "userId" = (
      SELECT id FROM agricoop_app.users
      WHERE "openId" = (SELECT auth.uid())::text
    )
  )
  WITH CHECK (
    "userId" = (
      SELECT id FROM agricoop_app.users
      WHERE "openId" = (SELECT auth.uid())::text
    )
    AND "isRead" IN (0, 1)
  );

CREATE TRIGGER agricoop_profile_verification_guard
  BEFORE UPDATE OF "verificationStatus", "verificationNote", "verifiedBy", "verifiedAt", "birthdate", "phone", "address"
  ON agricoop_app.users
  FOR EACH ROW
  EXECUTE FUNCTION agricoop_app.guard_profile_verification_user_update();

CREATE TRIGGER agricoop_profile_verification_audit_event
  AFTER INSERT OR UPDATE OF "status"
  ON agricoop_app."profileVerificationSubmissions"
  FOR EACH ROW
  EXECUTE FUNCTION agricoop_app.write_profile_verification_audit_event();

DO $postflight$
BEGIN
  IF NOT has_schema_privilege('authenticated', 'agricoop_app', 'USAGE')
     OR NOT has_table_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'userId', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'storagePath', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'mimeType', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'fileSizeBytes', 'INSERT')
     OR has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'status', 'INSERT')
     OR has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'reviewedBy', 'INSERT')
     OR has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'reviewedAt', 'INSERT')
     OR has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'reviewNote', 'INSERT')
     OR has_table_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'INSERT')
     OR has_table_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'UPDATE')
     OR has_table_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'DELETE')
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'agricoop_app'
         AND tablename = 'profileVerificationSubmissions'
         AND policyname = 'agricoop_profile_verification_self_insert'
         AND with_check LIKE '%agricoop.profile_verification_upload_verified%'
     )
     OR NOT has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'status', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'verificationStatus', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.users', 'verifiedBy', 'UPDATE')
     OR has_any_column_privilege('authenticated', 'agricoop_app."auditLogs"', 'INSERT')
     OR NOT has_any_column_privilege('authenticated', 'agricoop_app.notifications', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'agricoop_app.notifications', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'agricoop_app.notifications', 'isRead', 'UPDATE')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'agricoop_app."profileVerificationSubmissions"'::regclass)
     OR NOT has_function_privilege('authenticated', 'agricoop_app.can_review_profile_verification_user(integer)', 'EXECUTE')
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger
       WHERE tgrelid = 'agricoop_app."profileVerificationSubmissions"'::regclass
         AND tgname = 'agricoop_profile_verification_audit_event'
         AND tgenabled = 'O'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'Profile-verification migration postcondition failed: required grants or RLS are missing';
  END IF;
END
$postflight$;

COMMIT;

-- Manual rollback only after confirming the table has no submissions:
-- DROP POLICY agricoop_profile_verification_admin_update ON agricoop_app."profileVerificationSubmissions";
-- DROP POLICY agricoop_notifications_self_mark_read ON agricoop_app.notifications;
-- DROP POLICY agricoop_notifications_self_read ON agricoop_app.notifications;
-- DROP POLICY agricoop_profile_verification_notification_insert ON agricoop_app.notifications;
-- DROP POLICY agricoop_profile_verification_self_insert ON agricoop_app."profileVerificationSubmissions";
-- DROP POLICY agricoop_profile_verification_admin_read ON agricoop_app."profileVerificationSubmissions";
-- DROP POLICY agricoop_profile_verification_self_select ON agricoop_app."profileVerificationSubmissions";
-- DROP POLICY agricoop_profile_verification_admin_update ON agricoop_app.users;
-- DROP POLICY agricoop_profile_verification_admin_select ON agricoop_app.users;
-- DROP TABLE agricoop_app."profileVerificationSubmissions";
-- DROP FUNCTION agricoop_app.can_review_profile_verification_user(integer);
-- DROP TRIGGER agricoop_profile_verification_guard ON agricoop_app.users;
-- DROP TRIGGER agricoop_profile_verification_audit_event ON agricoop_app."profileVerificationSubmissions";
-- DROP FUNCTION agricoop_app.write_profile_verification_audit_event();
-- DROP FUNCTION agricoop_app.guard_profile_verification_user_update();
-- Revoke only the exact grants above after comparing them with a pre-change ACL snapshot.
