# Deployment (Vercel + existing Supabase)

**Do not deploy until owner has applied the migration runbook and smoke-tested Auth.**

## Vercel

- Build: `corepack pnpm build` (`vercel.json` `buildCommand`)
- Output: `dist/public`
- API: `api/index.ts` → `/api/*` rewrite; `maxDuration: 30`
- Implication: large uploads and SSE must finish or degrade within 30s; polling is primary for conversations/notifications

## Environment variable NAMES

Server-only (Vercel project env, never `VITE_`):

- `DATABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET` (if used)
- `APP_URL` (HTTPS origin)

Client-safe / public:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `VITE_APP_ID` (non-secret app id)
- `VITE_FRONTEND_FORGE_API_KEY` / `VITE_FRONTEND_FORGE_API_URL` — **public by definition**; restrict by HTTP referrer/domain in the provider console or remove Map usage

Do **not** set `MIGRATION_DATABASE_URL` or `SEED_DATABASE_URL` on Vercel runtime.

See [`ENVIRONMENT.md`](./ENVIRONMENT.md) for the full name table.

## Supabase Auth checklist

- Email signup + confirmation required
- Site URL = production `APP_URL`
- Redirect allowlist includes `APP_URL/auth?verification=success`
- SMTP / email delivery configured
- Auth rate limits enabled

## Storage buckets

| Bucket | Expected |
|---|---|
| `product-images` | public |
| `payment-proofs` | private, 5 MiB, JPEG/PNG/WebP |
| `profile-verification-documents` | private, 5 MiB, JPEG/PNG/WebP — create via `supabase/storage/profile_verification_bucket.sql` if missing |

Service-role bypasses Storage RLS; app mediates private objects. Prefer default-deny for anon/authenticated direct object access.

## Post-deploy smoke

Health `GET /api/health` → ok; sign-in all four roles; marketplace anon browse; checkout; payment proof; admin review; audit logs page for Admin/SuperAdmin.

## Rollback

- Vercel: redeploy previous deployment
- DB: PITR / migration file ROLLBACK comments (prefer PITR if mid-sequence)
