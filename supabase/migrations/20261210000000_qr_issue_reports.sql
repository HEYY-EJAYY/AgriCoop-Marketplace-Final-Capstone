-- QR issue reports: buyers report unusable payment QR codes; cooperative
-- officers and superadmins triage them. Reports keep denormalized snapshots so
-- history survives payment-option edits or deletion.

CREATE TABLE agricoop_app."qrIssueReports" (
  "id" serial PRIMARY KEY,
  "paymentOptionId" integer REFERENCES agricoop_app."paymentOptions"("id") ON DELETE SET NULL,
  "cooperativeId" integer REFERENCES agricoop_app.cooperatives("id") ON DELETE SET NULL,
  "orderId" integer REFERENCES agricoop_app.orders("id") ON DELETE SET NULL,
  "reportedBy" integer REFERENCES agricoop_app.users("id") ON DELETE SET NULL,
  "paymentProvider" varchar(50),
  "paymentOptionLabel" varchar(150),
  "accountName" varchar(150),
  "accountNumber" varchar(100),
  "qrImagePath" text,
  "reason" varchar(60) NOT NULL,
  "details" text,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "adminNote" text,
  "reviewedBy" integer REFERENCES agricoop_app.users("id") ON DELETE SET NULL,
  "reviewedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "qrIssueReportsStatusCheck" CHECK ("status" IN ('pending', 'under_review', 'resolved', 'dismissed')),
  CONSTRAINT "qrIssueReportsReasonCheck" CHECK (length("reason") BETWEEN 3 AND 60)
);

CREATE INDEX "qrIssueReportsCooperativeIdIdx" ON agricoop_app."qrIssueReports" ("cooperativeId");
CREATE INDEX "qrIssueReportsStatusIdx" ON agricoop_app."qrIssueReports" ("status");
CREATE INDEX "qrIssueReportsPaymentOptionIdIdx" ON agricoop_app."qrIssueReports" ("paymentOptionId");
CREATE INDEX "qrIssueReportsReportedByIdx" ON agricoop_app."qrIssueReports" ("reportedBy");
CREATE INDEX "qrIssueReportsOrderIdIdx" ON agricoop_app."qrIssueReports" ("orderId");

ALTER TABLE agricoop_app."qrIssueReports" ENABLE ROW LEVEL SECURITY;

-- Reporters see their own reports; staff see reports in their cooperative scope.
CREATE POLICY agricoop_qr_reports_select
  ON agricoop_app."qrIssueReports" FOR SELECT TO authenticated
  USING (
    "reportedBy" = agricoop_app.current_app_user_id()
    OR (
      agricoop_app.is_staff()
      AND (agricoop_app.is_superadmin() OR agricoop_app.shares_cooperative("cooperativeId"))
    )
  );

CREATE POLICY agricoop_qr_reports_insert
  ON agricoop_app."qrIssueReports" FOR INSERT TO authenticated
  WITH CHECK ("reportedBy" = agricoop_app.current_app_user_id());

-- Staff triage only: status, note, reviewer fields (column grants enforce this).
CREATE POLICY agricoop_qr_reports_update
  ON agricoop_app."qrIssueReports" FOR UPDATE TO authenticated
  USING (
    agricoop_app.is_superadmin()
    OR agricoop_app.shares_cooperative("cooperativeId")
  )
  WITH CHECK (
    agricoop_app.is_superadmin()
    OR agricoop_app.shares_cooperative("cooperativeId")
  );

GRANT SELECT, INSERT ON TABLE agricoop_app."qrIssueReports" TO authenticated;
GRANT UPDATE (
  "status", "adminNote", "reviewedBy", "reviewedAt", "updatedAt"
) ON TABLE agricoop_app."qrIssueReports" TO authenticated;

DO $qr_reports_seq$
DECLARE
  target_sequence text;
BEGIN
  target_sequence := pg_get_serial_sequence('agricoop_app."qrIssueReports"', 'id');
  IF target_sequence IS NOT NULL THEN
    EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', target_sequence);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', target_sequence);
  END IF;
END
$qr_reports_seq$;

-- Extend the notification allowlist with qr_issue_reported.
-- Actor must be the reporter; recipient must be an approved admin of the same
-- cooperative or an approved superadmin.
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
    'product_fulfillment_classified',
    'product_rejected',
    'support_ticket_created',
    'support_ticket_assigned',
    'support_ticket_reply',
    'support_ticket_status',
    'order_status_updated',
    'quotation_updated',
    'new_message',
    'qr_issue_reported'
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
  ELSIF p_type IN ('product_approved', 'product_rejected', 'product_fulfillment_classified') THEN
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
  ELSIF p_type = 'qr_issue_reported' THEN
    allowed := EXISTS (
      SELECT 1
      FROM agricoop_app."qrIssueReports" r
      JOIN agricoop_app.users recipient ON recipient.id = p_user_id
      WHERE r.id = p_related_entity_id
        AND r."reportedBy" = actor_id
        AND p_user_id <> actor_id
        AND recipient."deletedAt" IS NULL
        AND (
          (recipient.role = 'superadmin' AND recipient."approvalStatus" = 'approved')
          OR (
            recipient.role = 'admin'
            AND recipient."approvalStatus" = 'approved'
            AND r."cooperativeId" IS NOT NULL
            AND recipient."cooperativeId" = r."cooperativeId"
          )
        )
    );
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
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION agricoop_app.create_notification(integer, varchar, varchar, text, varchar, integer, varchar) TO authenticated;
