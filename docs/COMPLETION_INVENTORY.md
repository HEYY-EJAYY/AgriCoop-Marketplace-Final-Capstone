# AgriCoop Completion Inventory

Running checklist for `finish/agricoop-complete`. Update as items complete. Resume from the first unchecked item after any interruption.

**Branch:** `finish/agricoop-complete` (from `production-ui-port` @ `e035ed2`, dirty worktree preserved)  
**Safety:** No production SQL executed. Migrations are prepared only.  
**Catalog CSV:** NOT FOUND at `docs/catalog/` — rely on `docs/PRODUCTION_DATABASE_MIGRATION.md` + `supabase/PRODUCTION_CATALOG_INSPECTION.sql` (owner-run).

---

## Phase 1 — Inspect & reconcile

- [x] Git branch/status/log verified; switched to `finish/agricoop-complete`
- [x] `users-backup.json` untracked (`git ls-files` empty)
- [x] Stack/config re-verified (`package.json`, `vercel.json`, `drizzle.config.ts` → `pg-schema.ts`)
- [x] Auth/DB model re-verified (`server/db.ts`, `_core/context.ts`, `_core/trpc.ts`, `authz.ts`)
- [x] Four November migration drafts inventoried (unapplied locally; production history NOT VERIFIED)
- [x] Feature classification + B1–B16 status drafted (below)
- [x] Secret/danger grep sweeps run (results below)
- [x] Gate 1 posted in chat

---

## Section 0 re-verification

| Claim | Evidence | Status |
|---|---|---|
| Branch was `production-ui-port`, HEAD `e035ed2`, heavily dirty | Confirmed before switch; now `finish/agricoop-complete` with same dirty tree | CONFIRMED |
| React 19 / Vite 7 / TS 5.9 / Express / tRPC 11 / Drizzle 0.44 / postgres-js / Supabase / Vitest / pnpm / Vercel | `package.json`, `vercel.json`, `api/index.ts` | CONFIRMED |
| Bearer → Auth UUID → `users.openId`; role via profiles/roles; request-scoped `set_config` | `context.ts`, `db.ts`, `trpc.ts` | CONFIRMED |
| `getDb()` requires ALS scope; `getAdminDb()` = `SEED_DATABASE_URL` | `db.ts` | CONFIRMED |
| Login role / `rolbypassrls` unknown | No live DB access | NOT VERIFIED |
| `pg-schema.ts` active; `drizzle/schema.ts` + `0000–0011` MySQL legacy | `drizzle.config.ts` schema path; `0010` MySQL syntax | CONFIRMED |
| Four drafts in `supabase/migrations/` | Files present | CONFIRMED |
| Production history only Oct migrations | Live MCP `list_migrations`: only `20261016115411`, `20261016120149` | CONFIRMED |
| Catalog CSV at `docs/catalog/` | Glob: 0 files | ABSENT |
| Live project | Supabase `adxprwseqawqrwuijata` “AgriCoop Marketplace”, ACTIVE_HEALTHY, ap-southeast-1 | CONFIRMED 2026-11-17 |
| 12 agricoop_app tables, RLS on, 0 policies | Live SQL + security advisor | CONFIRMED |
| Missing 8 app tables + profileVerification + `transactions.paymentOptionId` | Live list_tables / column check | CONFIRMED absent |
| `paymentProofs.id` default | Live: `nextval('agricoop_app."paymentProofs_id_seq"')` | HAS SEQUENCE (B8 sequence add will no-op; unique index still needed) |
| Buckets | `product-images` public 5MiB; `payment-proofs` private 5MiB; **no** `profile-verification-documents` | CONFIRMED |
| `authenticated` USAGE on `agricoop_app` / SELECT users | both **false** | CONFIRMED (explains auth DB denial if SET ROLE works) |
| MCP login role | `postgres`, `rolbypassrls=true` | CONFIRMED for MCP only — app `DATABASE_URL` role still NOT VERIFIED |
| `get_my_role` | SECURITY DEFINER, `search_path=""`, used by many **legacy public.*** policies | CONFIRMED — do not revoke EXECUTE until legacy public policies reconciled |

---

## Feature classification (file:line evidence)

| Area | Status | Evidence / gap |
|---|---|---|
| Auth register/login/email verify | PARTIAL | `routers.ts` auth.*; `registration.ts`; production Auth settings NOT VERIFIED |
| Profile self-update (harmless cols) | COMPLETE | `account.updateProfile` ~359 |
| Profile verification upload/review | COMPLETE (blocked by unapplied mig + bucket) | `account.*Verification*`; mig `20261117120000_*` |
| Marketplace browse/detail | COMPLETE (code); RLS BLOCKED | `marketplace.*`; `db.ts:273–354` filters approved+visible |
| Cart | COMPLETE (client sessionStorage acceptable) | Checkout page |
| Checkout / orders / stock reserve | COMPLETE (code) | `orders.create` ~901–1018; reserve event; no `payments` row created |
| GCash proof HMAC flow | COMPLETE (code) | `payments.uploadProof` / `finalizeProofUpload` / `reviewProof` |
| Cash receipt | COMPLETE | `recordCashReceipt` ~1822 — updates orders+transactions only |
| Refunds | BROKEN/PARTIAL | Depends on `payments` rows; active `orders.create` never calls `ensureOrderPaymentRecord` (`db.ts:183`; only `routers.fixed.ts`) |
| Payment options admin UI | COMPLETE | `/admin/payment-options` + `adminPayment.*` |
| Products CRUD/images/review | COMPLETE | `products.*`, `admin.reviewProduct` |
| Cooperative association | COMPLETE | `cooperativeAssociations.*`, `cooperativeAdmin.*` |
| Cooperatives create | PARTIAL | `cooperatives.create` superadmin-only; UI on AdminDashboard; **no update/deactivate** |
| Quotations | PARTIAL | Request/respond/decide exist; **no notification** on quotation updates |
| Messaging + SSE | PARTIAL | Authz OK; SSE process-local (`realtime.ts`); polling 5s on Support |
| Notifications inbox | PARTIAL | mine/markRead + 30s poll; createNotification open INSERT will fail under mig-4 policy |
| Support tickets | COMPLETE (code) | `support.*` |
| Audit log write | BROKEN under planned RLS | 10× `recordAuditLog` ordinary INSERT (`routers.ts:175`) |
| Audit log read UI | MISSING | No router/UI |
| Platform settings | MISSING / N/A as separate entity | Blueprint §9.7 = superadmin ops already partly covered; no settings table |
| Buyer order cancel | DEVIATION | Officer-only cancel (`canUpdateOrderStatus` / d518d0d); keep; owner decision |
| DashboardLayout Page 1/2 | BROKEN/DEAD | Placeholders; component unused by routes |
| Hero image | COMPLETE | `Home.tsx` → `/images/hero-banner.webp` (exists); `agricoop-hero.webp` deleted, **no references** |

---

## B1–B16 work items

| ID | Severity | Status | Notes |
|---|---|---|---|
| B1 | CRITICAL | OPEN → Phase 2 | Mig 2 revokes 8 tables; existing 12 tables reportedly RLS-on / 0 policies |
| B2 | CRITICAL | OPEN → Phase 2+4 | Audit INSERT + notification types exceed mig-4 allow-list |
| B3 | HIGH | MITIGATED | No CSV; use docs + owner inspection SQL |
| B4 | HIGH | OPEN → Phase 2 | Bucket script exists (safe-ish refuse mismatch); no `storage.objects` policies in repo |
| B5 | HIGH | DECIDED | Keep `transactions.paymentOptionId`; supersede `payment_option_link.sql` |
| B6 | MEDIUM | OPEN → Phase 2 | Model FKs/uniqueness on profiles/roles if catalog allows |
| B7 | MEDIUM | OPEN → Phase 4/6 | Polling primary; SSE optional |
| B8 | MEDIUM | OPEN → Phase 2 | Additive sequence + optional partial unique on pending/verified |
| B9 | MEDIUM | OPEN → Phase 4 | Wire `ensureOrderPaymentRecord` into order create / cash / proof verify |
| B10 | MEDIUM | OPEN | No `cancelled` on `order_payment_status` in Drizzle; templates add values — isolate if owner needs; current cancel path avoids writing cancelled payment enum |
| B11 | MEDIUM | OPEN | `get_my_role` body/ACL NOT VERIFIED live; inspect via owner queries before EXECUTE changes |
| B12 | MEDIUM | OPEN → Phase 5 | Neutral `db:push` |
| B13 | LOW | OPEN → Phase 5/6 | Remove/wire DashboardLayout placeholders |
| B14 | LOW | OPEN → Phase 5 | Manus/Forge leftover; Map uses public `VITE_FRONTEND_FORGE_*` |
| B15 | LOW | MOSTLY DONE | Deleted hero unused; Home uses `hero-banner.webp` |
| B16 | SPEC | OPEN | Audit read; coop update/deactivate; platform settings clarification; buyer-cancel deviation listed |

---

## Table × operation × role matrix (drives Phase 2)

Legend: B=buyer, S=seller, A=admin(coop), SA=superadmin, An=anon, T=trigger/definer, Sys=server service-role (Auth/Storage only).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `users` | self; A/SA scoped peers (needed for admin overview, association, verification) | self reg (buyer/seller only) | self harmless cols; A/SA protected cols via trusted paths + guard | none |
| `profiles` | self / officer helper | self reg | none for app roles (or narrow self non-role cols if required) | none |
| `roles` | authenticated read of 4 names | none | none | none |
| `cooperatives` | anon+auth active list; SA all | SA | SA (new) | none |
| `cooperativeAssociationRequests` | seller own; A/SA coop | seller | A/SA review | none |
| `products` | anon approved+visible+published (+seller approved); seller own; A/SA scope | seller | seller own; A/SA review | none (archive only) |
| `productImages` | same as product visibility | seller on own product | seller | seller on own |
| `orders` | buyer/seller own; A/SA coop | buyer | seller confirm/ready; A/SA complete/cancel | none |
| `orderItems` | via order access | with order create | A/SA on complete | none |
| `orderEvents` | via order access | participants/staff on actions | none | none |
| `transactions` | via order access | with order create | payment/cash/refund paths | none |
| `paymentOptions` | checkout active scoped; A/SA manage | A/SA | A/SA | A/SA |
| `paymentProofs` | buyer own; A/SA reviewers (not participants) | buyer | A/SA review | none |
| `payments` | buyer/seller own; A/SA | server on order/payment paths | A/SA refund/verify | none |
| `paymentEvents` | via payment access | staff/system on payment actions | none | none |
| `conversations` | participants + A/SA | buyer create | participants touch updatedAt | none |
| `conversationMessages` | participants + A/SA | participants | none | none |
| `quotations` | buyer/seller own | buyer | seller respond; buyer decide | none |
| `notifications` | recipient only | **SECURITY DEFINER fn only** | recipient mark-read | none |
| `supportTickets` | owner; A/SA scope | any auth | A/SA status/assign | none |
| `supportTicketMessages` | ticket access | ticket access | none | none |
| `auditLogs` | A coop / SA all | **SECURITY DEFINER / trigger only** | none | none |
| `profileVerificationSubmissions` | self; A/SA review | self | A/SA review | none |

---

## Read-only sweep results

| Check | Result |
|---|---|
| Hardcoded JWT/`service_role` secrets in client | None found (env name stubs in tests only) |
| `service_role` in client source | None |
| `dangerouslySetInnerHTML` | `client/src/components/ui/chart.tsx:81` (Recharts theme) |
| String-concat SQL | Parameterized `sql` tagged templates only |
| `alert`/`prompt`/`confirm` | None in `*.ts`/`*.tsx` |
| `agricoop-hero.webp` refs | None |
| `routers.fixed.ts` imports | None (unreferenced) |
| CORS middleware | Absent in `createApp` / `index.ts` (same-origin Vercel rewrite) |
| Rate limits | Registration IP/email in-memory only (`registration.ts`) |

---

## Suspicious / local-only files (do not delete without approval)

| File | Touches DB? | Secrets? | Recommendation |
|---|---|---|---|
| `users-backup.json` | N/A | Possibly PII — NEVER read/commit | `.gitignore`; Gate 2 |
| `check-permissions.mjs` | Likely | Unknown — do not open for values | ignore / `scripts/local/` |
| `test-identity-resolution.ts` | Likely | Unknown | ignore / local |
| `test-roles.mjs` | Likely | Unknown | ignore / local |
| `verify-auth.js` / `.mjs` | Likely Auth | Unknown | ignore / local |
| `verify-db.ts` | Yes | Unknown | ignore / local |
| `supabase/test.txt` | No | Unlikely | ignore |
| `server/routers.fixed.ts` | Legacy alt router | No | keep out of commits or archive |
| `.vercel/` | No | May contain project meta | `.gitignore` |

---

## Phase progress

- [x] Phase 1 inventory
- [x] Phase 2 migrations + runbook + RLS matrix + pg-schema
- [x] Phase 3 local DB harness (safety + compose + setup; Docker apply NOT VERIFIED)
- [x] Phase 4 backend (secure writers, payments ensure, audit list, coop update/status)
- [x] Phase 5 hygiene (db:push guard, gitignore, placeholders, superseded templates)
- [x] Phase 6 frontend (AuditLogs page/nav; notification poll visibility)
- [x] Phase 7 test/build/verify (285 passed / 2 skipped)
- [x] Docs + Gate 2 STOP — waiting for owner `approved` before commits
