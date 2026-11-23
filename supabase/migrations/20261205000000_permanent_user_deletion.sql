-- Permanent account deletion support.
--
-- Personal-data tables keep NO ACTION FKs (the application deletes those rows
-- explicitly). Retained financial/history tables get nullable user references
-- with ON DELETE SET NULL so deleting agricoop_app.users anonymizes rather than
-- blocks or cascades financial records.

-- 1) Drop NOT NULL on retained-history user references.
ALTER TABLE agricoop_app.orders ALTER COLUMN "buyerId" DROP NOT NULL;
ALTER TABLE agricoop_app.orders ALTER COLUMN "sellerId" DROP NOT NULL;
ALTER TABLE agricoop_app.transactions ALTER COLUMN "buyerId" DROP NOT NULL;
ALTER TABLE agricoop_app.transactions ALTER COLUMN "sellerId" DROP NOT NULL;
ALTER TABLE agricoop_app.payments ALTER COLUMN "buyerId" DROP NOT NULL;
ALTER TABLE agricoop_app.payments ALTER COLUMN "sellerId" DROP NOT NULL;
ALTER TABLE agricoop_app."paymentProofs" ALTER COLUMN "uploadedBy" DROP NOT NULL;
ALTER TABLE agricoop_app."orderEvents" ALTER COLUMN "actorUserId" DROP NOT NULL;
ALTER TABLE agricoop_app."auditLogs" ALTER COLUMN "actorUserId" DROP NOT NULL;
ALTER TABLE agricoop_app."systemPaymentSettingsAudit" ALTER COLUMN "actorUserId" DROP NOT NULL;
ALTER TABLE agricoop_app.products ALTER COLUMN "sellerId" DROP NOT NULL;

-- 2) Re-create FKs with ON DELETE SET NULL for retained-history references.
-- Drops every existing FK on the target columns (any naming variant), then adds
-- one canonical constraint per column. Personal-data tables are untouched.
DO $$
DECLARE
  target record;
  fk record;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('auditLogs','actorUserId'),
      ('cooperativeAdminApplications','reviewedBy'),
      ('cooperativeAssociationRequests','reviewedBy'),
      ('orderEvents','actorUserId'),
      ('orderHistory','actorUserId'),
      ('paymentEvents','actorUserId'),
      ('paymentProofs','uploadedBy'),
      ('supportTickets','assignedToUserId'),
      ('systemOnlinePaymentAccounts','updatedBy'),
      ('systemOnlinePaymentAccounts','createdBy'),
      ('systemPaymentSettings','updatedBy'),
      ('systemPaymentSettingsAudit','actorUserId'),
      ('cooperatives','deletedBy'),
      ('cooperatives','createdBy'),
      ('orders','sellerId'),
      ('orders','buyerId'),
      ('payments','buyerId'),
      ('payments','verifiedByUserId'),
      ('payments','sellerId'),
      ('products','sellerId'),
      ('products','deletedBy'),
      ('transactions','sellerId'),
      ('transactions','buyerId'),
      ('users','verifiedBy'),
      ('users','deletedBy')
    ) AS t(tbl, col)
  LOOP
    FOR fk IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND c.confrelid = 'agricoop_app.users'::regclass
        AND c.conrelid = ('agricoop_app.' || quote_ident(target.tbl))::regclass
        AND a.attname = target.col
    LOOP
      EXECUTE format('ALTER TABLE agricoop_app.%I DROP CONSTRAINT %I', target.tbl, fk.conname);
    END LOOP;
    EXECUTE format(
      'ALTER TABLE agricoop_app.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES agricoop_app.users(id) ON DELETE SET NULL',
      target.tbl,
      target.tbl || '_' || target.col || '_users_id_fkey',
      target.col
    );
  END LOOP;
END $$;

-- 3) Allow the permanent-deletion audit action.
CREATE OR REPLACE FUNCTION agricoop_app.write_audit_log(
  p_action varchar,
  p_entity_type varchar,
  p_entity_id integer DEFAULT NULL,
  p_cooperative_id integer DEFAULT NULL,
  p_metadata text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id integer := agricoop_app.current_app_user_id();
  actor_role text := agricoop_app.current_app_role();
  new_id bigint;
BEGIN
  IF current_setting('agricoop.server_audit_write', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Audit writes require the trusted application server path'
      USING ERRCODE = '42501';
  END IF;
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Audit write requires an authenticated application user'
      USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR length(btrim(p_action)) = 0 OR length(p_action) > 100 THEN
    RAISE EXCEPTION 'Audit action is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_entity_type IS NULL OR length(btrim(p_entity_type)) = 0 OR length(p_entity_type) > 50 THEN
    RAISE EXCEPTION 'Audit entity type is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_action NOT IN (
    'product.content_revised_for_review',
    'product_approved',
    'product_rejected',
    'product_hidden',
    'product_fulfillment_classified',
    'cooperative_association_requested',
    'cooperative_association_approved',
    'cooperative_association_rejected',
    'member_approval_status_updated',
    'user_access_updated',
    'user_soft_deleted',
    'user_deleted',
    'user_restored',
    'user_role_reconciled',
    'support_ticket_created',
    'support_ticket_assigned',
    'support_ticket_reply_sent',
    'support_ticket_status_updated',
    'cooperative_updated',
    'cooperative_deactivated',
    'cooperative_activated',
    'cooperative_soft_deleted',
    'cooperative_restored'
  ) THEN
    RAISE EXCEPTION 'Audit action is not permitted'
      USING ERRCODE = '42501';
  END IF;
  IF actor_role NOT IN ('seller', 'admin', 'superadmin', 'buyer') THEN
    RAISE EXCEPTION 'Audit actor role is not permitted'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO agricoop_app."auditLogs" (
    "actorUserId", "action", "entityType", "entityId", "cooperativeId", "metadata"
  ) VALUES (
    actor_id, p_action, p_entity_type, p_entity_id, p_cooperative_id, p_metadata
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;

REVOKE ALL ON FUNCTION agricoop_app.write_audit_log(varchar, varchar, integer, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION agricoop_app.write_audit_log(varchar, varchar, integer, integer, text)
  TO authenticated;

-- 5) Atomic permanent-delete purge. Request-scoped connections run as
-- `authenticated`, which holds no DELETE grants on personal-data tables, so all
-- row removals happen inside this SECURITY DEFINER function (table-owner
-- privileges bypass RLS). Guards mirror server/userSoftDelete.ts.
CREATE OR REPLACE FUNCTION agricoop_app.purge_user_account(p_user_id integer, p_actor_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_role text := agricoop_app.current_app_role();
  v_actor_id integer := agricoop_app.current_app_user_id();
  v_actor_coop integer := agricoop_app.current_app_cooperative_id();
  v_target record;
  v_coop_doc_paths text[];
  v_verification_paths text[];
BEGIN
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Only cooperative officers or superadmins can permanently delete accounts'
      USING ERRCODE = '42501';
  END IF;
  IF v_actor_id IS NULL OR p_actor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'Audit actor mismatch'
      USING ERRCODE = '42501';
  END IF;

  SELECT u.id, u."openId", u."role"::text AS role, u."cooperativeId", u."loginMethod"
    INTO v_target
    FROM agricoop_app.users u
    WHERE u.id = p_user_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_user_id = v_actor_id THEN
    RAISE EXCEPTION 'You cannot delete your own account' USING ERRCODE = '42501';
  END IF;
  IF v_target.role = 'superadmin' THEN
    RAISE EXCEPTION 'SuperAdmin accounts cannot be deleted' USING ERRCODE = '42501';
  END IF;
  IF v_actor_role = 'admin'
     AND (v_target.role NOT IN ('buyer', 'seller')
          OR v_actor_coop IS DISTINCT FROM v_target."cooperativeId") THEN
    RAISE EXCEPTION 'You cannot delete this user' USING ERRCODE = '42501';
  END IF;

  -- Collect private document paths for post-commit storage cleanup.
  SELECT coalesce(array_agg(DISTINCT p) FILTER (WHERE p IS NOT NULL), '{}')
    INTO v_coop_doc_paths
    FROM agricoop_app."cooperativeAdminApplications" a,
         LATERAL (VALUES (a."idDocumentPath"), (a."proofDocumentPath")) AS v(p)
    WHERE a."userId" = p_user_id;
  SELECT coalesce(array_agg(s."storagePath"), '{}')
    INTO v_verification_paths
    FROM agricoop_app."profileVerificationSubmissions" s
    WHERE s."userId" = p_user_id;

  -- Personal data: remove rows that exist only for this user.
  DELETE FROM agricoop_app."conversationMessages" m
    WHERE m."senderId" = p_user_id
       OR m."conversationId" IN (
         SELECT c.id FROM agricoop_app.conversations c
         WHERE c."buyerId" = p_user_id OR c."sellerId" = p_user_id
       );
  DELETE FROM agricoop_app.conversations c
    WHERE c."buyerId" = p_user_id OR c."sellerId" = p_user_id;
  DELETE FROM agricoop_app."supportTicketMessages" WHERE "senderId" = p_user_id;
  DELETE FROM agricoop_app."supportTickets" WHERE "userId" = p_user_id;
  DELETE FROM agricoop_app.notifications WHERE "userId" = p_user_id;
  DELETE FROM agricoop_app."cartItems" WHERE "userId" = p_user_id;
  DELETE FROM agricoop_app."threadStates" WHERE "userId" = p_user_id;
  DELETE FROM agricoop_app."cooperativeAdminApplications" WHERE "userId" = p_user_id;
  DELETE FROM agricoop_app."profileVerificationSubmissions" WHERE "userId" = p_user_id;
  DELETE FROM agricoop_app.quotations WHERE "buyerId" = p_user_id OR "sellerId" = p_user_id;
  DELETE FROM agricoop_app."cooperativeAssociationRequests" WHERE "sellerId" = p_user_id;

  -- Listings stay for order history but are detached and hidden.
  UPDATE agricoop_app.products
    SET "sellerId" = NULL,
        "deletedAt" = now(),
        "deletedBy" = p_actor_id,
        "visibility" = 'hidden',
        "status" = 'archived'
    WHERE "sellerId" = p_user_id AND "deletedAt" IS NULL;

  -- Public profile mapping. Supabase-backed accounts rely on the
  -- auth.users -> public.profiles cascade when the Auth user is deleted
  -- post-commit; deleting the profile row here would hold an uncommitted lock
  -- that deadlocks GoTrue's cascade (observed as HTTP 504). Non-Supabase
  -- (demo/seeded) accounts have no Auth user, so their profile is removed
  -- directly when the openId is a valid uuid.
  IF v_target."loginMethod" IS DISTINCT FROM 'supabase'
     AND v_target."openId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    DELETE FROM public.profiles WHERE user_id = v_target."openId"::uuid;
  END IF;
  DELETE FROM agricoop_app.users WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'coopDocumentPaths', to_jsonb(v_coop_doc_paths),
    'verificationPaths', to_jsonb(v_verification_paths)
  );
END;
$function$;

REVOKE ALL ON FUNCTION agricoop_app.purge_user_account(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION agricoop_app.purge_user_account(integer, integer) TO authenticated;
