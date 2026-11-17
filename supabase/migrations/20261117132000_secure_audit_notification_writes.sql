-- PURPOSE: Replace open notification INSERT and ordinary audit INSERT with SECURITY DEFINER writers.
-- DEPENDENCIES: 20261117105000, 20261117120000 (may have created verification-only notification INSERT policy),
--               20261117130000 helpers, 20261117131000 marketplace grants (SELECT on audit/notifications).
-- TOUCHES: DROP narrow notification INSERT policy; CREATE definer functions; optional INSERT policy for definer owner only is NOT used —
--          functions run as owner and bypass RLS; table INSERT remains revoked from authenticated.
-- DOES NOT TOUCH: Storage, enums, get_my_role(), verification audit trigger.
-- OWNER-RUN ONLY.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('agricoop_app."auditLogs"') IS NULL
     OR to_regclass('agricoop_app.notifications') IS NULL THEN
    RAISE EXCEPTION 'Secure writers stopped: auditLogs/notifications missing';
  END IF;
  IF to_regprocedure('agricoop_app.current_app_user_id()') IS NULL THEN
    RAISE EXCEPTION 'Secure writers stopped: helpers missing (run 20261117130000)';
  END IF;
  IF has_table_privilege('authenticated', 'agricoop_app."auditLogs"', 'INSERT') THEN
    RAISE EXCEPTION 'Secure writers stopped: authenticated still has auditLogs INSERT; reconcile grants first';
  END IF;
END
$preflight$;

-- Drop verification-only / marketplace notification INSERT policies so clients cannot INSERT directly.
DROP POLICY IF EXISTS agricoop_profile_verification_notification_insert ON agricoop_app.notifications;
DROP POLICY IF EXISTS agricoop_mkt_notifications_insert ON agricoop_app.notifications;

-- Keep self read/mark-read from either migration name set.
-- (If both exist, both are OR'd; harmless.)

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
AS $fn$
DECLARE
  actor_id integer := agricoop_app.current_app_user_id();
  actor_role text := agricoop_app.current_app_role();
  new_id bigint;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Audit write requires an authenticated application user';
  END IF;
  IF p_action IS NULL OR length(btrim(p_action)) = 0 OR length(p_action) > 100 THEN
    RAISE EXCEPTION 'Audit action is invalid';
  END IF;
  IF p_entity_type IS NULL OR length(btrim(p_entity_type)) = 0 OR length(p_entity_type) > 50 THEN
    RAISE EXCEPTION 'Audit entity type is invalid';
  END IF;
  -- Allow-list of application audit actions used by routers.ts
  IF p_action NOT IN (
    'product.content_revised_for_review',
    'product_approved',
    'product_rejected',
    'cooperative_association_requested',
    'cooperative_association_approved',
    'cooperative_association_rejected',
    'member_approval_status_updated',
    'user_access_updated',
    'support_ticket_created',
    'support_ticket_assigned',
    'support_ticket_reply_sent',
    'support_ticket_status_updated',
    'cooperative_updated',
    'cooperative_deactivated',
    'cooperative_activated'
  ) THEN
    RAISE EXCEPTION 'Audit action is not permitted';
  END IF;
  IF actor_role NOT IN ('seller', 'admin', 'superadmin', 'buyer') THEN
    RAISE EXCEPTION 'Audit actor role is not permitted';
  END IF;

  INSERT INTO agricoop_app."auditLogs" (
    "actorUserId", "action", "entityType", "entityId", "cooperativeId", "metadata"
  ) VALUES (
    actor_id, p_action, p_entity_type, p_entity_id, p_cooperative_id, p_metadata
  ) RETURNING id INTO new_id;

  RETURN new_id;
END
$fn$;

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

  -- Relationship checks by type family
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
    "userId", "type", "title", "content", "link", "relatedEntityId", "relatedEntityType"
  ) VALUES (
    p_user_id, p_type, p_title, p_content, p_link, p_related_entity_id, p_related_entity_type
  ) RETURNING id INTO new_id;

  RETURN new_id;
END
$fn$;

REVOKE ALL ON FUNCTION agricoop_app.write_audit_log(varchar, varchar, integer, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION agricoop_app.create_notification(integer, varchar, varchar, text, varchar, integer, varchar)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION agricoop_app.write_audit_log(varchar, varchar, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION agricoop_app.create_notification(integer, varchar, varchar, text, varchar, integer, varchar) TO authenticated;

-- Ensure authenticated cannot INSERT notifications directly (definer only)
REVOKE INSERT ON TABLE agricoop_app.notifications FROM PUBLIC, anon, authenticated, service_role;

DO $postflight$
BEGIN
  IF has_any_column_privilege('authenticated', 'agricoop_app.notifications', 'INSERT')
     OR has_any_column_privilege('authenticated', 'agricoop_app."auditLogs"', 'INSERT') THEN
    RAISE EXCEPTION 'Secure writers postflight failed: client INSERT still granted';
  END IF;
  IF to_regprocedure('agricoop_app.write_audit_log(varchar,varchar,integer,integer,text)') IS NULL
     OR to_regprocedure('agricoop_app.create_notification(integer,varchar,varchar,text,varchar,integer,varchar)') IS NULL THEN
    RAISE EXCEPTION 'Secure writers postflight failed: functions missing';
  END IF;
END
$postflight$;

COMMIT;

-- Verification:
-- SELECT has_any_column_privilege('authenticated','agricoop_app.notifications','INSERT'); -- false
-- SELECT has_function_privilege('authenticated','agricoop_app.create_notification(integer,varchar,varchar,text,varchar,integer,varchar)','EXECUTE'); -- true

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS agricoop_app.create_notification(integer,varchar,varchar,text,varchar,integer,varchar);
-- DROP FUNCTION IF EXISTS agricoop_app.write_audit_log(varchar,varchar,integer,integer,text);
-- Recreate agricoop_profile_verification_notification_insert from 20261117120000 if needed.
