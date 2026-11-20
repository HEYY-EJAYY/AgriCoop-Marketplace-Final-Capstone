-- Product fulfillment classification (On-Hand ready stock vs Order-Based
-- prepared after order) plus an order-item snapshot column and the audit
-- action used when an officer verifies/reclassifies a listing.
--
-- Existing products default to 'on_hand' (Ready Stock), which matches the
-- stock-reservation behavior they already had; nothing is silently
-- reclassified. Historical order items are backfilled from their product.

BEGIN;

ALTER TABLE agricoop_app.products
  ADD COLUMN IF NOT EXISTS "fulfillmentType" varchar(20) NOT NULL DEFAULT 'on_hand',
  ADD COLUMN IF NOT EXISTS "prepTimeDays" integer,
  ADD COLUMN IF NOT EXISTS "capacityNote" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_fulfillment_type_check'
      AND conrelid = 'agricoop_app.products'::regclass
  ) THEN
    ALTER TABLE agricoop_app.products
      ADD CONSTRAINT products_fulfillment_type_check
      CHECK ("fulfillmentType" IN ('on_hand', 'order_based'));
  END IF;
END $$;

ALTER TABLE agricoop_app."orderItems"
  ADD COLUMN IF NOT EXISTS "fulfillmentType" varchar(20);

UPDATE agricoop_app."orderItems" oi
SET "fulfillmentType" = p."fulfillmentType"
FROM agricoop_app.products p
WHERE p.id = oi."productId"
  AND oi."fulfillmentType" IS NULL;

-- Extend the trusted audit writer allowlist with the classification action.
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

COMMIT;
