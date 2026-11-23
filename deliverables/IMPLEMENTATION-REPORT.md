# AgriCoop Marketplace — Implementation Report

**Scope:** Product population, sales/transaction data reset, and dashboard notification improvements.
**Application:** https://agricoop-marketplace-final-capstone.vercel.app/ (verified against local dev server `http://localhost:3000` on the same Supabase database, schema `agricoop_app`).
**Date:** 2026-11-22

---

## 1. Products successfully added

All 20 requested Philippine agricultural products were inserted through the existing `agricoop_app.products` table using the app's own visibility rules (`status=published`, `verificationStatus=approved`, `visibility=visible`, live approved seller, live cooperative). Prices are stored as integer centavos (`priceCents`), stock in the product's own unit (`kg` for all seeded rows), with `minOrderQty` enforced by the existing checkout validation.

| # | Product ID | Name | Variety | Category | Price/kg | Stock (kg) | Min order |
|---|---|---|---|---|---:|---:|---:|
| 1 | 50 | Banana | Cavendish | Fruit | 17.52 | 5,000 | 50 |
| 2 | 51 | Banana | Lakatan | Fruit | 26.10 | 2,500 | 25 |
| 3 | 52 | Banana | Latundan | Fruit | 15.34 | 3,000 | 25 |
| 4 | 53 | Banana | Saba | Fruit | 11.54 | 4,500 | 50 |
| 5 | 54 | Coconut | Matured | Commercial Crop | 9.17 | 8,000 | 100 |
| 6 | 55 | Young Coconut | Buko | Fruit | 18.43 | 1,500 | 20 |
| 7 | 56 | Mango | Carabao (Green) | Fruit | 47.60 | 1,200 | 25 |
| 8 | 57 | Calamansi | Native | Fruit | 31.56 | 900 | 10 |
| 9 | 58 | Pineapple | Hawaiian | Fruit | 26.12 | 2,000 | 50 |
| 10 | 59 | Avocado | Local | Fruit | 35.18 | 750 | 10 |
| 11 | 60 | Durian | Puyat | Fruit | 56.24 | 1,500 | 25 |
| 12 | 61 | Cacao | Dry Beans | Commercial Crop | 124.45 | 800 | 10 |
| 13 | 62 | Coffee | Robusta | Commercial Crop | 233.88 | 600 | 10 |
| 14 | 63 | Abaca | Dried Raw Fiber | Fiber Crop | 56.19 | 1,000 | 25 |
| 15 | 64 | Rubber | Cup Lump | Industrial Crop | 54.90 | 2,000 | 50 |
| 16 | 65 | Sugarcane | Yellow Cane | Commercial Crop | 3.50 | 10,000 | 100 |
| 17 | 66 | Palay | Inbred Rice | Grain | 17.00 | 5,000 | 100 |
| 18 | 67 | Yellow Corn | Yellow Corn | Grain | 18.00 | 3,000 | 50 |
| 19 | 68 | Cassava | Fresh Cassava | Root Crop | 12.00 | 2,000 | 50 |
| 20 | 69 | Ginger | Native | Root Crop | 65.00 | 500 | 10 |

Notes:
- All seeded units are `kg`, matching `PRODUCT_UNITS` in `shared/productOptions.ts`. No silent unit conversion was introduced; other units (sack, piece, bunch, metric ton) remain available through the existing listing form.
- Prices/stock are editable sample listing data, not verified live market quotations.
- Seed script: `scripts/seed-ph-agri-products.mjs` (idempotent, records product IDs in the DB).

## 2. Cooperative records reused or created

Existing cooperatives were inspected first. None of the seven requested names existed, so seven clearly identified demo cooperatives were created, each with an approved seller account (seller IDs 1543–1549) so listings pass the marketplace visibility rules:

| Cooperative ID | Name | Seller ID | Products |
|---|---|---|---:|
| 14 | Davao Farmers Cooperative | 1543 | Banana ×4 |
| 15 | Agusan Coconut Growers Cooperative | 1544 | Coconut, Young Coconut |
| 16 | Mindanao Fruit Growers Cooperative | 1545 | Mango, Calamansi, Pineapple, Avocado, Durian |
| 17 | Davao Cacao Producers Cooperative | 1546 | Cacao |
| 18 | Mindanao Coffee Growers Cooperative | 1547 | Coffee |
| 19 | Agusan Fiber Producers Cooperative | 1548 | Abaca |
| 20 | Mindanao Rubber Farmers Cooperative | 1549 | Rubber, Sugarcane, Palay, Corn, Cassava, Ginger |

No pre-existing cooperative accounts were duplicated; all 12 original cooperatives were preserved.

## 3. Database tables inspected

`agricoop_app` schema (PostgreSQL via Supabase pooler — PostgREST does not expose this schema):

`users`, `cooperatives`, `products`, `productImages`, `orders`, `orderItems`, `orderEvents`, `orderHistory`, `transactions`, `payments`, `paymentEvents`, `paymentProofs`, `conversations`, `conversationMessages`, `threadStates`, `notifications`, `quotations`, `cartItems`, `cooperativeAdminApplications`, `cooperativeAssociationRequests`, `profileVerificationSubmissions`, `supportTickets`.

Foreign keys were inspected before deletion; sales-related dependents use `NO ACTION`, so cleanup ran in dependency order.

## 4. Records removed during sales/transaction cleanup

Backup taken **before** any deletion at `backups/sales-cleanup-2026-11-22T05-48-52-521Z/` (per-table JSON + `manifest.json`). Removed counts:

| Table | Rows removed |
|---|---:|
| orders | 46 |
| orderItems | 53 |
| orderEvents | 191 |
| orderHistory | 180 |
| transactions | 46 |
| payments | 42 |
| paymentEvents | 83 |
| paymentProofs | 14 |
| conversations | 58 |
| conversationMessages | 76 |
| threadStates | 85 |
| notifications | 601 |
| quotations | 7 |
| cartItems | 4 |

All removed rows were test/demo activity (every order predated this session's seeded catalog). Cleanup script: `scripts/cleanup-sales-data.mjs`; backup script: `scripts/backup-sales-data.mjs`.

## 5. Records preserved

- All user accounts (47 → 54 after adding 7 demo sellers), authentication config, roles, approval/verification statuses.
- All 12 original cooperatives and all cooperative↔user relationships.
- The product catalog (44 pre-existing + 20 seeded = 64 products). Four leftover unrelated test listings were hidden (not deleted) so the marketplace shows only legitimate catalog items.
- Payment gateway/system configuration, support tickets, applications, profile verifications, system settings.
- Referential integrity verified post-cleanup: no orphaned FKs, `admin.overview` returns consistent aggregates.

## 6. Backup location and recovery

`backups/sales-cleanup-2026-11-22T05-48-52-521Z/` contains one JSON file per table plus `manifest.json` with per-table row counts. To restore, re-insert rows in dependency order (orders → orderItems/orderEvents/orderHistory → transactions/payments → paymentEvents/paymentProofs → conversations/messages/threadStates → notifications → quotations → cartItems). The backup contains only sales/transaction-scoped rows; users, cooperatives, products, and configuration were never touched.

## 7. Notification logic improvements

Code changes (5 files, +14/−6 lines — no redesign):

- `server/db.ts` — `getPendingActivityCounts`:
  - Seller `newOrders` now counts orders in `submitted` **or** `confirmed` (both genuinely await seller fulfillment action; previously only `submitted`, which under-counted once an officer confirmed an order).
  - Superadmin `cooperativeApplications` now counts only `status = "pending"`, matching `officerApplications.pendingList`. `awaiting_documents` applications wait on the *applicant*, not the reviewer, so they no longer inflate the actionable count.
- `client/src/components/PendingActivityCards.tsx` — clearer labels with pending counts: "Orders to fulfill pending" → `/dashboard?queue=action`; "Officer applications pending" → `/dashboard?section=applications`.
- `client/src/pages/Dashboard.tsx` — seller fulfillment queue honors `?queue=action`, filtering to `submitted`/`confirmed` orders only, with a "Showing N orders awaiting action" indicator.
- `client/src/lib/useRealtimeInvalidation.tsx` — realtime changes to `cooperativeAdminApplications` now invalidate `notifications.pendingCounts`, `officerApplications.pendingList`, and `admin.overview`.
- `client/src/components/OfficerApplicationsPanel.tsx` — after approve/reject, `notifications.pendingCounts` is invalidated so the badge updates immediately.

Counts still come entirely from live DB queries — nothing is hardcoded. Cards render only when count > 0; loading/error states are handled by the existing `usePendingCounts`/`PendingActivitySection` components.

## 8. Dashboard count verification (live API + DB)

| Scenario | Result |
|---|---|
| Baseline (post-cleanup) | buyer/seller/superadmin actionable counts = 0; officer showed 1 unrelated open support ticket |
| Created pending officer application (ID 9) | superadmin `cooperativeApplications`: 0 → **1** |
| Rejected application via real API | count returned to **0** |
| Created order 53 via real checkout (50 kg Banana Cavendish, PHP 876.00) | seller `newOrders`: 0 → **1**; buyer `activeOrders`: 0 → **1** |
| submitted → confirmed → ready | seller actionable count returned to **0** (order no longer awaits seller); buyer `activeOrders` stayed 1 |
| `admin.overview` after cleanup | transactions: 1, orders: 1, products: 64 — matches DB exactly |

Minimum-order enforcement verified: ordering 10 kg of Banana Cavendish failed with "Banana has a minimum order of 50 kg."; 50 kg succeeded and produced consistent order/transaction/payment amounts (PHP 876.00 each).

## 9. Tests performed and results

- `pnpm check` (tsc --noEmit): **pass**
- `pnpm test` (vitest): **75 files / 447 tests passed**, 22 skipped — including `reportCsv.test.ts`
- Marketplace API: all=20 seeded listings visible; category filter Fruit=10, Grain=2; price-desc sort puts Coffee (PHP 233.88/kg) first; categories reduced to the 6 catalog categories; product detail lookup for ID 50 OK.
- CSV/reporting: reports are generated client-side from `admin.overview`/`cooperativeAdmin.overview`; verified the overview now returns only the single post-cleanup transaction, so CSV exports contain only valid records.
- Role-based checks: buyer, seller, officer (admin), and superadmin sessions each loaded their dashboards with role-appropriate navigation and counts; unauthorized procedures remain protected by existing `protectedProcedure`/authz.
- Browser screenshots captured for marketplace, product detail, and all four role dashboards (see §10).

## 10. Screenshots

`deliverables/screenshots/`:

- `marketplace-catalog.png` — populated marketplace (20 seeded listings)
- `product-detail-banana-cavendish.png` — product detail page
- `dashboard-buyer.png` — buyer dashboard (active order card)
- `dashboard-seller.png` / `dashboard-seller-queue-action.png` — seller workspace and `?queue=action` filtered queue
- `dashboard-officer.png` — cooperative officer dashboard
- `dashboard-superadmin.png` / `dashboard-superadmin-applications.png` — superadmin dashboard and applications section

Earlier capstone evidence remains in `deliverables/live-application-screenshots/`.

## Remaining issues / notes

- **One verification order remains:** order `53` (50 kg Banana Cavendish, PHP 876.00, status `ready`, payment `pending`, transaction ID 54) was deliberately created through the real checkout flow to verify notification counts end-to-end. It is the only order/transaction in the system. Delete it via the seller/officer UI or ask me to remove it if you want a literally zero-order history.
- **Test officer application** (ID 9) was created and rejected during verification — it remains as a `rejected` record, which is correct audit history.
- The dev server on `:3000` was restarted during this session after its DB pool wedged; it is running under `pnpm dev` in the background.
- Helper scripts kept for reproducibility: `scripts/seed-ph-agri-products.mjs`, `scripts/backup-sales-data.mjs`, `scripts/cleanup-sales-data.mjs`, plus `_`-prefixed verification/screenshot scripts. They contain no secrets.

---

# Follow-up: Agusan-focused cleanup, product images, and notification badges

## Cooperatives

Retained (all Agusan del Norte / Agusan del Sur):
- ID 1 — Agricoop Butuan Producers Cooperative (Butuan City, Agusan del Norte) — active
- ID 2 — Sutafaco (Butuan City, Agusan Del Norte) — inactive
- ID 3 — Caraga State University - Main (Ampayon, Agusan Del Norte) — active
- ID 4 — SUTAFACO Cooperative (Butuan City) — inactive
- ID 13 — Agrofarmers Cooperative (Bayugan City, Agusan del Sur) — active

Removed: the seven development-created demo cooperatives (IDs 14–20) and all QA/demo seller, officer, buyer, order, transaction, payment, conversation, notification, quotation, cart, and application records created during testing — including verification order 53. All 20 sample products (IDs 50–69) were preserved and reassigned to cooperative ID 3 with seller ID 4 (the legitimate CSU Main cooperative seller account).

## Product images

All 20 products (IDs 50–69) now have a dedicated image in Supabase Storage bucket `product-images` under `catalog/<id>-<slug>.webp` (WebP, ≤900px, ~40–220 KB each), sourced from Wikimedia Commons freely-licensed photographs (CC0 / CC BY / CC BY-SA / public domain). All 20 `productImages` rows verified: 20/20 HTTP 200. Per-product source filenames and licenses are recorded in the session manifest; notable replacements: mango → "Mangos - single and halved" (PD), robusta coffee → "Robusta Coffee Beans at Tagaytay Mahogany Market" (CC BY-SA 4.0).

## Notification redesign

Replaced dashboard pending-activity cards with per-tab dot+count badges:

- `server/db.ts` `getPendingActivityCounts` now returns per-section counts: `buyers`, `sellers`, `associationRequests`, `productReviews`, `paymentReviews` (pending proofs + cash awaiting receipt) for admin (cooperative-scoped) and superadmin (platform-scoped); `profileVerifications` now also populated for admins.
- `AdminShell` sidebar: red dot+count on Buyer Management, Seller Management, Order Management, Payment Verification, Products & Listings, Support & Messages, Dashboard (overview queue sum) for OfficerAdmin; User Management, OfficerAdmin Management, Product Management (new nav item), Dashboard for SuperAdmin. Collapsed sidebar shows a dot on the icon.
- `PublicHeader`/`WorkspaceHeader` center nav and `MobileMenuOverlay`/`MobileBottomNav`: badges on My Orders/Activity, Seller Center/Dashboard, Messages, Support, Support & Tickets — scoped per role, `99+` cap, hidden at zero.
- `PendingActivityCards.tsx` deleted; all dashboard card usages removed.
- Realtime invalidation extended to `payments`, `supportTickets`, `supportTicketMessages`, `profileVerificationSubmissions`, `cooperativeAssociationRequests`, and `paymentProofs → pendingCounts`.

Counts reflect actionable records (pending approvals, orders awaiting review, proofs awaiting verification, open tickets), not raw unread notifications; they clear when the underlying record is actioned and return when new items arrive.

## Security findings

- 9 legacy `agricoop` schema tables have RLS disabled but contain 0 rows and grant no privileges to `anon`/`authenticated` — not API-exposed; safe to leave, recommend eventual archival.
- SECURITY DEFINER functions are the application's guard/trigger layer (owner `postgres`), consistent with the guarded-column model. `public.agricoop_profile_visible` and `public.get_my_role` are definer functions in the exposed `public` schema — flagged for review.
- Remote migration ledger ends at `20261120115225`; local migrations run through `20261203000000`. Schema is ahead of the ledger (applied out-of-band). Do NOT replay migrations; reconcile ledger records before any future `db push`.

## Verification

- `pnpm check`: pass. `pnpm vitest run` (nav/badge-related): pass; full suite previously 447 passed / 22 skipped (one nav test updated to reflect the intentional SuperAdmin Product Management item).
- DB audit: 0 orders, transactions, payments, conversations, notifications, quotations, carts, tickets, applications; 5 cooperatives; 20 products with images; 5 active users.

---

# Follow-up: QR payment feature — end-to-end verification and hardening (commit pending)

## What changed since `c47e54f`

- `server/routers.ts`: `reportIssue` notifications now name the affected cooperative and deep-link to `/admin/payment-options?tab=reports&report=<id>`; `createOption` validates that a SuperAdmin-selected cooperative exists before insert.
- `client/src/pages/PaymentOptions.tsx`: replaced the numeric cooperative-ID input with a cooperative-name `<select>` backed by `cooperatives.listActive` ("Platform-wide (all cooperatives)" + real names); option cards show cooperative names; the page reads `?tab=reports&report=<id>` to open the reports tab and highlight the target report card; reports query/mutation declarations reordered (no behavior change).
- `server/adminPaymentOptions.test.ts`: report-notification test updated for the added cooperative-name lookup.

## Verified end-to-end (browser + DB, disposable QA data)

- Buyer checkout UI report → unread `qr_issue_reported` notifications for exactly the correct OfficerAdmin + both SuperAdmins; unrelated cooperative OfficerAdmin excluded (verified per-report in both directions).
- OfficerAdmin notification bell → click → deep link opens reports tab with the report card highlighted → unread count decrements, `isRead` persisted → Pending → Under review → Resolved lifecycle with internal notes persisted (`reviewedBy`/`reviewedAt` set).
- SuperAdmin bell → same deep-link flow across cooperatives; cooperative selector lists platform-wide + all cooperative names; OfficerAdmin sees no selector.
- Payment integrity (live API): invalid and foreign-cooperative `paymentOptionId` both rejected with HTTP 400; `checkoutOptions` returns only active, basket-cooperative options; selected ID persists on transaction/payment (code + prior QA).
- Mobile 390px: buyer QR picker/report form and SuperAdmin selector usable (7/7).

## Regression

`pnpm check` clean · `pnpm test` 81 files / 520 passed / 22 skipped · `pnpm build` OK (entry 727.52 kB, gzip 207.59 kB).

## Cleanup

All disposable QA payment options, QR reports, generated notifications (including 39 orphaned test notifications from earlier runs), and cart lines removed; `qrIssueReports` empty; only the pre-existing GCash option (id 2) remains. No orders/receipts/payment records created. `backups/` untouched.

## Known limitations

- The coop-1 OfficerAdmin has no known credentials; its inbox was verified via DB rows (correct recipient, unread, deep link) while the identical bell UI was verified in-browser as coop-3 OfficerAdmin and SuperAdmin.
- Only coop-1 products are published, so the checkout-UI report path was exercised against a coop-1 QA option; the coop-3 report used the same `reportIssue` API for officer-inbox verification.

---

# Production deployment — QR payment feature (2026-11-23)

- **Commit:** `242318aeba6c47493849df57edee70cbc206816d` on `finish/agricoop-complete` (HEAD == origin at deploy time; working tree had only untracked QA artifacts).
- **Deployment:** `dpl_em2qzXV8MMvuVafjxuQJCHMNuPDk`, Vercel project `agricoop-marketplace-final-capstone` (`prj_LCxJgY2qeXdRNBgOnTeXvJbgXXDI`, team `ejay5`), `target: production`, state `READY`, serving `https://agricoop-marketplace-final-capstone.vercel.app` (HTTP 200).
- **Method:** `create_deployment` with `gitSource` pinned to the exact SHA; `request_promote` on preview `dpl_HQinBujB5QqiydPJCQrSKjUokw5y` returned 422 (sourceless git link), so a fresh production-target build of the same commit was used — consistent with prior production deploys on this project.
- **Rollback:** previous production `dpl_8QuCcoywmBBYSCGrMihfe9QxoDCJ` (commit `c3e662e`) preserved as rollback target.
- **Smoke results (production browser + DB):** 26/26 desktop, 5/5 mobile — full notification delivery/navigation/read/lifecycle loop, cooperative-scoped permissions, SuperAdmin selector, buyer QR picker/report. All disposable QA data removed; shared DB left clean (only pre-existing payment option id 2).

---

# Follow-up: Cooperative-scoped QR isolation, QR issue auto-hide, and cooperative pickup details

**Basis:** attached capstone manuscript (`AgriCoop_Final_Manuscript_A4 (2).pdf`) — per-cooperative payment configuration (Fig. 4-11), pickup/delivery coordination within scope (§1.5), external payment settlement, seller-group checkout (§1.6/§3.4), cooperative oversight. No new business modules were introduced.

## Changes implemented

### 1. Cooperative payment isolation (manuscript: per-cooperative payment options)

- `paymentOptions."cooperativeId"` is now `NOT NULL` (`drizzle/pg-schema.ts`, migration `supabase/migrations/20261211000000_coop_pickup_qr_scope.sql`, applied to the app database). Platform-wide (NULL) payment options no longer exist in the data model.
- `adminPayment.createOption` / `uploadQrImage` reject a missing cooperative with `BAD_REQUEST`; SuperAdmin must explicitly select a cooperative (UI: required `<select>`, "Platform-wide" option removed). OfficerAdmin remains pinned to `actor.cooperativeId`.
- `adminPayment.checkoutOptions` returns `[]` for baskets without a cooperative and only ever matches `paymentOptions.cooperativeId === order cooperativeId`; `isQrCheckoutOption`/`isGcashCheckoutOption` now hard-require a non-null cooperative match, so a manipulated `paymentOptionId` cannot select another cooperative's QR (`orders.create` re-validates through `order_create_lock_payment_option` + `assertPaymentOptionSelection`).
- Live DB verified: 0 NULL-cooperative options; the two pre-existing options (ids 2 GCash, 53 Maya) already belonged to cooperative 3 and were preserved untouched.

### 2. QR issue reporting → automatic hide + re-enable (implied safeguard for "eligible payment evidence")

- `adminPayment.reportIssue` now deactivates the reported option inside the same transaction that records the report (`isActive=false`), preserving the full report snapshot (provider, label, account, QR path, reason, details). Duplicate-report window (15 min, pending/under_review) retained.
- Checkout already auto-selects another eligible QR when the selected one disappears; the buyer UI now also offers an explicit "Show another QR" switcher and explains that the reported QR is hidden until reviewed. Resolving/dismissing a report never re-activates the option — only an explicit admin `updateOption isActive=true` ("Available at checkout") restores it. PaymentOptions UI documents this in the reports tab and edit form.

### 3. Cooperative pickup information (implied by documented pickup coordination)

- `cooperatives` gained `pickupContactNumber`, `pickupInstructions`, `operatingHours` (column-level grants added for `authenticated`).
- `cooperatives.update` accepts the three fields; `assertCooperativeManagementScope` keeps OfficerAdmin writes limited to its own cooperative; SuperAdmin manages all.
- New public `cooperatives.pickupInfo` query and pickup fields on `cooperatives.bySlug`; public cooperative page shows a "Pickup information" card.
- OfficerAdmin gained a **My Cooperative** dashboard section (`?section=cooperative`) with the pickup editor; SuperAdmin's Cooperative Management table gained a per-row **Pickup** editor.
- Checkout renders a "Pickup location" card per seller group when fulfillment is pickup (address/location, contact, instructions, hours, and an explicit warning when the cooperative has not configured a detailed pickup address). Pickup is not hard-blocked when data is missing — the card warns instead, matching the manuscript's coordination (not logistics) model.
- `orders.create` snapshots pickup details into `orders.pickupDetails` (jsonb) at order time; `orders.byId`/`OrderDetail` shows the historical snapshot plus the recorded payment option (provider, label, account name/number) so later cooperative edits cannot rewrite order history.

### 4. Buyer transparency (explicit cooperative affiliation/oversight)

- Marketplace cart rows (desktop + mobile) now show "By {seller} · {cooperative}"; checkout group headers show "Sold by {cooperative}"; buyer order cards in the dashboard show the cooperative name; order detail already showed cooperative identity and now also shows pickup + payment-option snapshots.
- `prepareOrder` now rejects mixed-cooperative baskets server-side ("submit a separate order for each cooperative"), complementing the existing single-seller rule; cart rows now return the real `cooperativeSlug` (was hardcoded `null`).
- Deferred: visual grouping of marketplace listings by cooperative — the flat grid already identifies each cooperative per card and supports cooperative filtering/sorting; sectioned grouping would conflict with price sorting and pagination without adding documented functionality.

## Verification

- `tsc --noEmit` (`pnpm check`): **pass**.
- `pnpm test` (vitest): **81 files / 524 passed / 22 skipped** — includes new coverage: NULL-cooperative checkout returns `[]`, SuperAdmin create/upload without cooperative rejected, report-triggered `isActive=false`, inactive option not re-toggled, `paymentOptions.cooperativeId` NOT NULL schema assertion, platform-wide QR ineligibility.
- `pnpm build`: **pass**.
- Playwright `e2e/coop-transparency-qr.spec.ts` (new, credentials-gated): **3/3 desktop-1280 and 3/3 mobile-375** — buyer sees cooperative on cards/cart/checkout and the pickup card; OfficerAdmin sees scoped payment options + My Cooperative pickup editor; SuperAdmin sees a required cooperative selector with no platform-wide option. `e2e/four-role-acceptance.spec.ts` re-run: all role sign-ins and dashboard loads pass (2 initial sign-in timeouts passed on retry — flaky auth redirect timing, unrelated to these changes).
- DB inspection post-migration: new columns present, `paymentOptions."cooperativeId"` `is_nullable=NO`, 0 orders carry `pickupDetails` yet (snapshot applies to new pickup orders only).

## Data safety

- No QA/demo/test records were created or left behind: the browser tests are read-only UI assertions; the only DB writes were the schema migration itself. Pre-existing payment options (ids 2, 53), cooperatives, products, orders, and users were not modified. Temporary `_`-prefixed inspection scripts used during this session were deleted.

---

# Final review round — QR auto-hide RLS fix, persisted checkout E2E, pickup assessment

**Basis:** re-read of the attached manuscript; live DB inspection; persisted browser workflows against the shared dev database with disposable fixtures only.

## Genuine bug found and fixed: QR auto-hide was a no-op under RLS

- `reportIssue` deactivated the reported option with `tx.update(paymentOptions)` inside the report transaction, but buyers/sellers have no UPDATE policy on `paymentOptions` (staff/superadmin only), so the update silently affected 0 rows — reported QRs stayed visible at checkout.
- Fix: migration `supabase/migrations/20261212000000_qr_report_hide_function.sql` adds `agricoop_app.deactivate_reported_payment_option(integer)` — SECURITY DEFINER, guarded (requires the caller's own pending report for that option), only ever sets `isActive=false`, EXECUTE granted to `authenticated` only. `reportIssue` now calls it in the same transaction as the report insert. Applied to the app DB (function verified present, `prosecdef=true`).
- `server/adminPaymentOptions.test.ts` updated: asserts the guarded function SQL is executed and notification calls are unchanged; deactivation path covered.

## Persisted end-to-end verification (real browser, shared DB, disposable fixtures)

- New spec `e2e/checkout-workflow.spec.ts` (credentials-gated, serial): marketplace search + cooperative filter (desktop sidebar and mobile bottom sheet), product detail cooperative identity, cart add/quantity/min-order, checkout "Sold by" cooperative header, pickup card with explicit missing-address warning, 20 kg delivery minimum enforcement, coop-scoped QR listing, QR switching, QR issue report → auto-hide, cash-pickup order creation → order detail → superadmin review/approve.
- Disposable fixtures: two `paymentOptions` rows (`QA Fixture GCash A`/`QA Fixture Maya B`, coop 1) created for the test; `beforeAll` self-heals them (reactivates + clears QA reports) so reruns are deterministic. One cash-pickup order created per run; id recorded to `scripts/_qa-order-id.txt` and removed by `scripts/_qa-cleanup.mts`.
- Fixture state was verified dirty-then-clean during the run: a reported fixture (id 57) was confirmed `isActive=false` with report row preserved, then reset.

## Pickup information assessment

- Manuscript requires "pickup and delivery coordination" (§1.5) — coordination, not a logistics/address-management module.
- Cooperatives have `location` + `address` + new `pickupContactNumber`/`pickupInstructions`/`operatingHours`. Live data: coop 1 has `location` only; coop 13 has `location` + a short `address`. No province/city/barangay decomposition exists or is required by the manuscript.
- Decision: keep pickup non-blocking; checkout shows a clear "has not configured a detailed pickup address" warning rather than implying a verified address, and orders snapshot whatever the cooperative had at order time. No new address module added — that would exceed documented scope. Officers/SuperAdmins can fill in contact/instructions/hours today; `address` remains the free-text pickup address.

## Marketplace grouping assessment

- Manuscript documents cooperative affiliation/oversight and seller-group checkout, but does not require visually grouped catalog sections. The flat grid already shows cooperative identity per card, supports cooperative filtering, search, category, sort, and pagination. Visual sectioning would conflict with global price sort + pagination. Deferred — compliant as implemented.

## Final verification results (this review round)

- `pnpm check` (tsc --noEmit): **pass**.
- `pnpm test` (vitest): **81 files / 524 passed / 22 skipped** — includes updated `adminPaymentOptions` coverage for the SECURITY DEFINER deactivation path.
- `pnpm build`: **pass**.
- Playwright `e2e/checkout-workflow.spec.ts` (persisted workflows, real sign-in, shared DB, disposable fixtures): **10/10 project runs** — mobile-360, mobile-375, tablet-768, desktop-1280, desktop-1920 × 2 tests (marketplace→cart→checkout→QR report; cash-pickup order→order detail→superadmin review). Spec self-heals fixtures via `beforeAll`; mobile filter sheet selectors handled.
- Playwright `e2e/coop-transparency-qr.spec.ts`: **15/15 project runs** — all 5 viewports × 3 tests (buyer transparency, officer scoping, superadmin coop selector).
- DB post-cleanup: `paymentOptions` = 2 legitimate rows (ids 2, 53, coop 3), 0 NULL-coop, 0 QA fixture rows, 0 QR reports, orders max id 69 (all QA orders 70–80 and their payments/transactions/items/history/conversations/notifications removed). `scripts/qa-fixture-cleanup.mts` provided for future runs.
- Note: local `pnpm build` output does not inline `VITE_SUPABASE_*` when `.env.local` is absent from the build env — production builds on Vercel inject env vars at build time; verified unrelated to app code.
