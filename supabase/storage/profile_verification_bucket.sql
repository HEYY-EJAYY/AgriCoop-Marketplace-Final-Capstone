-- Manual setup draft for the profile-verification document bucket.
-- Do not run until the project owner approves the target and confirms this
-- bucket does not contain existing data requiring a different configuration.
-- Application uploads/downloads are mediated by server-issued short-lived
-- capabilities (service role). Service role bypasses Storage RLS.
-- This script intentionally creates no client Storage policies (default-deny
-- for anon/authenticated direct object access is acceptable). Do not UPSERT-
-- overwrite product-images or payment-proofs from other templates.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'Storage setup stopped: storage.buckets is unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'storage.buckets'::regclass
      AND attname IN ('id', 'name', 'public', 'file_size_limit', 'allowed_mime_types')
      AND NOT attisdropped
    GROUP BY attrelid
    HAVING count(*) = 5
  ) THEN
    RAISE EXCEPTION 'Storage setup stopped: storage.buckets has an unexpected catalog shape';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'profile-verification-documents'
       OR name = 'profile-verification-documents'
  ) AND NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'profile-verification-documents'
      AND name = 'profile-verification-documents'
      AND public IS FALSE
      AND file_size_limit = 5242880
      AND allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
  ) THEN
    RAISE EXCEPTION 'Storage setup stopped: existing bucket configuration differs; reconcile it manually';
  END IF;
END
$preflight$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT
  'profile-verification-documents',
  'profile-verification-documents',
  FALSE,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
WHERE NOT EXISTS (
  SELECT 1
  FROM storage.buckets
  WHERE id = 'profile-verification-documents'
);

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'profile-verification-documents'
      AND name = 'profile-verification-documents'
      AND public IS FALSE
      AND file_size_limit = 5242880
      AND allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
  ) THEN
    RAISE EXCEPTION 'Storage setup verification failed: bucket is not private with the required limits';
  END IF;
END
$postflight$;

COMMIT;

-- Read-only verification after an approved run:
SELECT
  id = 'profile-verification-documents'
  AND name = 'profile-verification-documents' AS expected_bucket,
  public IS FALSE AS is_private,
  file_size_limit = 5242880 AS has_expected_size_limit,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[] AS has_expected_mime_types
FROM storage.buckets
WHERE id = 'profile-verification-documents';
