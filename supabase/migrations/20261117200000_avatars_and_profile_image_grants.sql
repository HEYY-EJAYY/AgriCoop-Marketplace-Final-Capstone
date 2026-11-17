-- Additive: profile photo column grants + public avatars bucket for display.
-- Root cause of upload failure: authenticated had SELECT-only on profileImageUrl.

GRANT UPDATE ("profileImageUrl") ON TABLE agricoop_app.users TO authenticated;
GRANT INSERT ("profileImageUrl") ON TABLE agricoop_app.users TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read for avatar display
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_public_read'
  ) THEN
    CREATE POLICY avatars_public_read
      ON storage.objects
      FOR SELECT
      TO anon, authenticated
      USING (bucket_id = 'avatars');
  END IF;
END $$;

-- Owners may insert into their own folder: {auth.uid()}/...
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_owner_insert'
  ) THEN
    CREATE POLICY avatars_owner_insert
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'avatars'
        AND split_part(name, '/', 1) = (SELECT auth.uid()::text)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_owner_update'
  ) THEN
    CREATE POLICY avatars_owner_update
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'avatars'
        AND split_part(name, '/', 1) = (SELECT auth.uid()::text)
      )
      WITH CHECK (
        bucket_id = 'avatars'
        AND split_part(name, '/', 1) = (SELECT auth.uid()::text)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_owner_delete'
  ) THEN
    CREATE POLICY avatars_owner_delete
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'avatars'
        AND split_part(name, '/', 1) = (SELECT auth.uid()::text)
      );
  END IF;
END $$;
