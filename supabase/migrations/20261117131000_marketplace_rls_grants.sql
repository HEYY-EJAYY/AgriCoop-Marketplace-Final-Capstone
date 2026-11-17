-- PURPOSE: Least-privilege GRANTs + RLS for existing marketplace tables and the 8 active-application tables.
-- DEPENDENCIES: 20261117100000 (auth), 20261117105000 (new tables), 20261117110000 (txn option),
--               20261117120000 (verification), 20261117130000 (helpers).
-- TOUCHES: ENABLE RLS, REVOKE broad privileges, GRANT column/table privileges, CREATE POLICY.
-- DOES NOT TOUCH: Storage, enum ADD VALUE, get_my_role(), row data, profile-verification policies (kept).
-- SKIP drafts: none of the four November drafts — run them first if not applied.
-- OWNER-RUN ONLY after catalog preflight + backup/PITR.

BEGIN;

DO $preflight$
DECLARE
  missing text[];
BEGIN
  IF to_regprocedure('agricoop_app.current_app_user_id()') IS NULL
     OR to_regprocedure('agricoop_app.shares_cooperative(integer)') IS NULL THEN
    RAISE EXCEPTION 'Marketplace RLS stopped: run 20261117130000 helpers first';
  END IF;

  SELECT array_agg(t) INTO missing
  FROM unnest(ARRAY[
    'agricoop_app.cooperatives',
    'agricoop_app.users',
    'agricoop_app.products',
    'agricoop_app.orders',
    'agricoop_app."orderItems"',
    'agricoop_app."orderEvents"',
    'agricoop_app.transactions',
    'agricoop_app."paymentOptions"',
    'agricoop_app."paymentProofs"',
    'agricoop_app.quotations',
    'agricoop_app.conversations',
    'agricoop_app."conversationMessages"',
    'agricoop_app."cooperativeAssociationRequests"',
    'agricoop_app."productImages"',
    'agricoop_app.payments',
    'agricoop_app."paymentEvents"',
    'agricoop_app.notifications',
    'agricoop_app."supportTickets"',
    'agricoop_app."supportTicketMessages"',
    'agricoop_app."auditLogs"'
  ]) AS t
  WHERE to_regclass(t) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Marketplace RLS stopped: missing tables %', missing;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'Marketplace RLS stopped: anon/authenticated roles missing';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- Enable RLS on marketplace tables (idempotent)
-- ---------------------------------------------------------------------------
DO $enable_rls$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'agricoop_app.cooperatives',
    'agricoop_app.products',
    'agricoop_app."productImages"',
    'agricoop_app.quotations',
    'agricoop_app.orders',
    'agricoop_app."orderItems"',
    'agricoop_app."orderEvents"',
    'agricoop_app.transactions',
    'agricoop_app."paymentOptions"',
    'agricoop_app."paymentProofs"',
    'agricoop_app.conversations',
    'agricoop_app."conversationMessages"',
    'agricoop_app."cooperativeAssociationRequests"',
    'agricoop_app.payments',
    'agricoop_app."paymentEvents"',
    'agricoop_app.notifications',
    'agricoop_app."supportTickets"',
    'agricoop_app."supportTicketMessages"',
    'agricoop_app."auditLogs"'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  END LOOP;
END
$enable_rls$;

-- ---------------------------------------------------------------------------
-- Revoke broad table privileges then grant least privilege
-- ---------------------------------------------------------------------------
DO $revoke_all$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'agricoop_app.cooperatives',
    'agricoop_app.products',
    'agricoop_app."productImages"',
    'agricoop_app.quotations',
    'agricoop_app.orders',
    'agricoop_app."orderItems"',
    'agricoop_app."orderEvents"',
    'agricoop_app.transactions',
    'agricoop_app."paymentOptions"',
    'agricoop_app."paymentProofs"',
    'agricoop_app.conversations',
    'agricoop_app."conversationMessages"',
    'agricoop_app."cooperativeAssociationRequests"',
    'agricoop_app.payments',
    'agricoop_app."paymentEvents"',
    'agricoop_app.notifications',
    'agricoop_app."supportTickets"',
    'agricoop_app."supportTicketMessages"',
    'agricoop_app."auditLogs"'
  ]
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC, anon, authenticated, service_role', target);
  END LOOP;
END
$revoke_all$;

-- Schema usage for anon marketplace browse
GRANT USAGE ON SCHEMA agricoop_app TO anon, authenticated;

-- cooperatives
GRANT SELECT ON TABLE agricoop_app.cooperatives TO anon, authenticated;
GRANT INSERT ("name", "normalizedName", "description", "location", "status") ON TABLE agricoop_app.cooperatives TO authenticated;
GRANT UPDATE ("name", "normalizedName", "description", "location", "status") ON TABLE agricoop_app.cooperatives TO authenticated;

-- products
GRANT SELECT ON TABLE agricoop_app.products TO anon, authenticated;
GRANT INSERT (
  "sellerId", "cooperativeId", "name", "category", "variety", "description", "unit",
  "priceCents", "stockQty", "minOrderQty", "qualityGrade", "status", "verificationStatus",
  "visibility", "rejectionReason", "primaryImageUrl"
) ON TABLE agricoop_app.products TO authenticated;
GRANT UPDATE (
  "name", "category", "variety", "description", "unit", "priceCents", "stockQty", "minOrderQty",
  "qualityGrade", "status", "verificationStatus", "visibility", "rejectionReason", "primaryImageUrl",
  "cooperativeId", "updatedAt"
) ON TABLE agricoop_app.products TO authenticated;

-- productImages
GRANT SELECT ON TABLE agricoop_app."productImages" TO anon, authenticated;
GRANT INSERT ("productId", "imageUrl", "displayOrder") ON TABLE agricoop_app."productImages" TO authenticated;
GRANT UPDATE ("imageUrl", "displayOrder") ON TABLE agricoop_app."productImages" TO authenticated;
GRANT DELETE ON TABLE agricoop_app."productImages" TO authenticated;

-- quotations
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app.quotations TO authenticated;

-- orders / items / events / transactions
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app.orders TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app."orderItems" TO authenticated;
GRANT SELECT, INSERT ON TABLE agricoop_app."orderEvents" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app.transactions TO authenticated;

-- payment options / proofs / payments / events
GRANT SELECT ON TABLE agricoop_app."paymentOptions" TO authenticated;
GRANT INSERT (
  "cooperativeId", "paymentMethod", "displayName", "accountName", "accountNumber",
  "qrImagePath", "instructions", "isActive", "createdBy"
) ON TABLE agricoop_app."paymentOptions" TO authenticated;
GRANT UPDATE (
  "paymentMethod", "displayName", "accountName", "accountNumber", "qrImagePath",
  "instructions", "isActive", "updatedAt"
) ON TABLE agricoop_app."paymentOptions" TO authenticated;
GRANT DELETE ON TABLE agricoop_app."paymentOptions" TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app."paymentProofs" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app.payments TO authenticated;
GRANT SELECT, INSERT ON TABLE agricoop_app."paymentEvents" TO authenticated;

-- conversations
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app.conversations TO authenticated;
GRANT SELECT, INSERT ON TABLE agricoop_app."conversationMessages" TO authenticated;

-- association requests
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app."cooperativeAssociationRequests" TO authenticated;

-- notifications: SELECT/UPDATE only — INSERT via SECURITY DEFINER (next migration)
GRANT SELECT ON TABLE agricoop_app.notifications TO authenticated;
GRANT UPDATE ("isRead") ON TABLE agricoop_app.notifications TO authenticated;

-- support
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app."supportTickets" TO authenticated;
GRANT SELECT, INSERT ON TABLE agricoop_app."supportTicketMessages" TO authenticated;

-- auditLogs: SELECT only for staff — INSERT via SECURITY DEFINER / trigger
GRANT SELECT ON TABLE agricoop_app."auditLogs" TO authenticated;

-- Sequence grants for serial tables used by authenticated writers
DO $seq_grants$
DECLARE
  target_table text;
  target_sequence text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'agricoop_app.cooperatives',
    'agricoop_app.products',
    'agricoop_app."productImages"',
    'agricoop_app.quotations',
    'agricoop_app.orders',
    'agricoop_app."orderItems"',
    'agricoop_app."orderEvents"',
    'agricoop_app.transactions',
    'agricoop_app."paymentOptions"',
    'agricoop_app.payments',
    'agricoop_app."paymentEvents"',
    'agricoop_app.conversations',
    'agricoop_app."conversationMessages"',
    'agricoop_app."cooperativeAssociationRequests"',
    'agricoop_app.notifications',
    'agricoop_app."supportTickets"',
    'agricoop_app."supportTicketMessages"',
    'agricoop_app."auditLogs"'
  ]
  LOOP
    target_sequence := pg_get_serial_sequence(target_table, 'id');
    IF target_sequence IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', target_sequence);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', target_sequence);
  END LOOP;
END
$seq_grants$;

-- Public marketplace joins need seller display name for anon browse
GRANT SELECT ("id", "name", "approvalStatus", "role") ON TABLE agricoop_app.users TO anon;

-- Extra users column grants for staff-managed protected fields (guarded by policies + app authz)
GRANT SELECT (
  "id", "openId", "name", "email", "role", "approvalStatus", "verificationStatus",
  "verificationNote", "verifiedBy", "verifiedAt", "profileImageUrl", "birthdate", "phone",
  "address", "cooperativeId", "contactNumber", "createdAt", "updatedAt", "lastSignedIn", "loginMethod"
) ON TABLE agricoop_app.users TO authenticated;
GRANT UPDATE (
  "role", "approvalStatus", "cooperativeId", "verificationStatus", "verificationNote",
  "verifiedBy", "verifiedAt", "birthdate", "phone", "address", "name", "email",
  "loginMethod", "lastSignedIn", "contactNumber", "updatedAt"
) ON TABLE agricoop_app.users TO authenticated;

-- ---------------------------------------------------------------------------
-- Drop conflicting marketplace policies if re-run (repeatable names)
-- ---------------------------------------------------------------------------
DO $drop_policies$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'agricoop_app'
      AND policyname LIKE 'agricoop_mkt_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END
$drop_policies$;

-- cooperatives
CREATE POLICY agricoop_mkt_cooperatives_anon_read
  ON agricoop_app.cooperatives FOR SELECT TO anon, authenticated
  USING ("status" = 'active' OR agricoop_app.is_staff());

CREATE POLICY agricoop_mkt_cooperatives_superadmin_write
  ON agricoop_app.cooperatives FOR ALL TO authenticated
  USING (agricoop_app.is_superadmin())
  WITH CHECK (agricoop_app.is_superadmin());

-- products: public catalog + seller/staff
CREATE POLICY agricoop_mkt_products_public_read
  ON agricoop_app.products FOR SELECT TO anon, authenticated
  USING (
    (
      "status" = 'published'
      AND "verificationStatus" = 'approved'
      AND "visibility" = 'visible'
      AND EXISTS (
        SELECT 1 FROM agricoop_app.users s
        WHERE s.id = products."sellerId" AND s."approvalStatus" = 'approved'
      )
    )
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  );

CREATE POLICY agricoop_mkt_products_seller_insert
  ON agricoop_app.products FOR INSERT TO authenticated
  WITH CHECK (
    "sellerId" = agricoop_app.current_app_user_id()
    AND agricoop_app.current_app_role() IN ('seller', 'admin', 'superadmin')
  );

CREATE POLICY agricoop_mkt_products_seller_update
  ON agricoop_app.products FOR UPDATE TO authenticated
  USING (
    "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  )
  WITH CHECK (
    "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  );

-- productImages
CREATE POLICY agricoop_mkt_product_images_read
  ON agricoop_app."productImages" FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agricoop_app.products p
      WHERE p.id = "productId"
        AND (
          (p."status" = 'published' AND p."verificationStatus" = 'approved' AND p."visibility" = 'visible')
          OR p."sellerId" = agricoop_app.current_app_user_id()
          OR agricoop_app.shares_cooperative(p."cooperativeId")
          OR agricoop_app.is_superadmin()
        )
    )
  );

CREATE POLICY agricoop_mkt_product_images_write
  ON agricoop_app."productImages" FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agricoop_app.products p
      WHERE p.id = "productId" AND p."sellerId" = agricoop_app.current_app_user_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agricoop_app.products p
      WHERE p.id = "productId" AND p."sellerId" = agricoop_app.current_app_user_id()
    )
  );

-- quotations
CREATE POLICY agricoop_mkt_quotations_access
  ON agricoop_app.quotations FOR SELECT TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.is_superadmin()
  );

CREATE POLICY agricoop_mkt_quotations_insert
  ON agricoop_app.quotations FOR INSERT TO authenticated
  WITH CHECK ("buyerId" = agricoop_app.current_app_user_id());

CREATE POLICY agricoop_mkt_quotations_update
  ON agricoop_app.quotations FOR UPDATE TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
  )
  WITH CHECK (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
  );

-- orders
CREATE POLICY agricoop_mkt_orders_select
  ON agricoop_app.orders FOR SELECT TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  );

CREATE POLICY agricoop_mkt_orders_insert
  ON agricoop_app.orders FOR INSERT TO authenticated
  WITH CHECK ("buyerId" = agricoop_app.current_app_user_id());

CREATE POLICY agricoop_mkt_orders_update
  ON agricoop_app.orders FOR UPDATE TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  )
  WITH CHECK (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  );

-- orderItems / orderEvents / transactions follow parent order access
CREATE POLICY agricoop_mkt_order_items_select
  ON agricoop_app."orderItems" FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId"
        AND (
          o."buyerId" = agricoop_app.current_app_user_id()
          OR o."sellerId" = agricoop_app.current_app_user_id()
          OR agricoop_app.shares_cooperative(o."cooperativeId")
          OR agricoop_app.is_superadmin()
        )
    )
  );

CREATE POLICY agricoop_mkt_order_items_insert
  ON agricoop_app."orderItems" FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId" AND o."buyerId" = agricoop_app.current_app_user_id()
    )
  );

CREATE POLICY agricoop_mkt_order_items_update
  ON agricoop_app."orderItems" FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId"
        AND (agricoop_app.shares_cooperative(o."cooperativeId") OR agricoop_app.is_superadmin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId"
        AND (agricoop_app.shares_cooperative(o."cooperativeId") OR agricoop_app.is_superadmin())
    )
  );

CREATE POLICY agricoop_mkt_order_events_select
  ON agricoop_app."orderEvents" FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId"
        AND (
          o."buyerId" = agricoop_app.current_app_user_id()
          OR o."sellerId" = agricoop_app.current_app_user_id()
          OR agricoop_app.shares_cooperative(o."cooperativeId")
          OR agricoop_app.is_superadmin()
        )
    )
  );

CREATE POLICY agricoop_mkt_order_events_insert
  ON agricoop_app."orderEvents" FOR INSERT TO authenticated
  WITH CHECK (
    "actorUserId" = agricoop_app.current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId"
        AND (
          o."buyerId" = agricoop_app.current_app_user_id()
          OR o."sellerId" = agricoop_app.current_app_user_id()
          OR agricoop_app.shares_cooperative(o."cooperativeId")
          OR agricoop_app.is_superadmin()
        )
    )
  );

CREATE POLICY agricoop_mkt_transactions_select
  ON agricoop_app.transactions FOR SELECT TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId"
        AND (agricoop_app.shares_cooperative(o."cooperativeId") OR agricoop_app.is_superadmin())
    )
  );

CREATE POLICY agricoop_mkt_transactions_insert
  ON agricoop_app.transactions FOR INSERT TO authenticated
  WITH CHECK ("buyerId" = agricoop_app.current_app_user_id());

CREATE POLICY agricoop_mkt_transactions_update
  ON agricoop_app.transactions FOR UPDATE TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = transactions."orderId"
        AND (agricoop_app.shares_cooperative(o."cooperativeId") OR agricoop_app.is_superadmin())
    )
  )
  WITH CHECK (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = transactions."orderId"
        AND (agricoop_app.shares_cooperative(o."cooperativeId") OR agricoop_app.is_superadmin())
    )
  );

-- paymentOptions
CREATE POLICY agricoop_mkt_payment_options_select
  ON agricoop_app."paymentOptions" FOR SELECT TO authenticated
  USING (
    ("isActive" = true)
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
    OR ("cooperativeId" IS NULL AND agricoop_app.is_staff())
  );

CREATE POLICY agricoop_mkt_payment_options_write
  ON agricoop_app."paymentOptions" FOR ALL TO authenticated
  USING (
    agricoop_app.is_superadmin()
    OR agricoop_app.shares_cooperative("cooperativeId")
  )
  WITH CHECK (
    agricoop_app.is_superadmin()
    OR agricoop_app.shares_cooperative("cooperativeId")
  );

-- paymentProofs
CREATE POLICY agricoop_mkt_payment_proofs_select
  ON agricoop_app."paymentProofs" FOR SELECT TO authenticated
  USING (
    "uploadedBy" = agricoop_app.current_app_user_id()
    OR (
      agricoop_app.is_staff()
      AND EXISTS (
        SELECT 1 FROM agricoop_app.orders o
        WHERE o.id = "orderId"
          AND o."buyerId" <> agricoop_app.current_app_user_id()
          AND o."sellerId" <> agricoop_app.current_app_user_id()
          AND (agricoop_app.is_superadmin() OR agricoop_app.shares_cooperative(o."cooperativeId"))
      )
    )
  );

CREATE POLICY agricoop_mkt_payment_proofs_insert
  ON agricoop_app."paymentProofs" FOR INSERT TO authenticated
  WITH CHECK (
    "uploadedBy" = agricoop_app.current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId" AND o."buyerId" = agricoop_app.current_app_user_id()
    )
  );

CREATE POLICY agricoop_mkt_payment_proofs_update
  ON agricoop_app."paymentProofs" FOR UPDATE TO authenticated
  USING (
    agricoop_app.is_staff()
    AND EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId"
        AND o."buyerId" <> agricoop_app.current_app_user_id()
        AND o."sellerId" <> agricoop_app.current_app_user_id()
        AND (agricoop_app.is_superadmin() OR agricoop_app.shares_cooperative(o."cooperativeId"))
    )
  )
  WITH CHECK (
    agricoop_app.is_staff()
    AND EXISTS (
      SELECT 1 FROM agricoop_app.orders o
      WHERE o.id = "orderId"
        AND (agricoop_app.is_superadmin() OR agricoop_app.shares_cooperative(o."cooperativeId"))
    )
  );

-- payments / paymentEvents
CREATE POLICY agricoop_mkt_payments_select
  ON agricoop_app.payments FOR SELECT TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  );

CREATE POLICY agricoop_mkt_payments_insert
  ON agricoop_app.payments FOR INSERT TO authenticated
  WITH CHECK (
    "buyerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.is_staff()
  );

CREATE POLICY agricoop_mkt_payments_update
  ON agricoop_app.payments FOR UPDATE TO authenticated
  USING (
    agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
    OR "sellerId" = agricoop_app.current_app_user_id()
  )
  WITH CHECK (
    agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
    OR "sellerId" = agricoop_app.current_app_user_id()
  );

CREATE POLICY agricoop_mkt_payment_events_select
  ON agricoop_app."paymentEvents" FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agricoop_app.payments p
      WHERE p.id = "paymentId"
        AND (
          p."buyerId" = agricoop_app.current_app_user_id()
          OR p."sellerId" = agricoop_app.current_app_user_id()
          OR agricoop_app.shares_cooperative(p."cooperativeId")
          OR agricoop_app.is_superadmin()
        )
    )
  );

CREATE POLICY agricoop_mkt_payment_events_insert
  ON agricoop_app."paymentEvents" FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agricoop_app.payments p
      WHERE p.id = "paymentId"
        AND (
          agricoop_app.shares_cooperative(p."cooperativeId")
          OR agricoop_app.is_superadmin()
          OR p."sellerId" = agricoop_app.current_app_user_id()
          OR p."buyerId" = agricoop_app.current_app_user_id()
        )
    )
  );

-- conversations / messages
CREATE POLICY agricoop_mkt_conversations_select
  ON agricoop_app.conversations FOR SELECT TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.is_superadmin()
    OR (
      agricoop_app.current_app_role() = 'admin'
      AND "sellerId" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM agricoop_app.users s
        WHERE s.id = "sellerId"
          AND s."cooperativeId" = agricoop_app.current_app_cooperative_id()
      )
    )
  );

CREATE POLICY agricoop_mkt_conversations_insert
  ON agricoop_app.conversations FOR INSERT TO authenticated
  WITH CHECK ("buyerId" = agricoop_app.current_app_user_id());

CREATE POLICY agricoop_mkt_conversations_update
  ON agricoop_app.conversations FOR UPDATE TO authenticated
  USING (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.is_staff()
  )
  WITH CHECK (
    "buyerId" = agricoop_app.current_app_user_id()
    OR "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.is_staff()
  );

CREATE POLICY agricoop_mkt_conversation_messages_select
  ON agricoop_app."conversationMessages" FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agricoop_app.conversations c
      WHERE c.id = "conversationId"
        AND (
          c."buyerId" = agricoop_app.current_app_user_id()
          OR c."sellerId" = agricoop_app.current_app_user_id()
          OR agricoop_app.is_superadmin()
          OR (
            agricoop_app.current_app_role() = 'admin'
            AND c."sellerId" IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM agricoop_app.users s
              WHERE s.id = c."sellerId"
                AND s."cooperativeId" = agricoop_app.current_app_cooperative_id()
            )
          )
        )
    )
  );

CREATE POLICY agricoop_mkt_conversation_messages_insert
  ON agricoop_app."conversationMessages" FOR INSERT TO authenticated
  WITH CHECK (
    "senderId" = agricoop_app.current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM agricoop_app.conversations c
      WHERE c.id = "conversationId"
        AND (
          c."buyerId" = agricoop_app.current_app_user_id()
          OR c."sellerId" = agricoop_app.current_app_user_id()
          OR agricoop_app.is_staff()
        )
    )
  );

-- cooperative association requests
CREATE POLICY agricoop_mkt_assoc_select
  ON agricoop_app."cooperativeAssociationRequests" FOR SELECT TO authenticated
  USING (
    "sellerId" = agricoop_app.current_app_user_id()
    OR agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  );

CREATE POLICY agricoop_mkt_assoc_insert
  ON agricoop_app."cooperativeAssociationRequests" FOR INSERT TO authenticated
  WITH CHECK (
    "sellerId" = agricoop_app.current_app_user_id()
    AND agricoop_app.current_app_role() = 'seller'
  );

CREATE POLICY agricoop_mkt_assoc_update
  ON agricoop_app."cooperativeAssociationRequests" FOR UPDATE TO authenticated
  USING (
    agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  )
  WITH CHECK (
    agricoop_app.shares_cooperative("cooperativeId")
    OR agricoop_app.is_superadmin()
  );

-- notifications self read/mark-read (insert via definer fn)
CREATE POLICY agricoop_mkt_notifications_self_select
  ON agricoop_app.notifications FOR SELECT TO authenticated
  USING ("userId" = agricoop_app.current_app_user_id());

CREATE POLICY agricoop_mkt_notifications_self_update
  ON agricoop_app.notifications FOR UPDATE TO authenticated
  USING ("userId" = agricoop_app.current_app_user_id())
  WITH CHECK ("userId" = agricoop_app.current_app_user_id() AND "isRead" IN (0, 1));

-- support tickets
CREATE POLICY agricoop_mkt_support_tickets_select
  ON agricoop_app."supportTickets" FOR SELECT TO authenticated
  USING (
    "userId" = agricoop_app.current_app_user_id()
    OR agricoop_app.is_superadmin()
    OR agricoop_app.shares_cooperative("cooperativeId")
  );

CREATE POLICY agricoop_mkt_support_tickets_insert
  ON agricoop_app."supportTickets" FOR INSERT TO authenticated
  WITH CHECK ("userId" = agricoop_app.current_app_user_id());

CREATE POLICY agricoop_mkt_support_tickets_update
  ON agricoop_app."supportTickets" FOR UPDATE TO authenticated
  USING (
    agricoop_app.is_superadmin()
    OR agricoop_app.shares_cooperative("cooperativeId")
  )
  WITH CHECK (
    agricoop_app.is_superadmin()
    OR agricoop_app.shares_cooperative("cooperativeId")
  );

CREATE POLICY agricoop_mkt_support_messages_select
  ON agricoop_app."supportTicketMessages" FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agricoop_app."supportTickets" t
      WHERE t.id = "ticketId"
        AND (
          t."userId" = agricoop_app.current_app_user_id()
          OR agricoop_app.is_superadmin()
          OR agricoop_app.shares_cooperative(t."cooperativeId")
        )
    )
  );

CREATE POLICY agricoop_mkt_support_messages_insert
  ON agricoop_app."supportTicketMessages" FOR INSERT TO authenticated
  WITH CHECK (
    "senderId" = agricoop_app.current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM agricoop_app."supportTickets" t
      WHERE t.id = "ticketId"
        AND (
          t."userId" = agricoop_app.current_app_user_id()
          OR agricoop_app.is_superadmin()
          OR agricoop_app.shares_cooperative(t."cooperativeId")
        )
    )
  );

-- auditLogs SELECT for staff (INSERT denied at table grant; definer fn used)
CREATE POLICY agricoop_mkt_audit_logs_select
  ON agricoop_app."auditLogs" FOR SELECT TO authenticated
  USING (
    agricoop_app.is_superadmin()
    OR (
      agricoop_app.current_app_role() = 'admin'
      AND "cooperativeId" IS NOT NULL
      AND "cooperativeId" = agricoop_app.current_app_cooperative_id()
    )
  );

-- users: anon sees only public seller display fields for approved sellers
CREATE POLICY agricoop_mkt_users_anon_public_seller
  ON agricoop_app.users FOR SELECT TO anon
  USING ("approvalStatus" = 'approved' AND "role" IN ('seller', 'admin', 'superadmin'));

-- users: staff can read/update peers within scope (self policies from auth migration remain)
CREATE POLICY agricoop_mkt_users_staff_select
  ON agricoop_app.users FOR SELECT TO authenticated
  USING (
    agricoop_app.is_superadmin()
    OR (
      agricoop_app.current_app_role() = 'admin'
      AND "cooperativeId" IS NOT NULL
      AND "cooperativeId" = agricoop_app.current_app_cooperative_id()
    )
    OR (
      -- marketplace joins need seller name for approved sellers of visible products
      "approvalStatus" = 'approved'
      AND "role" IN ('seller', 'admin', 'superadmin')
    )
  );

CREATE POLICY agricoop_mkt_users_staff_update
  ON agricoop_app.users FOR UPDATE TO authenticated
  USING (
    agricoop_app.is_superadmin()
    OR (
      agricoop_app.current_app_role() = 'admin'
      AND "cooperativeId" IS NOT NULL
      AND "cooperativeId" = agricoop_app.current_app_cooperative_id()
      AND "role" <> 'superadmin'
      AND "id" <> agricoop_app.current_app_user_id()
    )
  )
  WITH CHECK (
    agricoop_app.is_superadmin()
    OR (
      agricoop_app.current_app_role() = 'admin'
      AND "cooperativeId" = agricoop_app.current_app_cooperative_id()
      AND "role" <> 'superadmin'
      AND "id" <> agricoop_app.current_app_user_id()
    )
  );

-- Guard: block self-service promotion / coop self-assignment on users
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
    -- Self may change verification fields only when verification upload flag set (existing trigger)
    -- or when staff. Never allow self role/approval/coop changes.
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
          ) THEN
      RAISE EXCEPTION 'Admin cannot change users outside their cooperative or promote SuperAdmin';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION agricoop_app.guard_users_protected_columns() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS agricoop_users_protected_columns_guard ON agricoop_app.users;
CREATE TRIGGER agricoop_users_protected_columns_guard
  BEFORE UPDATE OF "role", "approvalStatus", "cooperativeId", "verificationStatus", "verifiedBy", "verifiedAt"
  ON agricoop_app.users
  FOR EACH ROW
  EXECUTE FUNCTION agricoop_app.guard_users_protected_columns();

DO $postflight$
BEGIN
  IF NOT has_table_privilege('authenticated', 'agricoop_app.products', 'SELECT')
     OR NOT has_table_privilege('anon', 'agricoop_app.products', 'SELECT')
     OR has_table_privilege('authenticated', 'agricoop_app."auditLogs"', 'INSERT')
     OR has_table_privilege('authenticated', 'agricoop_app."auditLogs"', 'UPDATE')
     OR has_table_privilege('authenticated', 'agricoop_app."auditLogs"', 'DELETE') THEN
    RAISE EXCEPTION 'Marketplace RLS postflight failed: grants do not match least-privilege expectations';
  END IF;
END
$postflight$;

COMMIT;

-- Verification samples (read-only after run):
-- SELECT tablename, policyname, cmd, roles FROM pg_policies
--  WHERE schemaname = 'agricoop_app' AND policyname LIKE 'agricoop_mkt_%' ORDER BY 1,2;
-- SELECT has_table_privilege('authenticated','agricoop_app."auditLogs"','INSERT'); -- expect false

-- ROLLBACK outline:
-- DROP TRIGGER IF EXISTS agricoop_users_protected_columns_guard ON agricoop_app.users;
-- DROP FUNCTION IF EXISTS agricoop_app.guard_users_protected_columns();
-- DROP POLICY ... (all agricoop_mkt_*); REVOKE granted privileges; restore prior grants from catalog backup.
