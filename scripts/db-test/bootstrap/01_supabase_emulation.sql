-- Emulate minimal Supabase roles + auth.uid()/auth.jwt() for local RLS tests.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

GRANT anon, authenticated, service_role TO agricoop_login;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, agricoop_login;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role, agricoop_login;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role, agricoop_login;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text
);

-- Minimal Supabase Storage catalog so avatar / payment-QR migrations apply.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role, agricoop_login;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE storage.buckets TO anon, authenticated, service_role;
GRANT ALL ON TABLE storage.objects TO anon, authenticated, service_role;
