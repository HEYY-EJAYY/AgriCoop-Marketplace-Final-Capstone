-- Cooperative Admin application: verification metadata + PDF ID uploads.
-- Adds contact number, government ID type/number, and consent timestamp to
-- agricoop_app."cooperativeAdminApplications", extends column grants, and
-- allows application/pdf in the private coop-admin-applications bucket.

ALTER TABLE agricoop_app."cooperativeAdminApplications"
  ADD COLUMN IF NOT EXISTS "contactNumber" varchar(40),
  ADD COLUMN IF NOT EXISTS "idType" varchar(40),
  ADD COLUMN IF NOT EXISTS "idNumber" varchar(60),
  ADD COLUMN IF NOT EXISTS "consentAcceptedAt" timestamp;

-- Row visibility stays owner/superadmin-only via RLS; tRPC responses decide
-- which fields are exposed (idNumber is never returned by pendingList).
GRANT SELECT (
  "contactNumber", "idType", "idNumber", "consentAcceptedAt"
) ON TABLE agricoop_app."cooperativeAdminApplications" TO authenticated;

GRANT INSERT (
  "contactNumber", "idType", "idNumber", "consentAcceptedAt"
) ON TABLE agricoop_app."cooperativeAdminApplications" TO authenticated;

GRANT UPDATE (
  "contactNumber", "idType", "idNumber", "consentAcceptedAt"
) ON TABLE agricoop_app."cooperativeAdminApplications" TO authenticated;

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
WHERE id = 'coop-admin-applications';
