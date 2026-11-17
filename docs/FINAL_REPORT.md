# AgriCoop Marketplace — Final Handoff Report

Branch: `finish/agricoop-complete`  
Generated: 2026-11-17  
Agent constraint: **no production SQL executed**; Supabase/Vercel used for read-only inspection only.

---

## 1. Connection verification

| System | Status | Details (names only) |
|--------|--------|----------------------|
| Supabase | OK | Project URL host `adxprwseqawqrwuijata.supabase.co`. Tables readable in `public` + `agricoop_app`. Migrations applied remotely: `20261016115411`, `20261016120149` only. |
| Vercel | OK | Project `agricoop-marketplace-final-capstone` (`prj_LCxJgY2qeXdRNBgOnTeXvJbgXXDI`). Latest READY deploy on branch `production-ui-port` (preview). Production target still points at older `recover-approved` deploy. Domains: `agricoop-marketplace-final-capstone.vercel.app`. |

No connection failures. Secrets were never printed or committed.

---

## 2. Schema reconcile (live vs Drizzle / drafts)

### Live `agricoop_app` tables present
cooperatives, users, products, quotations, orders, orderEvents, orderItems, transactions, conversations, conversationMessages, paymentOptions, paymentProofs

### Missing vs app/Drizzle (must apply MANUAL_SQL)
- Tables: `cooperativeAssociationRequests`, `productImages`, `payments`, `paymentEvents`, `notifications`, `supportTickets`, `supportTicketMessages`, `auditLogs`, `profileVerificationSubmissions`
- Column: `transactions.paymentOptionId` (+ FK)
- Storage bucket: `profile-verification-documents`
- RLS: all 12 live `agricoop_app` tables have **RLS on, 0 policies** (advisor confirmed)
- Grants: `authenticated` lacks USAGE on `agricoop_app` (required after request-scoped SET ROLE)

### Safe draft posture
November drafts were rewritten into ordered, idempotent repo migrations `20261117100000` → `20261117133000`. `paymentProofs.id` already has a live sequence; block 8 / `133000` is a no-op recreate guard. No DROP of production data.

---

## 3. What changed in the app

### Auth / roles
- Pre-approval whitelist in `server/_core/trpc.ts` so pending sellers can request cooperative association, update profile lightly, open support tickets, and read notifications without full operational approval.
- Suspended accounts still blocked on those paths.
- Marketplace + Checkout gate on `getAccountAccessRestriction` (pending/suspended).
- SuperAdmin-only “Add a cooperative” UI; Admin/SuperAdmin still share `AdminDashboard` (coop-scoped overview for officers).
- Payment proof upload allowed for `buyer` **or** `seller` when they are the order’s `buyerId` (sellers may also shop).

### Workflows
- Quotation respond/decide and order status updates emit `create_notification` writes.
- Reports page: officers use `cooperativeAdmin.overview`; SuperAdmin uses `admin.overview`; retry on error.
- Activity page: retry on query error.
- Support tickets: signed-out CTA to `/auth`.

### Deploy / hygiene
- `.env.example` lists required env **names** only.
- `docs/MANUAL_SQL.md` consolidated paste pack (`pnpm docs:manual-sql`).
- `db:push` guarded; local `db:test` harness scripts; `lint` alias = `tsc --noEmit`.
- Verify locally: **`pnpm check`**, **`pnpm lint`**, **`pnpm test`** (285 passed / 2 skipped), **`pnpm build`** — all green.

---

## 4. SQL you must run (in order)

1. Open Supabase → SQL Editor on project `adxprwseqawqrwuijata`.
2. Confirm PITR / backup before starting.
3. Paste **one block at a time** from [`docs/MANUAL_SQL.md`](./MANUAL_SQL.md):

| Order | Block | Source migration |
|------:|-------|------------------|
| 1 | Auth/profile access | `20261117100000_auth_profile_access.sql` |
| 2 | Active application tables | `20261117105000_active_application_tables.sql` |
| 3 | Transaction payment option | `20261117110000_transaction_payment_option.sql` |
| 4 | Profile verification | `20261117120000_profile_verification_submissions.sql` |
| 5 | App security helpers | `20261117130000_app_security_helpers.sql` |
| 6 | Marketplace RLS + grants | `20261117131000_marketplace_rls_grants.sql` |
| 7 | Secure audit/notification writes | `20261117132000_secure_audit_notification_writes.sql` |
| 8 | Payment proofs id default | `20261117133000_payment_proofs_id_default.sql` |
| 9 | Storage bucket (if present in pack) | profile-verification-documents |

Stop on any `RAISE EXCEPTION`. Do **not** re-run a failed half-applied block without reading the error and reconciling.

After success, optionally record versions in Supabase migration history to match filenames above.

---

## 5. Environment variables

### Required by the app (set in Vercel Production + Preview)

| Name | Present in Vercel? | Notes |
|------|--------------------|-------|
| `DATABASE_URL` | Yes (prod + development) | App Postgres connection |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser client |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only storage/admin |
| `APP_URL` | **Missing** | Add HTTPS production origin (email redirects / absolute links). Also in `.env.example`. |
| `SUPABASE_STORAGE_BUCKET` | Optional | Defaults toward `product-images` if unset |

### Also present on Vercel (legacy / integration; not all used by Vite server)
`POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

### Local only (never set on Vercel production)
`MIGRATION_DATABASE_URL`, `SEED_DATABASE_URL`, `TEST_DATABASE_URL`, `AGRICOOP_SEED_TARGET`, seed credential names — see `.env.example`.

---

## 6. Deploy steps

1. **Run MANUAL_SQL** blocks 1→9 on production Supabase (you).
2. Set **`APP_URL`** on Vercel to the production HTTPS origin.
3. Confirm Vercel project settings match `vercel.json`:
   - Build: `corepack pnpm build`
   - Output: `dist/public`
   - API: `api/index.ts` (rewrites `/api/:path*` → serverless; SPA fallback to `/index.html`)
4. Merge/push `finish/agricoop-complete` (or promote) to the branch Vercel uses for Production (currently Production deploy is still from `recover-approved`).
5. Smoke after deploy:
   - `/` loads
   - `/api/trpc/...` health or `auth.me` responds
   - Sign-in → role dashboards (buyer / seller / admin / superadmin)
   - Seller pending: cooperative association request
   - GCash checkout only after block 3 (`paymentOptionId`)
   - Support ticket + audit log pages after blocks 2/5/7

Agent did **not** push or create a production deployment from this branch.

---

## 7. Decisions made without asking

- Kept officer cancel/complete as officer-only (existing rule).
- `transactions.paymentOptionId` is the canonical GCash link (not a parallel payments-only path for checkout writes).
- Pending sellers get a narrow pre-approval API surface instead of a second auth stack.
- Admin officers continue on `AdminDashboard` (not the lighter unused `OfficerDashboard`) so payment/product/association queues remain available.
- Sellers who place orders as buyers may upload GCash proofs for those orders.
- `pnpm lint` aliases to TypeScript check (no ESLint package in repo).

---

## 8. Known remaining issues

- **Production SQL not applied yet** — app will hard-fail many mutations until MANUAL_SQL runs.
- **`APP_URL` missing on Vercel** — set before relying on redirect/email absolute URLs.
- Vercel **Production** deploy is not yet this branch; latest READY is preview on `production-ui-port`.
- Advisor: `public.get_my_role` still executable by anon/authenticated (legacy); migrations intentionally do not revoke it because older public policies depend on it.
- Advisor: leaked-password protection disabled in Auth (dashboard toggle).
- Placeholder product images still used when `primaryImageUrl` missing.
- Product detail page has no add-to-cart CTA (marketplace remains the purchase path).
- `OfficerDashboard` component remains in tree but unused (documented for possible future split).
- Quoted-order “place at quoted price” remains cash-only (no GCash branch).

---

## 9. Local verification evidence

```
pnpm check  → pass
pnpm lint   → pass (tsc)
pnpm test   → 285 passed, 2 skipped
pnpm build  → Vite client + esbuild server → dist/
```
