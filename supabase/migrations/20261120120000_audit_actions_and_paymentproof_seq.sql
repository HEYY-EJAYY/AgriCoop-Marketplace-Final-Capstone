-- Two production fixes:
-- 1) write_audit_log rejected legitimate admin actions (user_soft_deleted,
--    user_restored, user_role_reconciled, product_hidden) with 42501, which
--    surfaced as HTTP 500 on admin.softDeleteUser / restoreUser /
--    reconcileRole / product hide. Extend the allowlist with exactly the
--    actions the application emits through recordAuditLog.
-- 2) paymentProofs.id has a nextval default, but authenticated lacked USAGE on
--    the sequence and the sequence had fallen behind max(id) because the app
--    previously computed ids manually under an RLS-filtered max() read. Resync
--    the sequence and grant USAGE so default allocation is safe.

BEGIN;

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
    'cooperative_association_requested',
    'cooperative_association_approved',
    'cooperative_association_rejected',
    'member_approval_status_updated',
    'user_access_updated',
    'user_soft_deleted',
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

-- Resync paymentProofs.id sequence with existing rows, then allow the
-- authenticated role to draw ids from it.
SELECT setval(
  'agricoop_app."paymentProofs_id_seq"',
  GREATEST((SELECT COALESCE(max(id), 0) FROM agricoop_app."paymentProofs"), 1)
);

GRANT USAGE ON SEQUENCE agricoop_app."paymentProofs_id_seq" TO authenticated;

COMMIT;
