-- Restore client signed-upload access for private proof/verification buckets.
--
-- storage.objects has RLS enabled but no policies for the `payment-proofs`
-- and `profile-verification-documents` buckets, so every signed-upload from
-- the app (checkout receipts, payment proof resubmission, profile
-- verification documents) fails with "new row violates row-level security
-- policy". Server-side service-role writes are unaffected.
--
-- Object names are stored as `<bucket>/<agricoop_app.users.id>/...` inside
-- the bucket itself, so ownership is checked against the second path
-- segment via agricoop_app.current_app_user_id() (maps auth.uid() ->
-- agricoop_app.users.id). Owners can only write under their own prefix;
-- reads stay server-side via signed URLs (service role), so no SELECT
-- policy is granted to clients.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'payment_proofs_owner_insert'
  ) THEN
    CREATE POLICY payment_proofs_owner_insert
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'payment-proofs'
        AND split_part(name, '/', 1) = 'payment-proofs'
        AND split_part(name, '/', 2) = agricoop_app.current_app_user_id()::text
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'profile_verification_owner_insert'
  ) THEN
    CREATE POLICY profile_verification_owner_insert
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'profile-verification-documents'
        AND split_part(name, '/', 1) = 'profile-verification-documents'
        AND split_part(name, '/', 2) = agricoop_app.current_app_user_id()::text
      );
  END IF;
END $$;
