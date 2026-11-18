-- BLOCK 20: Part 2 — cooperative provenance, Cooperative Admin applications,
-- private application document bucket, notification allowlist, buyer order archive via threadStates.
-- Additive + idempotent. No DROP / TRUNCATE / unscoped DELETE.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Cooperatives: createdBy + source (user | staff | seed)
-- ---------------------------------------------------------------------------
ALTER TABLE agricoop_app.cooperatives
  ADD COLUMN IF NOT EXISTS "createdBy" integer REFERENCES agricoop_app.users(id);
ALTER TABLE agricoop_app.cooperatives
  ADD COLUMN IF NOT EXISTS source varchar(32) NOT NULL DEFAULT 'seed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cooperatives_source_check'
      AND conrelid = 'agricoop_app.cooperatives'::regclass
  ) THEN
    ALTER TABLE agricoop_app.cooperatives
      ADD CONSTRAINT cooperatives_source_check
      CHECK (source IN ('user', 'staff', 'seed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cooperatives_created_by_idx
  ON agricoop_app.cooperatives ("createdBy");

-- ---------------------------------------------------------------------------
-- 2) Users: requestedRole for Cooperative Admin applicants (never grants privilege alone)
-- ---------------------------------------------------------------------------
ALTER TABLE agricoop_app.users
  ADD COLUMN IF NOT EXISTS "requestedRole" agricoop_app.user_role;

-- ---------------------------------------------------------------------------
-- 3) Cooperative Admin applications
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regtype('agricoop_app.coop_admin_application_status') IS NULL THEN
    CREATE TYPE agricoop_app.coop_admin_application_status AS ENUM (
      'awaiting_documents',
      'pending',
      'approved',
      'rejected'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agricoop_app."cooperativeAdminApplications" (
  id serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES agricoop_app.users(id),
  "fullName" varchar(180) NOT NULL,
  "cooperativeId" integer NOT NULL REFERENCES agricoop_app.cooperatives(id),
  "positionTitle" varchar(180) NOT NULL DEFAULT '',
  "idDocumentPath" text,
  "proofDocumentPath" text,
  status agricoop_app.coop_admin_application_status NOT NULL DEFAULT 'awaiting_documents',
  "rejectionReason" text,
  "reviewedBy" integer REFERENCES agricoop_app.users(id),
  "reviewedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coop_admin_apps_user_idx
  ON agricoop_app."cooperativeAdminApplications" ("userId");
CREATE INDEX IF NOT EXISTS coop_admin_apps_status_idx
  ON agricoop_app."cooperativeAdminApplications" (status);
CREATE UNIQUE INDEX IF NOT EXISTS coop_admin_apps_one_open_per_user_uidx
  ON agricoop_app."cooperativeAdminApplications" ("userId")
  WHERE status IN ('awaiting_documents', 'pending');

ALTER TABLE agricoop_app."cooperativeAdminApplications" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE agricoop_app."cooperativeAdminApplications" FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, "userId", "fullName", "cooperativeId", "positionTitle",
  "idDocumentPath", "proofDocumentPath", status, "rejectionReason",
  "reviewedBy", "reviewedAt", "createdAt", "updatedAt"
) ON TABLE agricoop_app."cooperativeAdminApplications" TO authenticated;
GRANT INSERT (
  "userId", "fullName", "cooperativeId", "positionTitle",
  "idDocumentPath", "proofDocumentPath", status
) ON TABLE agricoop_app."cooperativeAdminApplications" TO authenticated;
GRANT UPDATE (
  "fullName", "cooperativeId", "positionTitle",
  "idDocumentPath", "proofDocumentPath", status, "rejectionReason",
  "reviewedBy", "reviewedAt", "updatedAt"
) ON TABLE agricoop_app."cooperativeAdminApplications" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE agricoop_app."cooperativeAdminApplications_id_seq" TO authenticated;

DROP POLICY IF EXISTS coop_admin_apps_select ON agricoop_app."cooperativeAdminApplications";
CREATE POLICY coop_admin_apps_select
  ON agricoop_app."cooperativeAdminApplications"
  FOR SELECT TO authenticated
  USING (
    "userId" = agricoop_app.current_app_user_id()
    OR agricoop_app.is_superadmin()
  );

DROP POLICY IF EXISTS coop_admin_apps_insert ON agricoop_app."cooperativeAdminApplications";
CREATE POLICY coop_admin_apps_insert
  ON agricoop_app."cooperativeAdminApplications"
  FOR INSERT TO authenticated
  WITH CHECK (
    "userId" = agricoop_app.current_app_user_id()
    AND status IN ('awaiting_documents', 'pending')
  );

DROP POLICY IF EXISTS coop_admin_apps_update_own ON agricoop_app."cooperativeAdminApplications";
CREATE POLICY coop_admin_apps_update_own
  ON agricoop_app."cooperativeAdminApplications"
  FOR UPDATE TO authenticated
  USING (
    ("userId" = agricoop_app.current_app_user_id() AND status IN ('awaiting_documents', 'rejected'))
    OR agricoop_app.is_superadmin()
  )
  WITH CHECK (
    ("userId" = agricoop_app.current_app_user_id() AND status IN ('awaiting_documents', 'pending', 'rejected'))
    OR agricoop_app.is_superadmin()
  );

-- Keep anon read-only. Authenticated may INSERT user/staff-proposed cooperatives under RLS
-- (public visitors never hold a JWT → no direct write).
REVOKE INSERT ON TABLE agricoop_app.cooperatives FROM anon;
GRANT SELECT ("createdBy", source) ON TABLE agricoop_app.cooperatives TO anon, authenticated;
GRANT INSERT (
  "name", "normalizedName", description, location, status, "createdBy", source
) ON TABLE agricoop_app.cooperatives TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE agricoop_app.cooperatives_id_seq TO authenticated;

DROP POLICY IF EXISTS cooperatives_authenticated_insert ON agricoop_app.cooperatives;
CREATE POLICY cooperatives_authenticated_insert
  ON agricoop_app.cooperatives
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      source = 'user'
      AND "createdBy" = agricoop_app.current_app_user_id()
    )
    OR (
      source = 'staff'
      AND agricoop_app.is_superadmin()
    )
  );

-- SECURITY DEFINER helper so registration can create user-proposed cooperatives
-- after the applicant user row exists (sets createdBy from current_app_user_id).
CREATE OR REPLACE FUNCTION agricoop_app.create_user_cooperative(
  p_name varchar,
  p_normalized_name varchar,
  p_location varchar,
  p_description text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  actor_id integer := agricoop_app.current_app_user_id();
  new_id integer;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Cooperative creation requires an authenticated application user';
  END IF;
  INSERT INTO agricoop_app.cooperatives (
    name, "normalizedName", location, description, status, source, "createdBy"
  ) VALUES (
    p_name, p_normalized_name, p_location, p_description, 'active', 'user', actor_id
  )
  ON CONFLICT ("normalizedName") DO UPDATE
    SET name = agricoop_app.cooperatives.name
  RETURNING id INTO new_id;
  RETURN new_id;
END
$fn$;

REVOKE ALL ON FUNCTION agricoop_app.create_user_cooperative(varchar, varchar, varchar, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION agricoop_app.create_user_cooperative(varchar, varchar, varchar, text)
  TO authenticated;

-- requestedRole column grants for authenticated self-read + registration insert
GRANT SELECT ("requestedRole") ON TABLE agricoop_app.users TO authenticated;
GRANT INSERT ("requestedRole") ON TABLE agricoop_app.users TO authenticated;
GRANT UPDATE ("requestedRole") ON TABLE agricoop_app.users TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Private storage bucket for application documents
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'coop-admin-applications',
  'coop-admin-applications',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'coop_admin_apps_owner_insert'
  ) THEN
    CREATE POLICY coop_admin_apps_owner_insert
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'coop-admin-applications'
        AND split_part(name, '/', 1) = (SELECT auth.uid()::text)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'coop_admin_apps_owner_update'
  ) THEN
    CREATE POLICY coop_admin_apps_owner_update
      ON storage.objects FOR UPDATE TO authenticated
      USING (
        bucket_id = 'coop-admin-applications'
        AND split_part(name, '/', 1) = (SELECT auth.uid()::text)
      )
      WITH CHECK (
        bucket_id = 'coop-admin-applications'
        AND split_part(name, '/', 1) = (SELECT auth.uid()::text)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'coop_admin_apps_owner_select'
  ) THEN
    CREATE POLICY coop_admin_apps_owner_select
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'coop-admin-applications'
        AND split_part(name, '/', 1) = (SELECT auth.uid()::text)
      );
  END IF;
END $$;

-- SuperAdmin storage reads go through service-role signed URLs after server authz
-- (no Officer Admin / buyer / seller read policy on this bucket).

-- ---------------------------------------------------------------------------
-- 5) Notification allowlist: Cooperative Admin application events
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION agricoop_app.create_notification(
  p_user_id integer,
  p_type varchar,
  p_title varchar,
  p_content text,
  p_link varchar DEFAULT NULL,
  p_related_entity_id integer DEFAULT NULL,
  p_related_entity_type varchar DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  actor_id integer := agricoop_app.current_app_user_id();
  actor_role text := agricoop_app.current_app_role();
  new_id bigint;
  allowed boolean := false;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Notification write requires an authenticated application user';
  END IF;
  IF p_user_id IS NULL OR p_type IS NULL OR p_title IS NULL OR p_content IS NULL THEN
    RAISE EXCEPTION 'Notification payload is incomplete';
  END IF;
  IF length(p_type) > 50 OR length(p_title) > 255 THEN
    RAISE EXCEPTION 'Notification fields exceed allowed length';
  END IF;

  IF p_type NOT IN (
    'profile_verification_submitted',
    'profile_verification_approved',
    'profile_verification_rejected',
    'payment_proof_submitted',
    'payment_proof_verified',
    'payment_proof_rejected',
    'cash_payment_received',
    'cooperative_association_request',
    'cooperative_association_approved',
    'cooperative_association_rejected',
    'cooperative_admin_application_submitted',
    'cooperative_admin_application_approved',
    'cooperative_admin_application_rejected',
    'account_approval_status',
    'account_access_updated',
    'product_approved',
    'product_rejected',
    'support_ticket_created',
    'support_ticket_assigned',
    'support_ticket_reply',
    'support_ticket_status',
    'order_status_updated',
    'quotation_updated',
    'new_message'
  ) THEN
    RAISE EXCEPTION 'Notification type is not permitted';
  END IF;

  IF p_type LIKE 'profile_verification_%' THEN
    allowed := (
      (p_type = 'profile_verification_submitted' AND p_user_id = actor_id)
      OR (p_type IN ('profile_verification_approved', 'profile_verification_rejected') AND actor_role IN ('admin', 'superadmin'))
    );
  ELSIF p_type LIKE 'payment_proof_%' OR p_type = 'cash_payment_received' THEN
    allowed := EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = p_related_entity_id
        AND o."buyerId" = p_user_id
        AND (
          o."buyerId" = actor_id
          OR o."sellerId" = actor_id
          OR agricoop_app.shares_cooperative(o."cooperativeId")
          OR agricoop_app.is_superadmin()
        )
    );
  ELSIF p_type LIKE 'cooperative_association_%' THEN
    allowed := (
      (p_type = 'cooperative_association_request' AND actor_role = 'seller' AND EXISTS (
        SELECT 1 FROM agricoop_app."cooperativeAssociationRequests" r
        WHERE r.id = p_related_entity_id AND r."sellerId" = actor_id AND p_user_id <> actor_id
      ))
      OR (p_type IN ('cooperative_association_approved', 'cooperative_association_rejected')
          AND actor_role IN ('admin', 'superadmin')
          AND EXISTS (
            SELECT 1 FROM agricoop_app."cooperativeAssociationRequests" r
            WHERE r.id = p_related_entity_id AND r."sellerId" = p_user_id
              AND (agricoop_app.shares_cooperative(r."cooperativeId") OR agricoop_app.is_superadmin())
          ))
    );
  ELSIF p_type LIKE 'cooperative_admin_application_%' THEN
    allowed := (
      (p_type = 'cooperative_admin_application_submitted'
        AND EXISTS (
          SELECT 1 FROM agricoop_app."cooperativeAdminApplications" a
          WHERE a.id = p_related_entity_id AND a."userId" = actor_id
        )
        AND (
          p_user_id = actor_id
          OR EXISTS (
            SELECT 1 FROM agricoop_app.users u
            WHERE u.id = p_user_id AND u.role = 'superadmin' AND u."approvalStatus" = 'approved'
          )
        ))
      OR (p_type IN ('cooperative_admin_application_approved', 'cooperative_admin_application_rejected')
          AND actor_role = 'superadmin'
          AND EXISTS (
            SELECT 1 FROM agricoop_app."cooperativeAdminApplications" a
            WHERE a.id = p_related_entity_id AND a."userId" = p_user_id
          ))
    );
  ELSIF p_type IN ('account_approval_status', 'account_access_updated') THEN
    allowed := actor_role IN ('admin', 'superadmin') AND p_user_id <> actor_id;
  ELSIF p_type IN ('product_approved', 'product_rejected') THEN
    allowed := actor_role IN ('admin', 'superadmin') AND EXISTS (
      SELECT 1 FROM agricoop_app.products p
      WHERE p.id = p_related_entity_id AND p."sellerId" = p_user_id
        AND (agricoop_app.shares_cooperative(p."cooperativeId") OR agricoop_app.is_superadmin())
    );
  ELSIF p_type LIKE 'support_ticket_%' THEN
    allowed := EXISTS (
      SELECT 1 FROM agricoop_app."supportTickets" t
      WHERE (p_related_entity_id IS NULL OR t.id = p_related_entity_id)
        AND (
          (p_type = 'support_ticket_created' AND t."userId" = actor_id)
          OR actor_role IN ('admin', 'superadmin')
          OR t."userId" = actor_id
        )
    ) OR (p_type = 'support_ticket_created' AND p_user_id <> actor_id AND actor_id IS NOT NULL);
  ELSIF p_type IN ('order_status_updated', 'quotation_updated', 'new_message') THEN
    allowed := actor_id IS NOT NULL;
  ELSE
    allowed := false;
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Notification relationship check failed for type %', p_type;
  END IF;

  INSERT INTO agricoop_app.notifications (
    "userId", type, title, content, link, "relatedEntityId", "relatedEntityType"
  ) VALUES (
    p_user_id, p_type, p_title, p_content, p_link, p_related_entity_id, p_related_entity_type
  ) RETURNING id INTO new_id;

  RETURN new_id;
END
$fn$;

REVOKE ALL ON FUNCTION agricoop_app.create_notification(integer, varchar, varchar, text, varchar, integer, varchar)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION agricoop_app.create_notification(integer, varchar, varchar, text, varchar, integer, varchar)
  TO authenticated;

COMMIT;
