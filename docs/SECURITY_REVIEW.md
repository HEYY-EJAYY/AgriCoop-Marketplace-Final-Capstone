# AgriCoop Marketplace Security Review

## Scope and limits

This was a read-only review of active application authorization code and server entry points. No production service, database, Supabase Auth, Storage, RLS policy, or secret value was accessed. The active database permission/RLS behavior cannot be established from source alone.

## Confirmed exploitable vulnerabilities

No exploitable vulnerability met the security reviewer’s reporting threshold in the active code paths reviewed. This is not a claim that the production deployment is secure: live database grants, RLS, Storage policies, Auth settings, and end-to-end authorization have not been verified.

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| — | — | — | — | No confirmed exploitable vulnerability met the reporting threshold. | — |

## Deployment gates (not confirmed vulnerabilities)

| Priority | Evidence | Risk if precondition is true | Required action |
|---|---|---|---|
| P0 | [`drizzle/pg-schema.ts`](../drizzle/pg-schema.ts#L17) defines active marketplace tables in `agricoop_app`; [`supabase/rls.sql`](../supabase/rls.sql#L1) is explicitly obsolete and targets a mismatched model. The acceptance report records live RLS/grants as unverified. | If production grants are permissive or effective RLS is absent, restricted marketplace data may be exposed. Production state was not checked. | Refresh catalog and effective-role evidence; prepare least-privilege grants and schema-correct policies; test Buyer/Seller/Admin/SuperAdmin isolation in approved staging. Do not execute the obsolete SQL. |
| P0 | [`docs/PRODUCTION_DATABASE_MIGRATION.md`](./PRODUCTION_DATABASE_MIGRATION.md) records that no complete PostgreSQL baseline is present and the prior catalog evidence is partial. | Routes depending on absent tables/columns or incompatible constraints will fail against production. | Reconcile the complete catalog and data crosswalk, generate/review additive PostgreSQL migrations, and validate them in isolated staging before release. |
| P1, conditional | Vercel entry [`api/index.ts`](../api/index.ts#L1) uses [`server/_core/app.ts`](../server/_core/app.ts#L34), which does not mount the legacy storage proxy. The package-server entry [`server/_core/index.ts`](../server/_core/index.ts#L43) does. | Existing product-image records that reference `/manus-storage/` URLs will not be served by Vercel. Whether any such production references exist was not verified. | Inventory product image URLs without exposing user data. If legacy references exist, migrate them to supported Storage URLs or adapt and test the secured proxy on Vercel; otherwise document that the route is intentionally retired. |
| P1 | Auth email delivery, redirect allowlist, private proof bucket, and Storage policies are not live-verified. | Signup callbacks, proof upload/review, or image operations may fail or be improperly exposed if configuration is absent or overly permissive. | Apply the checklist in [`SUPABASE_CONFIGURATION.md`](./SUPABASE_CONFIGURATION.md) through an approved staging change and verify with four controlled roles. |
| P1 | Historical identities may have been auto-confirmed before the current verification flow. | `email_confirmed_at` alone cannot distinguish prior auto-confirmation from mailbox verification. | Have the account owner review affected identities; do not silently rewrite, delete, or suspend records. |

## Active-code observations

- Both active server entry points use `server/routers.ts`. `server/routers.fixed.ts` is unreferenced legacy code and was not treated as an active router.
- The Vercel app mounts the conversation stream but not the legacy storage proxy; local tests cover the route mounting distinction.
- The standalone conversation stream now checks Supabase email verification, operational account state, role/scope authorization, and handles provider/database errors without returning success-shaped fallbacks. Focused regression tests were added in [`server/_core/conversationStream.test.ts`](../server/_core/conversationStream.test.ts).
- The storage proxy remains package-server-only, restricted to referenced product images; it does not sign arbitrary paths or payment proofs. Its security does not make Vercel legacy-image URLs work.
- Source-level helper and unit tests do not prove that the configured production PostgreSQL identity is effectively subject to RLS. Confirm `session_user`, `current_user`, effective `BYPASSRLS`, table ownership, grants, and policies in an approved test environment.

## Release decision

**Do not promote to public production until all P0 gates and required P1 integration checks are cleared.** This review found no source-level exploitable vulnerability to fix from its evidence alone; the remaining gates depend on production catalog/configuration evidence and approved staging tests.
