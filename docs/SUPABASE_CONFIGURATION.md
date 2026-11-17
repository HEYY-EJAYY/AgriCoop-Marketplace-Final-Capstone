# Supabase Configuration and Acceptance Checklist

## Status

This document describes required setup; no Supabase Dashboard setting, database object, grant, RLS policy, or Storage policy was changed or tested against the production project.

## Environment variables

Required by active Vercel application code (names only):

| Variable | Scope | Purpose |
|---|---|---|
| `DATABASE_URL` | Server only | PostgreSQL runtime connection. The current source establishes a transaction and sets transaction-local `role`, `search_path`, and JWT claims. Effective permissions and RLS behavior remain unverified. |
| `NEXT_PUBLIC_SUPABASE_URL` | Public/browser | Supabase project URL; Vite maps it to the browser's `VITE_SUPABASE_URL` when the latter is absent. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public/browser | Publishable/anon key; Vite maps it to the browser's `VITE_SUPABASE_ANON_KEY` when needed. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Auth identity lookup/account cleanup and server-side Storage operations. Never prefix it with `VITE_` or `NEXT_PUBLIC_`. |
| `APP_URL` | Server only | Trusted application origin used to construct the email-verification callback; production must use HTTPS. |

Optional or non-Vercel:

- `SUPABASE_STORAGE_BUCKET` selects the product image bucket; source defaults to `product-images`.
- `BUILT_IN_FORGE_API_URL` and `BUILT_IN_FORGE_API_KEY` enable optional Manus-compatible/AI helper integrations and the package-server legacy image proxy. They are not needed for the Vercel product-image workflow. Keep the key server-only.
- `MIGRATION_DATABASE_URL` is only for explicitly approved Drizzle migration work; do not put it in Vercel runtime settings.
- `SEED_DATABASE_URL` and `AGRICOOP_SEED_TARGET` are seed-only; never configure them in Vercel. Seed scripts require a loopback PostgreSQL host; Auth-account seed scripts also require a loopback Supabase URL.
- `VITE_AUTH_DIAGNOSTICS` and `AGRICOOP_AUTH_DIAGNOSTICS` are optional diagnostic flags. Disable them after troubleshooting.
- `VITE_FRONTEND_FORGE_API_KEY` is referenced only by an unreferenced Map component. Do not set it in production; any `VITE_` value used by an imported component is browser-visible.
- `JWT_SECRET`, `VITE_APP_ID`, `OAUTH_SERVER_URL`, and `PORT` have no confirmed requirement for the active Vercel path; do not configure them unless their usage is separately verified.

## Supabase Auth

Before enabling public signup:

1. Enable email/password signup and require email confirmation.
2. Set the Supabase Site URL to the deployed app origin.
3. Add the exact redirect `https://<vercel-domain>/auth?verification=success` to the Auth redirect allowlist. The application builds this callback from `APP_URL`, not the request `Host` header.
4. Configure reliable production email delivery/SMTP and suitable Auth signup/resend limits.
5. Exercise signup, successful callback, expired/invalid link, resend, duplicate signup, login/logout, session refresh, pending Seller approval, and unverified denial using controlled test accounts.

The repository's registration limiter is process-local and not shared across serverless instances. Supabase Auth limits are required; they do not prove application-level distributed rate limiting.

Previously auto-confirmed identities cannot be distinguished from genuinely confirmed users by the current `email_confirmed_at` field alone. Do not automatically delete, suspend, or rewrite existing accounts. The project owner must review those accounts before treating the field as historical proof of mailbox verification.

## PostgreSQL permissions, roles, and RLS

- The application role names (`buyer`, `seller`, `admin`, `superadmin`) are application data, not PostgreSQL login roles.
- The runtime uses `withRequestDatabaseScope` to set transaction-local database role and JWT claims. This is source-verified only. The known production connection is associated with a PostgreSQL `postgres` role that bypasses RLS; verify that effective `current_user` is `authenticated`/`anon`, has no bypass, is not a protected table owner, and has only approved grants inside every request transaction.
- Existing RLS enabled does not imply access is protected correctly. The prior catalog review reported missing policies/grants, excessive default privileges, and an unsafe `get_my_role()` security-definer function without a fixed `search_path`.
- Never use `service_role` or a BYPASSRLS identity for ordinary business queries. Server-side authorization must remain in place even after RLS is designed.
- Do not apply [`../supabase/rls.sql`](../supabase/rls.sql); it is an obsolete incompatible draft. Prepare a corrected baseline only after the actual catalog and identity crosswalk are refreshed and tested in isolated staging.

## Storage

| Bucket | Intended visibility | Application behavior | Required review |
|---|---|---|---|
| `product-images` | Public reads for approved visible listings | Server upload uses service-role storage client after route authorization; source caps each product image at 3 MiB and validates image content. | Verify bucket visibility, MIME/size limits, upload/delete path ownership, allowed public reads, and no arbitrary object access. |
| `payment-proofs` | User-provided current state: private, 5 MiB limit, JPEG/PNG/WebP; not independently queried | Proof uploads use buyer/payment-scoped keys; authorized reviewers receive short-lived signed URLs after server-side access checks, and signed-URL creation now verifies bucket visibility. | Do not recreate or modify based on this report. Confirm the settings and policies in an approved staging verification; test buyer ownership, assigned-cooperative Admin access, SuperAdmin access, and cross-cooperative denial. |
| `profile-verification-documents` | **Not confirmed to exist; proposed private bucket** | Buyer/Seller verification uses a server-authorized signed upload token, then the server downloads and checks the actual bytes before storing metadata. Reviewers receive 60-second signed URLs only after cooperative/platform authorization. | Do not assume it exists or create it automatically. If approved, manually configure private visibility, an exact 5 MiB limit, and only `image/jpeg`, `image/png`, and `image/webp`; review Storage policies before enabling. The application fails closed on missing or mismatched bucket configuration. |

QR images are handled as public payment-option images under scoped platform/cooperative paths. Deleting a payment option preserves historical evidence; object cleanup must be reference-aware and separately validated.

Identity-document retention is unresolved. The current workflow does not delete previous or abandoned uploads and has no retention schedule; the owner must decide retention and deletion requirements before enabling document collection. The additive `profileVerificationSubmissions` SQL draft is unexecuted and requires a separate catalog, RLS, grants, trigger, and policy review.

### Profile-verification setup sequence (manual; not executed)

1. Reconcile the current database catalog and ACLs with `supabase/migrations/20261117120000_profile_verification_submissions.sql`, including every quoted mixed-case identifier, the confirmed `user_verification_status` labels, the existing auth self-select/update policies, and RLS on `users`, `auditLogs`, and `notifications`. Review the trigger's applicant-versus-reviewer checks and its added restriction on edits to birthdate, phone, and address.
2. Resolve and approve the identity-document retention policy. Do not collect documents until ownership, retention, and deletion handling are decided.
3. If the bucket is absent and the project owner approves its creation, review and run `supabase/storage/profile_verification_bucket.sql` manually in the intended Supabase SQL Editor. It creates only the private bucket metadata and intentionally creates no client Storage policies. Do not apply it blindly to an existing bucket; reconcile any mismatch first.
4. Verify the setup script's booleans are all `true`: `expected_bucket`, `is_private`, `has_expected_size_limit`, and `has_expected_mime_types`. The bucket must be private, limited to exactly 5 MiB, and restricted to JPEG, PNG, and WebP.
5. After a separate review of preconditions, grants, RLS policies, trigger behavior, and rollback, an authorized database owner may manually apply the unexecuted profile-verification migration. The app does not apply migrations or create Storage buckets automatically.
6. Verify catalog columns, indexes, foreign keys, sequence privileges, RLS flags/policies, trigger and function definitions, and the narrow grants without disabling RLS. Then exercise the application flow only in an explicitly authorized test account/environment, checking a short-lived upload token, actual bytes, a short-lived review URL, a denied cross-user request, cooperative Admin isolation, SuperAdmin review, and atomic status/audit/notification outcomes.

Neither SQL file has been run or tested against a live Supabase project. Passing local tests are not evidence that the project schema, bucket, privileges, RLS, or Storage API matches these drafts.

## Realtime

No Supabase Realtime subscription is required by the active UI. Conversation history is persisted in PostgreSQL; local SSE is process-local and the client polls the database-backed message query as a fallback. Hosted multi-instance delivery remains unverified.
