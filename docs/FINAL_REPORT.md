# AgriCoop Marketplace — Final Ship Report

Branch: `finish/agricoop-complete`  
Live URL: **https://agricoop-marketplace-final-capstone.vercel.app**  
Updated: 2026-11-18 (verification + hardening follow-up)

---

## Part 2 — registration, applications, add account, order archive (2026-11-18)

**Branch:** `finish/agricoop-complete`  
**Production:** READY — https://agricoop-marketplace-final-capstone.vercel.app (`275dfe7`, `dpl_HwEghTtkP5s6eo2vL7gqTVz2SUUm`)  
**Design freeze:** No new marketing/shell layout changes in Part 2; additive DB and targeted surfaces only (Auth coop select, Cooperative Admin application, SuperAdmin Applications tab, buyer Activity Active/Archived, Add account). Officer Admin (`admin` role) remains **global** — not scoped to a single cooperative.

### Production blockers (2026-11-18 follow-up, design freeze)

| ID | Root cause | Fix |
|----|------------|-----|
| **A** | `cooperativeAdminApplications` Drizzle insert listed ungranted DEFAULT columns → `42501` on Cooperative Admin signup | Explicit-column SQL insert; orphan Auth repair on duplicate unconfirmed email; coop-create audit uses allowlisted `user_access_updated` |
| **B** | Verified Auth without app user after partial registration | Self-heal in `getUserByVerifiedAuthId` (buyer + profiles), rate-limited, context passes email/name metadata |
| **C** | Resend UX | 60s client cooldown; JSON-only tRPC fetch guard |
| **D** | Non-JSON / stack traces in client errors | `httpBatchLink` fetch wrapper; softened `ErrorBoundary` |
| **E** | `products.create` `updatedAt` INSERT + listing errors | Explicit product INSERT SQL; `42501` mapping; migration `20261118130000_part2_insert_grants_apps_and_products.sql` |

### Deliverables (A–E)

| Item | Scope | Commit |
|------|--------|--------|
| **A** | Cooperative choice at registration (searchable select, add-new, Did you mean…?, `source`/`createdBy`) | `4930460` (+ `61dc596` upsert intent, `9e95cd6` coop persist) |
| **D** | Buyer per-user order archive via `threadStates.channel = 'order'`; Activity Active/Archived | `51a5879` |
| **C** | Admin-managed account creation (Buyer/Seller; SuperAdmin may create Officer Admin) + invite recovery | `c4994ad` |
| **B** | Cooperative Admin application + SuperAdmin review (`/applications/cooperative-admin`, Applications tab) | `54ecacd` |
| **E** | Storage keys, access/RLS tests, MANUAL_SQL BLOCK 20–21, docs/PDF, prod migrate + READY, CI green | `b98f1f0` → `275dfe7` |

### Database (additive only)

| Migration | MANUAL_SQL | Purpose |
|-----------|------------|---------|
| `20261118120000_part2_registration_applications_order_archive.sql` | **BLOCK 20** | `cooperativeAdminApplications`, `requestedRole`, coop provenance, private application bucket + RLS, notification types, `create_user_cooperative` |
| `20261118121000_buyer_order_archive_channel.sql` | **BLOCK 21** | `threadStates` channel check includes `order` |

**Production apply status:** **Applied** via Supabase MCP (`part2_registration_applications_order_archive`, `part2_notification_allowlist_coop_admin_apps`, `buyer_order_archive_channel`). Verified: apps table, `requestedRole`, coop `source`, `create_user_cooperative`, private `coop-admin-applications` bucket, `threadStates` channel includes `order`.

### Item E code polish (uncommitted → this commit)

| Area | Change |
|------|--------|
| Storage upload path | `officerApplications.*` signed upload uses bucket-relative `{openId}/{uuid}.ext` (matches storage RLS `split_part(name,'/',1) = auth.uid()`) |
| Validator | `isCoopAdminApplicationStorageKey` accepts preferred key + legacy `{bucket}/{openId}/…` draft |
| Bucket bootstrap | `ensureBucket` size/MIME for `coop-admin-applications` |
| Audit | SuperAdmin review uses allowlisted `user_access_updated` with `decision` metadata (parent aligns `write_audit_log` allowlist) |
| Tests | `trpcProcedureAccess.test.ts` (applicant vs Officer Admin vs SuperAdmin); `dbHarness.rls.test.ts` Part 2 privilege smoke; existing `part2Access.test.ts` + `orderArchive.test.ts` |

### Tests / gates (Item E)

| Gate | Command |
|------|---------|
| Typecheck | `pnpm run check` |
| Part 2 unit | `pnpm exec vitest run server/part2Access.test.ts server/trpcProcedureAccess.test.ts server/orderArchive.test.ts` |
| Docker RLS (optional local) | `pnpm run db:test:rls` includes Part 2 harness case when `TEST_DATABASE_URL` set |

### Thesis PDF

Regenerated via `pnpm run docs:system` (`scripts/build-system-docs.mjs` → `docs/AgriCoop_System_Documentation.pdf`) with Part 2 registration/application/archive notes in §3.

### Deploy / verification (Item E)

| Gate | Result |
|------|--------|
| Production deploy | **READY** `dpl_HwEghTtkP5s6eo2vL7gqTVz2SUUm` @ `275dfe7` |
| DB Part 2 schema | Applied + SQL verified on linked project |
| DB RLS harness | **Green** https://github.com/HEYY-EJAYY/AgriCoop-Marketplace-Final-Capstone/actions/runs/44238913529 — 381 unit + 15 harness tests |
| Auth smoke | Create-account shows Buyer/Seller/Cooperative Admin + CooperativeSelect + add-new |
| Application review audit | Uses allowlisted `user_access_updated` (no new audit action names) |
| QA leftover rows | No `hotfix_qa` / `part2_qa` app users remaining |

Authenticated Playwright still needs `QA_*` secrets when exercised. Recommend keeping **DB RLS harness** as a required check.

Companion: `docs/UX_DECISIONS.md` (Part 2), `docs/UX_AUDIT.md` (Part 2 surfaces), `docs/MANUAL_SQL.md` BLOCK 20–21.

---

## Verification + hardening follow-up (2026-11-18)

### 1) Part 1 defect status (deployed on production READY)

| Defect | Status | Root cause | Guarding test |
|--------|--------|------------|---------------|
| Verification loop / stuck after signup | **Fixed in app** (email delivery can still defer under Supabase Auth rate limits) | Nested DB scope + revoked `onlinePayment*` INSERT aborted provisioning so Auth existed without app profile | `registration.test.ts` — confirmation / deferred rate-limit success; `registrationScope.test.ts` — register outside anon middleware |
| Resend `Unexpected token 'A'` | **Fixed + deployed** | 30s timeout returned HTML; client parsed as JSON | `registrationScope.test.ts` — register/resend outside anon middleware; `registration.test.ts` — resend generic success |
| Login error for fresh accounts | **Fixed + deployed** | Login SELECT of revoked `onlinePayment*` → `42501` | `authLoginLookup.test.ts`; `dbHarness.rls.test.ts` login/payment grants |
| Seller listing-submit failure | **Fixed + deployed** | Missing INSERT/UPDATE grants on listing payment flags after BLOCK 17 | `paymentGrantContract.test.ts`; `products.archive` ownership in `part2SecurityProofs.test.ts` |

### 2) Real-Postgres harness map (DB RLS harness)

| Feature | Harness / DB test |
|---------|-------------------|
| `cooperativeAdminApplications` table + RLS | `enforces cooperativeAdminApplications…`; authenticated column SELECT + anon deny |
| `requestedRole` column | same Part 2 harness case + column privilege |
| `coop-admin-applications` bucket + policies | `defines coop-admin-applications storage owner policies…`; private bucket exists |
| Order archive `threadStates.channel=order` | Part 2 harness + `allows authenticated buyers to insert order-channel threadStates…` |
| `create_user_cooperative` (user coop create) | `grants create_user_cooperative EXECUTE…` |
| Listing soft-archive (`products.status`) | `grants authenticated UPDATE on products.status…` (no `deletedAt`) |
| Login / registration grants | `keeps login columns readable…`; `registration insert and login select…` |
| Add account | Procedure authz in unit suite (`admin.createAccount`); no separate DB table |

### 3) Security proofs (named passing tests)

| Claim | Test |
|-------|------|
| Signup cannot set role/status/approval | `part2SecurityProofs` / `part2Access` — signup cannot set… |
| Pending applicant has no admin access | `part2SecurityProofs` / `trpcProcedureAccess` — pending… off officer review |
| Officer Admin cannot read files or approve | `part2SecurityProofs` / `trpcProcedureAccess` — blocks Officer Admin… |
| Nobody approves their own application | `part2SecurityProofs` — nobody approves their own application |
| Admin cannot create Admin/SuperAdmin | `part2SecurityProofs` — Admin cannot create… + schema boundary |
| Buyer archive ≠ seller/admin view | `part2SecurityProofs` — buyer order archive does not change… |
| Seller cannot archive another seller’s listing | `part2SecurityProofs` — seller cannot archive another… |
| Coop create rate-limited + near-duplicates | `part2SecurityProofs` — cooperative creation is rate limited… |

### 4) Production all-roles audit matrix (`productionAccessAudit.test.ts`)

```
procedure	anon	buyer	seller	admin	superadmin
marketplace.list	PASS	PASS	PASS	PASS	PASS
orders.buyerMine	PASS	PASS	PASS	PASS	PASS
orders.sellerMine	PASS	PASS	PASS	PASS	PASS
admin.overview	PASS	PASS	PASS	PASS	PASS
officerApplications.pendingList	PASS	PASS	PASS	PASS	PASS
admin.createAccount buyer	PASS	PASS	PASS	PASS	PASS
products.mine	PASS	PASS	PASS	PASS	PASS
products.archive	PASS	PASS	PASS	PASS	PASS
```

**Playwright signed-in suite:** not run — `QA_*` credentials are **not** set in this environment (`PLAYWRIGHT_BASE_URL` only). Missing: `QA_BUYER_*`, `QA_SELLER_*`, `QA_ADMIN_*`, `QA_SUPERADMIN_*` (or project-equivalent names).

### 5) Logs / axe / notifications

| Check | Result |
|-------|--------|
| Runtime errors (last 30m, production) | **No error/fatal logs** |
| Historical clusters | Pre-hotfix registration/`onlinePayment*` INSERT failures on older deployments only |
| Axe-style signup | Clean (`h1=1`, required labeled, no empty controls) |
| Application screen (anon gate) | Clean (`Applicant access required`) |
| Applications tab / Add account / signed-in My Orders | **Blocked without QA_*** — gates only checked |
| Approval notification | **In-app** via `create_notification` (`cooperative_admin_application_*`). **No product transactional email** beyond Supabase Auth |

### 6) Thesis PDF + test data

| Item | Result |
|------|--------|
| Thesis PDF | Regenerated via `pnpm run docs:system` from current code/docs |
| QA users / apps / coops / orders / coop-admin files | **0 / 0 / 0 / 0 / 0** (scoped counts; no unscoped DELETE) |

---

## Production hotfix — login / signup / cooperatives (2026-11-18)

### Issue 1 — Login denied after Supabase Auth (BLOCKER)

| | |
|--|--|
| **Symptom** | “Supabase sign-in succeeded, but the application database denied access…” for every role |
| **Root cause** | BLOCK 17 revoked `authenticated`/`anon` SELECT on `users.onlinePayment*`. Login lookup `loadAuthIdentityRecords` still selected `onlinePaymentQrPath` under `set_config(role=authenticated)` → Postgres `42501` → `application_database_access_denied` |
| **Privilege proof** | `has_column_privilege(authenticated, users.onlinePaymentQrPath, SELECT)=false`; login columns (`openId`,`role`,`profileImageUrl`) remain `true` |
| **Fix** | Code-only: omit seller payment columns from login SELECT. **Do not** re-GRANT payment columns |
| **Statements** | Migration `20261118041000_login_lookup_no_payment_columns.sql` (notice guard only). See `docs/MANUAL_SQL.md` BLOCK 18 |

### Issue 2 — Create account fails (BLOCKER)

| | |
|--|--|
| **Symptom** | “Unable to start registration. Please try again later.” |
| **Root cause** | (1) Nested `withRequestDatabaseScope` under public anon middleware deadlocked `max:1` pool (30s timeout). (2) After that fix: Drizzle `insert(users)` listed every column including revoked `onlinePayment*` as `DEFAULT` → `42501` during provisioning. Secondary: Auth email rate limit on confirmation. |
| **Fix** | Exclude `auth.register` from public DB middleware; `admin.createUser({ email_confirm: false })` → authenticated provision with **explicit-column** `upsertUser` (no payment columns) → best-effort `auth.resend`. Correlation ID + cause logging |
| **Dashboard** | If confirmation emails stay deferred: Supabase Auth → Rate Limits / custom SMTP. Env names only: `APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |

### Issue 3 — Cooperative missing on marketplace

| | |
|--|--|
| **Symptom** | Cooperative name / filter missing on cards |
| **Root cause** | (1) broken preview alias made API fail; (2) filter was derived only from current listing page, so coops with zero published products (e.g. SUTAFACO) never appeared |
| **DB proof** | `anon` has table/column SELECT on `cooperatives.name` / `normalizedName` |
| **Fix** | Keep marketplace join `cooperativeName`; filter uses `cooperatives.listActive` catalog (fallback to listing-derived names) |

### Tests / gates

| Gate | Result |
|------|--------|
| `pnpm lint` / `pnpm test` / `pnpm build` | **pass** (355 passed, 4 skipped locally without Docker) |
| Login SELECT contract | `server/authLoginLookup.test.ts` |
| Registration correlation + admin createUser | `server/registration.test.ts` |
| CI Postgres RLS | `.github/workflows/db-rls-harness.yml` + `scripts/db-test/*` (Docker not installed on this agent host; CI runs throwaway Postgres) |
| Harness asserts | login columns granted; payment columns denied; anon coop name/slug readable; profile INSERT for authenticated |
| Production deploy | `dpl_FoPvPFCv8vMuAxUrL7RKo9SBD2Ne` **READY** on https://agricoop-marketplace-final-capstone.vercel.app (`00aba5d`) |
| Login privilege proof | Payment cols SELECT false; login cols true; SuperAdmin login SELECT under authenticated succeeded (QA_* passwords unset — password E2E not run) |
| Signup verify | Throwaway `hotfix_qa_signup_20261118_*@example.test` → Buyer + approved + profiles.role_id=1; confirmation deferred (email rate limit); test rows deleted |
| Marketplace | `cooperativeName` present on listings; `cooperatives.listActive` includes SUTAFACO; filter catalog complete |
| Access audit | `trpcProcedureAccess` + payment grant contract unit suites pass; Docker RLS harness via GHA (local Docker unavailable on agent host) |
| DB RLS harness CI | **Root cause (from Actions logs, commits `0392aa8`–`955102a`):** every run failed at `pnpm/action-setup@v4` with exact error: `Multiple versions of pnpm specified: version 9 in the GitHub Action config with the key "version" … version pnpm@10.4.1+sha512… in the package.json with the key "packageManager"`. Never reached Postgres or RLS tests. **Fix:** drop conflicting `version:` input (read `packageManager`), Node 22 + pnpm store cache, health-checked throwaway Postgres, apply bootstrap + ordered `supabase/migrations`, require login/payment/coop/registration harness cases to execute (job fails on test failure; no secrets). **First green run:** https://github.com/HEYY-EJAYY/AgriCoop-Marketplace-Final-Capstone/actions/runs/44234745224 (`f326caf`) — full suite **361 passed** (0 skipped); focused harness files **14 passed** (0 skipped), including 5 DB-backed RLS/grant cases. Once real tests ran: harness used `ON CONFLICT DO UPDATE` / bare `42501` without SAVEPOINT — aligned to production INSERT-only profiles grants + SAVEPOINT (not production DB changes). **Local Docker:** not installed on agent host. **Gating (manual):** GitHub → Settings → Branches → Branch protection rule for `main` → Require status checks to pass before merging → require check name **`DB RLS harness`** / job **`rls-harness`**. This workflow does not deploy or alter Vercel. |

---

## UI consistency — boxed marketing + public nav (2026-11-18)

### Visual changes (DESIGN FREEZE inventory)

| Change | Where |
|--------|--------|
| Content max width capped ~1280px with equal fluid side padding | Home, How It Works (`/about`), Support inner content |
| Header / footer inner rows use the same marketing pad + max width | All `PageFrame` routes (chrome only) |
| `scrollbar-gutter: stable` on `html` | Global (reduces one-sided scrollbar shift) |
| Support page title moves into main (no `WorkspaceHeader` title bar) | `/support` |
| Login + Join AgriCoop always present while auth loads | `PublicHeader` / `WorkspaceHeader` right rail |
| Join navigates to `/auth?register=1` | Header + mobile menu |
| 404 uses AgriCoop `PageFrame` chrome | `/404` |
| Product / cooperative / guest Messages & Profile use `PageFrame` | Public routes listed above |
| Darker stage/eyebrow labels on How It Works + Support for AA contrast | `/about`, `/support` |
| Lazy route Suspense fallback uses `PageFrame` (header stays up) | All lazy public/app routes |
| **Unchanged:** marketplace / cart / checkout / auth form / dashboards content width | As designed |

### Root causes

| Issue | Root cause | Fix |
|-------|------------|-----|
| Stretched Home/About/Support | Marketing pages used full-bleed `.agri-shell` (`max-width: 100%`) | Shared `.agri-marketing-shell` + tokens |
| Support Login/Join missing | Support rendered `WorkspaceHeader` (no auth CTAs) and a no-header spinner while `loading` | `PageFrame` + keep logged-out CTAs during load |

### Tests / gates

| Gate | Result |
|------|--------|
| `pnpm check` / `lint` | **pass** |
| `pnpm test` | **353 passed**, 2 skipped |
| `pnpm build` | **pass** |
| Playwright `public-nav-layout` + `hero-layout` | **28 passed**, 16 skipped (role Support needs `QA_*`) on 375/768/1280/1920 |
| Production deploy | `dpl_4wpmKroHXM8tXL678xhSCrb4xDPS` **READY** → https://agricoop-marketplace-final-capstone.vercel.app (`c5022f7`) |
| Smoke | Support logged-out shows Login + Join in page + mobile menu (Marketplace / How It Works / Support / Login / Join AgriCoop) |
| Runtime logs (30m) | No new errors on current deploy; older timeouts on prior `dpl_GLY7…` only |

Companion docs: `docs/UX_DECISIONS.md`, `docs/UX_AUDIT.md`, `docs/MANUAL_SQL.md`, `docs/AgriCoop_System_Documentation.pdf`

---

## Step 5 reconciliation (audit)

### Git / worktree

| Item | Finding |
|------|---------|
| Branch | `finish/agricoop-complete` |
| Last deployed / prior READY | `a53fab2` (FINAL_REPORT deploy record); local also had logo commit `a289017` |
| Uncommitted at audit start | Large WIP: AgriShell, Home, Marketplace, Dashboard, Support*, Activity, routers, db, authz, Messages/Profile pages, migration `20261117180000_*` |
| Half-finished | Duplicate `/messages` + `/profile` imports/routes in `App.tsx` (TS2451); `threadStates` in Drizzle but **missing on live DB**; `profileImageUrl` typed on auth user but not always selected (fixed); ticket bulk originally wrote global ticket columns (fixed → per-user `threadStates`) |

### Live schema vs Drizzle

| Object | Before | After |
|--------|--------|-------|
| `agricoop_app.threadStates` | Missing | Created (BLOCK 12 / MCP `ux_inbox_and_indexes`) |
| `conversations.archivedAt/deletedAt` | Missing | Added |
| `supportTickets.archivedAt/deletedAt/pinnedAt` | Missing | Added (table columns retained; **inbox UX uses threadStates**) |
| `notifications.archivedAt/deletedAt` | Missing | Added |
| Marketplace indexes | Partial | Additive indexes on category/price/stock/cooperativeId + conversation FKs |

### Baseline quality gates (before fixes)

- `pnpm check`: **fail** — redeclared `Messages`/`Profile`; `profileImageUrl` missing on mapped user type path.
- After fixes: check/tests/build recorded in section 5.

### What was finished in this reconciliation

1. Fixed `App.tsx` routes (single Messages/Profile registration).  
2. Applied production migration for inbox table + columns + RLS.  
3. Per-user inbox isolation for conversations **and** tickets via `threadStates`.  
4. Trade-chat privacy: officers cannot read buyer–seller chats (`authz` + tests).  
5. Profile + Messages pages wired; Message CTAs on Activity + Buyer/Seller dashboards.  
6. Verified logged-out nav, role nav, hero glass card, marketplace URL filters, workspace full-width / solid bg / sticky Save.

---

## Database SQL (block by block)

| Block | Change | Verification |
|------:|--------|--------------|
| 12 | `threadStates` + soft-delete columns + indexes + RLS | `to_regclass('agricoop_app."threadStates"')` present; ticket/conversation soft-delete columns present |

No DROP / TRUNCATE / unscoped DELETE. See `docs/MANUAL_SQL.md` BLOCK 12.

---

## Decisions

See `docs/UX_DECISIONS.md` (nav maps, three inbox systems, trade-chat privacy, marketplace URL sorts, hero/workspace).

---

## Quality gates (post-fix)

| Gate | Result |
|------|--------|
| `pnpm check` / `lint` | **pass** |
| `pnpm test` | **295 passed**, 2 skipped (43 files); includes `inboxAccess.test.ts` |
| `pnpm build` | **pass** |
| Playwright hero layout (local) | **8/8** across 360/768/1280/1920 — overflow, padding symmetry, badge placement, axe AA |

### Hero / width root causes

| Issue | Root cause | Fix |
|-------|------------|-----|
| Glass covers image | Large absolute glass panel over hero media | Compact `hero-glass-badge` bottom-right |
| Image overlaps content / uneven gutters | Absolute `w-[70vw] right-[-8vw]` media outside grid | True `lg:grid-cols-2` contained image |
| Not full width | `1440px` cap + negative-margin bleed inside padded shell | `--agri-content-max: 1600px`, `.agri-full-bleed` + inner `.agri-shell` |

---

## Mobile menu overlay

| Item | Detail |
|------|--------|
| Root cause | In-flow `MobileNavDrawer` inside sticky header pushed page content |
| Fix | Shared fixed `MobileMenuOverlay` (`100dvh`) for public + workspace headers |
| Tests | `e2e/mobile-menu.spec.ts` (375/768) + unit role menus for buyer/seller/admin/superadmin |

## Four live issues (2026-11-17)

| Issue | Root cause (evidence) | Fix |
|-------|----------------------|-----|
| 1. Listings show hero image | DB URLs OK (object/public **200**). Client rewrote to `/render/image/` → **403**; `onError` used hero fallback | `ProductImage` + no render rewrite; placeholder never hero |
| 2. Cash payment sentence | UI copy only (not in thesis PDF) | Removed from UI; checkout labels kept; test asserts absence |
| 3. Admin Moderation/Orders/Users nav | Nav items pointed at non-matching destinations | Removed from Admin/SuperAdmin nav; ARIA body tabs + `?tab=` |
| 4. Profile photo upload fails | `authenticated` SELECT-only on `profileImageUrl` (UPDATE failed after Storage) | GRANT + `avatars` bucket/policies (BLOCK 13); compress ≤2 MB |

Docs: cash sentence **not** found in `docs/AgriCoop_System_Documentation.pdf` — PDF not regenerated.  
SQL: `docs/MANUAL_SQL.md` BLOCK 13 / migration `20261117200000_avatars_and_profile_image_grants.sql` (applied).

## Payment / fulfillment / cooperatives / order detail (2026-11-17)

### Step 0 — Conflicting payment UX (pre-fix)

Before unification, payment was split across three phases that disagreed:

1. Marketplace cart dropdown offered only `cash_pickup` / `cash_delivery` (Zod rejected `gcash`).
2. Checkout re-offered GCash as a third radio with cooperative `paymentOptions` QR — a second choice that could override the cart.
3. After place-order, GCash buyers uploaded receipts from the Dashboard only.

Pickup/delivery were conflated into cash method names (no `fulfillmentMethod`). Ledger/Activity still showed legacy `f2f`.

### Locked behavior (now)

| Area | Change |
|------|--------|
| Checkout | Per-seller radios: Cash Pickup / Delivery / Online; receipt required at create for Online; **seller** QR (not coop QR) |
| Listings | `allowsPickup` / `allowsDelivery` / `acceptsOnlinePayment` + badges; publish requires cooperative assignment |
| Schema | BLOCK 14 + BLOCK 15 column-scoped GRANTs; `orderHistory`; SUTAFACO seed |
| Pages | `/orders/:id` (buyer own / seller own / admin|superadmin) + `/cooperatives/:slug` |
| Secrecy | Account fields never on `marketplace.list`; QR bucket `seller-payment-qr` is **private** with signed URLs; other sellers cannot read another seller's payment details |
| Proof review | Order seller + scoped admin/superadmin |

### Cooperative backfill counts (live SELECT, 2026-11-17)

| Metric | Before scoped UPDATE (preview at apply) | After |
|--------|-----------------------------------------|-------|
| Sellers with `cooperativeId IS NULL` | **0** | **0** |
| Products with `cooperativeId IS NULL` | **0** | **0** |
| Sellers with coop / total sellers | — | **2 / 2** |
| Products with coop / total products | — | **22 / 22** |
| `SUTAFACO Cooperative` (`sutafacocooperative`) | inserted (exact name); existing “Sutafaco (Sumilihon…” left unchanged | present (id=4) |

### Legacy payment display

Live orders currently store `paymentMethod = f2f` only (4 rows). UI maps `f2f` → “Face-to-face (legacy)” and `gcash`/`online` → “Online Payment” without rewriting stored values (`shared/paymentMethods.ts` + tests).

### Hardening / CI guards

- `server/paymentGrantContract.test.ts` — BLOCK 15 GRANTs are **column-scoped**; anon cannot SELECT account fields
- `server/paymentSecurity.test.ts` — marketplace secrecy, receipt path ownership, order authz, legacy labels
- `server/trpcProcedureAccess.test.ts` — role × procedure matrix (anon/buyer/seller/admin/superadmin)
- Cash sentence appears **only** in the regression test that asserts its absence; production marketplace/checkout HTML: absent

### BLOCK 15 exact GRANTs (column-scoped)

```sql
GRANT SELECT ("allowsPickup", "allowsDelivery", "acceptsOnlinePayment")
  ON TABLE agricoop_app.products TO anon, authenticated;
GRANT SELECT ("onlinePaymentQrPath", "onlinePaymentAccountName", "onlinePaymentAccountNumber", "onlinePaymentLabel")
  ON TABLE agricoop_app.users TO authenticated;
GRANT UPDATE ("onlinePaymentQrPath", "onlinePaymentAccountName", "onlinePaymentAccountNumber", "onlinePaymentLabel")
  ON TABLE agricoop_app.users TO authenticated;
GRANT SELECT ("onlinePaymentQrPath") ON TABLE agricoop_app.users TO anon;
GRANT SELECT ("fulfillmentMethod") ON TABLE agricoop_app.orders TO authenticated;
```

Live privilege check (2026-11-17): anon SELECT on account name/number/label = **false**; anon SELECT on `onlinePaymentQrPath` = **true** (presence only; marketplace returns `sellerHasOnlineQr` boolean, never account fields). Buckets `payment-proofs` and `seller-payment-qr` are **public=false**.

### Quality gates (payment hardening)

| Gate | Result |
|------|--------|
| lint / typecheck | **pass** |
| vitest | **346 passed**, 2 skipped |
| build | **pass** |
| Playwright `payment-coop-orders` desktop-1280 | **pass** after Auth/Checkout AA contrast fixes |
| Cash sentence repo search | only in `Checkout.cashCopy.test.tsx` (asserts absence) |
| Runtime errors (Hobby ~1h) | Pre-grant `marketplace.list` INTERNAL_SERVER_ERROR cluster on older deploy; recheck after READY |

## Deploy

| Item | Value |
|------|-------|
| Commit | `f37d9a9` (UI/a11y ship `5c96c48`; hardening `6538c0c`) |
| Production | `dpl_HZermnm9MgpL7L9oDsVcXVJB9iRR` (`5c96c48` READY on alias); follow-on `dpl_6AHJXvYbJkYhKWxir1Fv63fxi7fd` for `f37d9a9` |
| readyState | **READY** |
| Alias | https://agricoop-marketplace-final-capstone.vercel.app |
| Smoke | `marketplace.list` 200 with flags + `sellerHasOnlineQr` only; coop slug; order Auth gate; Playwright payment-coop-orders **8/8** (360+1280) incl. axe AA |
| Runtime | Hobby ~1h; only stale `marketplace.list` grant errors on old deploy `dpl_4ZHc…` (pre-BLOCK 15). No new error clusters on post-fix production deploys in the retained window. |
| QA cleanup | No `qa-test-` users found in live DB (none created this run) |

### Hotfix — listing / payment-option / role sync (2026-11-17 night)

| Symptom | Root cause | Fix |
|---------|------------|-----|
| Submit/edit listing → “We could not load this data…” | Missing INSERT/UPDATE on `allowsPickup`/`allowsDelivery`/`acceptsOnlinePayment` (+ serial `id`/`createdAt` for Drizzle) | BLOCK 16 column GRANTs |
| Officer payment option create/QR save → same | Missing INSERT on `paymentOptions.id`/`createdAt`/`updatedAt` | BLOCK 16 |
| Role change → canonical profile sync failed | `public.profiles` has no authenticated UPDATE policy/grants | `agricoop_app.sync_profile_role_from_app` SECURITY DEFINER |
| Cooperative not visible on listing form | Form/card never showed assigned coop | Read-only Cooperative field + card coop name |
| Submit listing not centered | Button sat beside Description in 2-col grid | Full-width centered row at bottom of form |

---

## Still needs a human

1. Sign in as each of the four roles and exercise Message / Support / Tickets bulk actions once.  
2. Confirm Supabase Auth Site URL + email redirects match production.  
3. Optional: explicit dispute escalation path for officer access to order chats (logged) — not built; privacy decision documented.
4. Authenticated production E2E for Cash Pickup / Delivery / Online (receipt gate + seller confirm/reject + buyer re-upload) with temporary `qa-test-` accounts — no QA credentials in the agent environment; CI unit/matrix/security tests cover the authorization and receipt rules.

---

## System payment (Admin/SuperAdmin only) — Step 0 inventory (2026-11-18)

**Goal:** Payments controlled only by Admin (“Officer Admin”) and SuperAdmin. Sellers lose QR/account setup, receipt review, and “cash received”. Seller-owned columns/files are preserved (no DROP); grants/policies revoked.

### Live preserved data (SELECT 2026-11-18)

| Metric | Count |
|--------|------:|
| Sellers total | 2 |
| Users with `onlinePaymentQrPath` | 2 |
| Users with account name/number/label | 2 |
| Products with `acceptsOnlinePayment = true` | 0 |
| Orders `awaiting_verification` | 0 |
| Cash orders awaiting received (`pending` / `F2F-pending-confirmation`) | 4 |
| Storage objects in `seller-payment-qr` | 2 |
| Storage objects in `payment-proofs` | 0 |
| `paymentOptions` rows | 0 |

### Seller-owned surface (pre-change)

| Area | Location | Notes |
|------|----------|-------|
| Columns | `users.onlinePaymentQrPath\|AccountName\|AccountNumber\|Label`; `products.acceptsOnlinePayment` | Drizzle `pg-schema.ts`; BLOCK 14–16 |
| Profile UI | `client/src/pages/Profile.tsx` “Online payment (seller)” | `sellers.getOnlinePayment` / `uploadOnlinePaymentQr` / `saveOnlinePaymentDetails` |
| Bucket | `seller-payment-qr` private | Owner insert/update/select policies; `SELLER_PAYMENT_QR_BUCKET` |
| Listing flag | Dashboard `ListingPaymentFlagFields` + Marketplace/Coop badges | Gated by seller QR presence |
| Marketplace DTO | `getMarketplace` → `sellerHasOnlineQr` | Boolean only; no account fields |
| Checkout | `methodsForListings(listings, sellerHasOnlineQr)` + `sellers.getOnlinePayment` | Per-seller QR |
| Confirm/reject | `payments.reviewProof` via `canReviewOrderPaymentProof` (seller OR staff) | OrderDetail + Admin queue |
| Cash received | `payments.recordCashReceipt` via `canManageCashReceipt` (seller OR staff) | SellerDashboard + OrderDetail |
| Notifications | `payment_proof_uploaded` → seller; verify/reject/cash → buyer | `create_notification` |
| Admin coop QR | `adminPayment.*` / `paymentOptions` / `/admin/payment-options` | Separate from seller QR; not checkout source after seller-QR era |
| CI guards | `paymentGrantContract`, `paymentSecurity`, `trpcProcedureAccess` | Encode seller-QR model |

### Target model (post-change)

- Tables: `systemPaymentSettings` (singleton), `systemOnlinePaymentAccounts` (one active), `systemPaymentSettingsAudit`
- Bucket: `system-payment-qr` (private; service-role + signed URLs)
- Dashboard body tab `?tab=payments` (Settings + Verification Queue); no main-nav item
- Online availability = settings.onlineEnabled ∧ active account with QR; pickup/delivery = listing flags ∧ settings toggles
- Payment status mutations: Admin/SuperAdmin only; sellers read-only on order detail
- Migration: `20261118022138_system_payment_admin_only.sql` (BLOCK 17) + `docs/MANUAL_SQL.md`

### Implementation status (2026-11-18)

| Check | Result |
|-------|--------|
| Seller QR/account UI removed (Profile) | Done |
| Listing “Accepts Online Payment” removed | Done (writes force false) |
| Seller reviewProof / recordCashReceipt | Denied (authz + UI) |
| Seller receipt signed URL | Denied |
| Admin Payments tab | Settings + verification + cash queue |
| Checkout system QR | `systemPayment.getCheckoutOnlineDetails` (buyer) |
| Legacy seller columns / `seller-payment-qr` files | Preserved (2 users, 2 files); grants REVOKEd; storage owner policies dropped |
| Live privilege | anon QR SELECT **false**; auth account SELECT/UPDATE **false**; `system-payment-qr` public=false; seller_qr policies **0** |
| vitest | **351 passed**, 2 skipped |
| typecheck / build | pass |
| Production deploy | `dpl_GLY7s7rEDaPLc3Nkwsxgf7DF9md8` **READY** on https://agricoop-marketplace-final-capstone.vercel.app |
| Playwright `payment-coop-orders` 360+1280 | **8/8** |
| Live privilege recheck | anon QR SELECT false; auth account SELECT/UPDATE false; system-payment-qr private; seller QR storage policies 0 |
| Authenticated QA E2E | **Blocked:** all of `QA_BUYER_EMAIL`, `QA_BUYER_PASSWORD`, `QA_SELLER_EMAIL`, `QA_SELLER_PASSWORD`, `QA_ADMIN_EMAIL`, `QA_ADMIN_PASSWORD` are **MISSING** in process/user/machine env, `.env.local`, and Vercel project envs. Suite `e2e/auth-payment-system.spec.ts` skips auth flows and asserts the missing **names** only. |
| Thesis PDF | Regenerated via `scripts/build-system-docs.mjs` |

### Authenticated verification attempt (2026-11-18)

| Step | Result |
|------|--------|
| 1–6 Admin/Seller/Buyer/order authz E2E | **Not run** — QA env vars missing (names above). No passwords created or printed. |
| 7a Orders awaiting seller verification before cutover | Live now: `awaiting_verification` = **0**; `paymentProofs` pending = **0**; `orderHistory` to `awaiting_verification` = **0**. Cash awaiting officer confirm = **4** (`pending`/`F2F-pending-confirmation`). Those 4 appear in Admin **Payments → Cash awaiting confirmation** (not a seller queue). |
| 7b `paymentSecurity` / `trpcProcedureAccess` real DB vs mocks | **Mocks / static analysis.** `trpcProcedureAccess.test.ts` mocks `./db` + storage and uses `createCaller`. `paymentSecurity.test.ts` is pure unit + source-scan (no DB). Real RLS: `server/dbHarness.rls.test.ts` against `TEST_DATABASE_URL` (localhost only). |
| 7c Two skipped tests | With `TEST_DATABASE_URL` unset: (1) `connects only after localhost guard`, (2) `prevents buyer from reading another buyer's orders under authenticated role` — both under `describe.skipIf(!testDatabaseUrl)`. |
| 8 Removed cash sentence | Exact sentence appears **only** in `Checkout.cashCopy.test.tsx` (asserting absence). Live checkout e2e asserts UI absence. No production UI source contains it. |
| 9 Access audit + logs + axe | Vitest procedure/grant/security suites pass. Vercel runtime logs window: no new entries. Unauthenticated checkout/order axe: **pass** (payment-coop-orders 8/8). Payments-tab axe: needs Admin login (skipped). |

---

## Part 2 — registration cooperatives, Coop Admin applications, Add account, order archive (2026-11-18)

| Item | Status |
|------|--------|
| A Cooperative select + add-new at signup | Done — required Seller/Coop Admin; optional Buyer; Part 1 normalize / Did you mean / rate limit / `source=user` / `createdBy`; anon cannot INSERT |
| B Cooperative Admin applications | Done — signup → buyer + `requestedRole=admin` + awaiting docs; private `coop-admin-applications` bucket; SuperAdmin Applications tab; approve/reject + in-app notify; **no product email path** beyond Supabase Auth |
| C Add account | Done — Admin: Buyer/Seller; SuperAdmin: also Officer Admin; confirmed Auth user + set-password invite; one-time copyable link if email fails; audit |
| D Buyer order archive | Done — `/activity` Active/Archived; `threadStates` channel `order`; ownership proven in `orderArchive.test.ts` |
| Migrations | `20261118120000_part2_registration_applications_order_archive.sql` + `20261118121000_buyer_order_archive_channel.sql` applied on production Supabase |
| Security proofs | Signup cannot set admin/status/approval (`part2Access`); pending applicant no admin (`trpcProcedureAccess`); Officer Admin cannot read/approve apps; Admin cannot create Admin/SuperAdmin (`canCreateManagedAccountRole`) |
| Vitest | **376 passed**, 6 skipped (local without Docker) |
| Thesis docs / PDF | Updated + regenerated |
| Production deploy | `dpl_7TTfdbDiss3Wu73UzPAPT4sWTj8v` **READY** on https://agricoop-marketplace-final-capstone.vercel.app — smoke `/`, `/auth`, `/activity`, `/api/health` = 200 |
| QA_* signed-in Playwright | Still **MISSING** env vars — authenticated axe/QA create-cleanup deferred |
| Email for application decisions | **Not implemented** — no app transactional mailer; Auth emails only |
| DB RLS harness CI | **Green:** https://github.com/HEYY-EJAYY/AgriCoop-Marketplace-Final-Capstone/actions/runs/44239417812 (`7d729cf`) — includes Part 2 applications/archive privilege case. Local vitest **376 passed** / 6 skipped without Docker. |
