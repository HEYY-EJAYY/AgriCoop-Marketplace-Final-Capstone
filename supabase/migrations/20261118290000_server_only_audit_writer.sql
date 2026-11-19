-- Require the application server's transaction-local audit marker for SECURITY DEFINER writes.
-- The legacy public.activity_logs table is not used by application code; app audit events
-- continue through agricoop_app.write_audit_log.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('agricoop_app."auditLogs"') IS NULL
     OR to_regprocedure('agricoop_app.current_app_user_id()') IS NULL
     OR to_regprocedure('agricoop_app.current_app_role()') IS NULL
     OR to_regprocedure('agricoop_app.write_audit_log(varchar,varchar,integer,integer,text)') IS NULL
     OR has_any_column_privilege('authenticated', 'agricoop_app."auditLogs"', 'INSERT')
     OR NOT has_function_privilege(
       'authenticated',
       'agricoop_app.write_audit_log(varchar,varchar,integer,integer,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'Server audit writer stopped: expected audit table, actor helpers, and function-only authenticated access';
  END IF;
END;
$preflight$;

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

DO $postflight$
BEGIN
  IF has_any_column_privilege('authenticated', 'agricoop_app."auditLogs"', 'INSERT')
     OR NOT has_function_privilege(
       'authenticated',
       'agricoop_app.write_audit_log(varchar,varchar,integer,integer,text)',
       'EXECUTE'
     )
     OR position(
       'agricoop.server_audit_write' IN pg_get_functiondef(
         to_regprocedure('agricoop_app.write_audit_log(varchar,varchar,integer,integer,text)')
       )
     ) = 0 THEN
    RAISE EXCEPTION 'Server audit writer verification failed';
  END IF;
END;
$postflight$;

COMMIT;
