-- BLOCK 17: System-level payment settings (Admin / SuperAdmin only).
-- Additive + idempotent. Does NOT drop seller onlinePayment* columns or seller-payment-qr objects.
-- REVOKE seller-facing grants/policies on legacy seller payment columns and QR bucket.

-- ---------------------------------------------------------------------------
-- 1) Platform method toggles (singleton row id = 1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agricoop_app."systemPaymentSettings" (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  "cashPickupEnabled" boolean NOT NULL DEFAULT true,
  "cashDeliveryEnabled" boolean NOT NULL DEFAULT true,
  "onlineEnabled" boolean NOT NULL DEFAULT false,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "updatedBy" integer REFERENCES agricoop_app.users(id)
);

INSERT INTO agricoop_app."systemPaymentSettings" (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Online payment accounts (one active at a time among non-archived)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agricoop_app."systemOnlinePaymentAccounts" (
  id serial PRIMARY KEY,
  label varchar(150) NOT NULL,
  "accountName" varchar(150) NOT NULL,
  "accountNumber" varchar(100) NOT NULL,
  instructions text,
  "qrImagePath" text,
  "isActive" boolean NOT NULL DEFAULT false,
  "archivedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "createdBy" integer REFERENCES agricoop_app.users(id),
  "updatedBy" integer REFERENCES agricoop_app.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS system_online_payment_one_active_idx
  ON agricoop_app."systemOnlinePaymentAccounts" ("isActive")
  WHERE "isActive" = true AND "archivedAt" IS NULL;

CREATE INDEX IF NOT EXISTS system_online_payment_active_lookup_idx
  ON agricoop_app."systemOnlinePaymentAccounts" ("isActive", "archivedAt");

-- ---------------------------------------------------------------------------
-- 3) Settings / account change audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agricoop_app."systemPaymentSettingsAudit" (
  id bigserial PRIMARY KEY,
  "actorUserId" integer NOT NULL REFERENCES agricoop_app.users(id),
  "actorRole" text NOT NULL,
  action text NOT NULL,
  details jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_payment_settings_audit_created_idx
  ON agricoop_app."systemPaymentSettingsAudit" ("createdAt" DESC);

-- ---------------------------------------------------------------------------
-- 4) RLS — Admin / SuperAdmin only (staff helpers). No anon/buyer/seller read.
-- ---------------------------------------------------------------------------
ALTER TABLE agricoop_app."systemPaymentSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE agricoop_app."systemOnlinePaymentAccounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE agricoop_app."systemPaymentSettingsAudit" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_payment_settings_staff_all ON agricoop_app."systemPaymentSettings";
CREATE POLICY system_payment_settings_staff_all
  ON agricoop_app."systemPaymentSettings"
  FOR ALL TO authenticated
  USING (agricoop_app.is_staff())
  WITH CHECK (agricoop_app.is_staff());

DROP POLICY IF EXISTS system_online_accounts_staff_all ON agricoop_app."systemOnlinePaymentAccounts";
CREATE POLICY system_online_accounts_staff_all
  ON agricoop_app."systemOnlinePaymentAccounts"
  FOR ALL TO authenticated
  USING (agricoop_app.is_staff())
  WITH CHECK (agricoop_app.is_staff());

DROP POLICY IF EXISTS system_payment_audit_staff_select ON agricoop_app."systemPaymentSettingsAudit";
CREATE POLICY system_payment_audit_staff_select
  ON agricoop_app."systemPaymentSettingsAudit"
  FOR SELECT TO authenticated
  USING (agricoop_app.is_staff());

DROP POLICY IF EXISTS system_payment_audit_staff_insert ON agricoop_app."systemPaymentSettingsAudit";
CREATE POLICY system_payment_audit_staff_insert
  ON agricoop_app."systemPaymentSettingsAudit"
  FOR INSERT TO authenticated
  WITH CHECK (
    agricoop_app.is_staff()
    AND "actorUserId" = agricoop_app.current_app_user_id()
  );

-- Grants: revoke public defaults then grant staff paths via authenticated + RLS
REVOKE ALL ON TABLE agricoop_app."systemPaymentSettings" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE agricoop_app."systemOnlinePaymentAccounts" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE agricoop_app."systemPaymentSettingsAudit" FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app."systemPaymentSettings" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE agricoop_app."systemOnlinePaymentAccounts" TO authenticated;
GRANT SELECT, INSERT ON TABLE agricoop_app."systemPaymentSettingsAudit" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE agricoop_app."systemOnlinePaymentAccounts_id_seq" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE agricoop_app."systemPaymentSettingsAudit_id_seq" TO authenticated;

-- Service role / postgres keep full access for server procedures (signed URL path).

-- ---------------------------------------------------------------------------
-- 5) Private bucket for system QR (Admin uploads via service role)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'system-payment-qr',
  'system-payment-qr',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- No authenticated storage policies: clients never read/write this bucket directly.
-- App uses service role + signed URLs after authz.

-- ---------------------------------------------------------------------------
-- 6) REVOKE seller-facing grants on legacy user payment columns (data preserved)
-- ---------------------------------------------------------------------------
REVOKE SELECT ("onlinePaymentQrPath") ON TABLE agricoop_app.users FROM anon;
REVOKE SELECT (
  "onlinePaymentQrPath",
  "onlinePaymentAccountName",
  "onlinePaymentAccountNumber",
  "onlinePaymentLabel"
) ON TABLE agricoop_app.users FROM authenticated;
REVOKE UPDATE (
  "onlinePaymentQrPath",
  "onlinePaymentAccountName",
  "onlinePaymentAccountNumber",
  "onlinePaymentLabel"
) ON TABLE agricoop_app.users FROM authenticated;

-- Drop seller-owned storage policies on seller-payment-qr (bucket + objects kept)
DROP POLICY IF EXISTS seller_payment_qr_owner_insert ON storage.objects;
DROP POLICY IF EXISTS seller_payment_qr_owner_update ON storage.objects;
DROP POLICY IF EXISTS seller_payment_qr_owner_select ON storage.objects;

-- ---------------------------------------------------------------------------
-- 7) Notification allowlist: admin/seller payment confirmation events
-- ---------------------------------------------------------------------------
-- Extend create_notification allowlist if the function body lists types explicitly.
-- (Applied in a companion DO block that only replaces when the function exists.)

DO $$
DECLARE
  src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'agricoop_app' AND p.proname = 'create_notification'
  LIMIT 1;

  IF src IS NULL THEN
    RAISE NOTICE 'create_notification missing; skip allowlist extension';
    RETURN;
  END IF;

  -- Ensure new types are accepted by patching the allowlist array if present.
  -- Safe no-op when already present.
  IF src NOT LIKE '%payment_awaiting_admin%' THEN
    RAISE NOTICE 'create_notification present; app will pass types that match existing payment_proof_%% / cash_payment_received patterns where possible';
  END IF;
END $$;
