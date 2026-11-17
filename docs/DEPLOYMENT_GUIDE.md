# Vercel Deployment Guide

## Release status

**Not ready for production deployment.** The application and Vercel entry build locally, but the existing production database schema, effective role/RLS behavior, Storage policies, Auth/email settings, and authenticated browser workflows have not been verified. Do not deploy until the blockers in [`PRODUCTION_DATABASE_MIGRATION.md`](./PRODUCTION_DATABASE_MIGRATION.md), [`SUPABASE_CONFIGURATION.md`](./SUPABASE_CONFIGURATION.md), and [`FINAL_ACCEPTANCE_REPORT.md`](./FINAL_ACCEPTANCE_REPORT.md) are cleared.

## Architecture

- Vite builds the React client to `dist/public`.
- Vercel invokes [`api/index.ts`](../api/index.ts), which exports the Express app from [`server/_core/app.ts`](../server/_core/app.ts) without starting a persistent listener.
- `vercel.json` routes `/api/*` to that function and sends other paths to the SPA entry. The function has `maxDuration: 30`.
- The package-server command uses [`server/_core/index.ts`](../server/_core/index.ts) and starts a listener; it is for local/package hosting, not Vercel.
- Both active server entry points use `server/routers.ts`. Do not activate `server/routers.fixed.ts`.
- Conversation messages persist in PostgreSQL. SSE uses process-local state, reconnects, and has database polling fallback; it is not a cross-instance delivery guarantee.

## Local checks

1. Confirm `.env.local` points only to an explicitly approved disposable/local PostgreSQL database before running the server. This command loads the file but reports only whether the database hostname is loopback; it does not print the URL or credentials:

```powershell
node -e "require('dotenv').config({path:'.env.local'});try{const u=new URL(process.env.DATABASE_URL||'');const ok=['localhost','127.0.0.1','::1','[::1]'].includes(u.hostname.toLowerCase());console.log(ok?'DATABASE_URL target: local loopback':'DATABASE_URL target: NON-LOCAL; do not start or seed');if(!ok)process.exit(1)}catch{console.error('DATABASE_URL is missing or invalid; do not start or seed');process.exit(1)}"
```

Do not inspect or paste secret values into reports. If the check reports non-local, do not start the app; the dev server uses the configured `DATABASE_URL`. Local PostgreSQL/Supabase tooling or an owner-approved isolated target can be used without creating a separate cloud project.
2. Install from the lockfile: `corepack pnpm install --frozen-lockfile`.
3. Run `corepack pnpm check`, `corepack pnpm test`, and `corepack pnpm build`.
4. Independently bundle the Vercel entry (no output artifact required):

```powershell
node -e "import('esbuild').then(async ({build})=>{await build({entryPoints:['api/index.ts'],bundle:true,platform:'node',format:'esm',packages:'external',write:false});console.log('Vercel API bundle: PASS')}).catch(error=>{console.error(error.message);process.exit(1)})"
```

5. Validate `vercel.json` as JSON and verify the function, rewrite, output-directory, and duration settings.
6. Do not run `pnpm db:push`, Drizzle migration commands, or seed commands against an unknown or production target.

`corepack pnpm dev` starts the package server and reads `.env.local`; do not use it until the database target has been safely established. It can otherwise connect to whatever `DATABASE_URL` is configured.

## Vercel project settings

- Root directory: repository root.
- Framework preset: Other (Vite/Express configuration is explicit).
- Build command: `corepack pnpm build`.
- Output directory: `dist/public`.
- API function: `api/index.ts`, Node.js runtime, 30-second maximum duration.
- Initial domain: use the Vercel-provided deployment domain.
- Vercel CLI was not installed during the current local verification. Do not install/link/deploy until production schema and Supabase settings are approved.

## Environment variables

Required for the active Vercel application, names only:

- `DATABASE_URL` — server-only PostgreSQL runtime connection.
- `NEXT_PUBLIC_SUPABASE_URL` — public project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public/publishable key.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only Auth/Storage administration.
- `APP_URL` — exact HTTPS application origin used for email callbacks.

Optional: `SUPABASE_STORAGE_BUCKET` (defaults to `product-images`). `BUILT_IN_FORGE_API_URL`/`BUILT_IN_FORGE_API_KEY` are only for optional helper/legacy services and are not needed by the Vercel product-storage path. Do not place `MIGRATION_DATABASE_URL` or `SEED_DATABASE_URL` in the Vercel runtime environment.

Never set database URLs, service-role keys, or private credentials under a `VITE_` or `NEXT_PUBLIC_` name. Only the Supabase project URL and publishable/anon key belong in the browser bundle.

## Supabase setup before deployment

1. Enable required Auth email confirmation, configure the Site URL and allow `APP_URL/auth?verification=success`.
2. Set up verified email delivery/SMTP and Auth limits.
3. Have the database owner refresh the production catalog, prepare and test reviewed additive migrations, grants, and RLS in isolated staging; no migration is ready to execute from the current partial catalog.
4. Verify public `product-images` and private `payment-proofs` buckets and policies without changing production until approved.
5. Review the historical auto-confirmed user population and the user-ID-2 role conflict without automatically altering accounts.
6. Run the four-role authenticated staging acceptance and cross-cooperative isolation suite.

## Four-role browser acceptance plan

Use synthetic accounts and test products in an isolated local stack or an explicitly approved non-production target. Do not use production seed scripts or production records as test fixtures. For Admin isolation, provision two cooperatives and one Admin assigned to each. Keep service-role keys out of browser tools and screenshots.

1. **Buyer:** register as Buyer, complete the email link, sign in, browse approved listings, create a quotation/order, submit a test GCash proof or choose cash, inspect own order/payment/support history, message the Seller, create a support ticket while unassigned, and verify another Buyer's IDs are denied. Confirm selecting cash does not mark payment received.
2. **Seller:** register as Seller, verify email, request cooperative association, and confirm association review does not itself bypass account approval. After approval, create/edit a listing with a ten-image gallery, confirm content edits return it to moderation, manage stock including zero, respond to a quotation, process an eligible order transition, and verify another Seller's products/orders are inaccessible.
3. **Cooperative Admin:** sign in with cooperative A, moderate only A's products, review A's proof, record an authorized cash receipt without changing cash to paid automatically, and exercise refund recording/state transitions within A. Upload, replace, and delete an authorized QR option. Attempt the equivalent operations using cooperative B IDs and verify denial. Confirm support assignments and private tickets remain scoped to A.
4. **SuperAdmin:** verify platform-wide cooperative/product/order/support/payment visibility; approve/reject moderation; upload, replace, and delete QR options; and complete authorized refund/support actions across cooperatives. Confirm external GCash refund completion still requires evidence/state confirmation and all actions produce audit events.
5. **All roles:** refresh pages after each transition; check query errors, retry/loading states, notifications, chat polling/reconnect behavior, audit records, ownership boundaries, and expected database state. Run negative-ID/cross-user/cross-cooperative cases in the same automated integration suite.

## Deploy only after blockers clear

The CLI must be installed and authenticated by an authorized operator, and the project linked to the existing Vercel project. Then run preview first:

```powershell
corepack pnpm check
corepack pnpm test
corepack pnpm build
vercel deploy
```

Perform the live acceptance checklist in a controlled environment before production promotion. Only after owner approval and a successful preview:

```powershell
vercel deploy --prod
```

No deployment was made or claimed by this assessment.

## Rollback

- Keep the prior Vercel deployment available and use Vercel's deployment rollback only after verifying it remains compatible with additive database changes.
- Database rollback is not an application redeploy. Require a pre-change backup and use a reviewed forward repair or a verified restore procedure; never drop tables or delete data to roll back.
- Recheck health, Auth, DB effective role/RLS, Storage, payment, and all four role workflows after rollback.
