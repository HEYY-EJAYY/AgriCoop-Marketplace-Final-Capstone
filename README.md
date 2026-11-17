# AgriCoop Marketplace

Cooperative-centered agricultural marketplace for Buyers, Sellers, Admins (coop officers), and SuperAdmins.

## Stack

- React 19 + Vite 7 + Wouter + Tailwind 4
- Express 4 + tRPC 11 (Vercel serverless adapter in `api/index.ts`, `maxDuration` 30s)
- Drizzle ORM 0.44 + **PostgreSQL** (`drizzle/pg-schema.ts`, schema `agricoop_app`)
- Supabase Auth, Storage; Vitest; pnpm

> MySQL-era files under `drizzle/0000–0011_*.sql` and `drizzle/schema.ts` are **LEGACY**. Do not run them against Supabase. `supabase/rls.sql` is **DEPRECATED**.

## Roles

- **Buyer:** browse approved+visible products, cart/checkout, GCash proof upload, quotations, messaging, support
- **Seller:** products/images, association request, orders (confirm/ready), quotations, cash receipt on own ready cash orders
- **Admin:** cooperative-scoped members, product review, payment verification, payment options, support, audit logs
- **SuperAdmin:** platform-wide admin plus cooperatives create/update/deactivate

## Local setup

1. Copy `.env.example` → `.env.local` and fill **names only documented there** (never commit secrets).
2. `corepack pnpm install`
3. Point `DATABASE_URL` at a **local** Postgres only for `pnpm dev`. Never use production credentials for seeds or `db:push`.
4. `corepack pnpm check` / `corepack pnpm test` / `corepack pnpm build`
5. `corepack pnpm dev` (loads `.env.local`)

### Database scripts (safety)

- `pnpm db:generate` — Drizzle SQL generate only
- `pnpm db:push` — **blocked by default** (B12). Production migrations are owner-run SQL in `supabase/migrations/` (see `docs/PRODUCTION_MIGRATION_RUNBOOK.md`)
- Seeds require `AGRICOOP_SEED_TARGET=local` and localhost `SEED_DATABASE_URL`

### Local RLS / concurrency harness

```powershell
docker compose -f scripts/db-test/docker-compose.yml up -d
$env:TEST_DATABASE_URL = "postgresql://agricoop_login:agricoop_test_password@127.0.0.1:55432/agricoop_test"
node scripts/db-test/setup.mjs
corepack pnpm test
```

Harness refuses non-localhost URLs. If Docker/`TEST_DATABASE_URL` is unavailable, DB-backed harness tests skip and are **NOT VERIFIED**.

## Production migrations

Owner-only, in Supabase SQL Editor, after backup/PITR. Ordered files and SKIP list: [`docs/PRODUCTION_MIGRATION_RUNBOOK.md`](docs/PRODUCTION_MIGRATION_RUNBOOK.md). Policy matrix: [`docs/RLS_POLICY_MATRIX.md`](docs/RLS_POLICY_MATRIX.md).

## Realtime note

Conversation SSE is process-local and unsuitable as the sole mechanism on multi-instance Vercel (30s cap). UI polling is the reliable primary path; SSE is a best-effort enhancement.

## Docs

- [`docs/COMPLETION_INVENTORY.md`](docs/COMPLETION_INVENTORY.md) — running checklist
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) — env var **names**
- [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md) — deploy notes (update alongside Gate 2 `DEPLOYMENT.md`)
