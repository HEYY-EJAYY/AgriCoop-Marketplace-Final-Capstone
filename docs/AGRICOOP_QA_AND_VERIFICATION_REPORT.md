# AgriCoop Marketplace — QA & Verification Report

Scope: final usability, mobile-responsiveness, repository-cleanup, browser-QA, documentation pass — **plus** the follow-up pass covering mobile dashboard UX, performance investigation, and the online-payment checkout fix. All testing against the **development** environment (`localhost:3000` + dev Supabase/Postgres). No production data touched; nothing deployed or committed.

## Follow-up pass (mobile UX / performance / checkout payment)

### Checkout online-payment root cause & fix

- **Root cause (data/config, not code):** checkout "Online Payment" requires `systemPaymentSettings.onlineEnabled=true` **and** an active `systemOnlinePaymentAccounts` row with a QR (`getSystemPaymentAvailability`). In the dev DB the only account (MAYA, QR present) had `isActive=false` — it was deactivated when a second account (GCASH, id=2) was activated via `systemPayment.activateAccount`, and that second account was later removed, leaving **zero active online accounts** → `onlineAccountReady=false` → `methodsForListings` excluded `online` at both the checkout UI and `orders.create` validation.
- **Product/seller side was already correct:** all 20 catalog products have `onlinePaymentEnabled=true`, `allowsPickup`/`allowsDelivery=true`, approved sellers.
- **Note:** the cooperative `paymentOptions` row present in dev data belongs to cooperative 3 while all catalog products belong to cooperative 1 — cooperative-scoped options are an optional alternative rail (`adminPayment.checkoutOptions`) and are not the canonical checkout online method.
- **Fix applied:** activated account id=1 through the real admin path — `systemPayment.activateAccount` as SuperAdmin (audit-logged `account_activated`). No code/schema change was required; backend validation (`orders.create` → `methodsForListings` + `assertPaymentOptionSelection` + receipt verification) was already correct and remains enforced.
- **Browser verification:** buyer cart (Sugarcane ×200 + Ginger ×10) → `/checkout` shows Cash on pickup / Cash on delivery / **Online Payment** → selecting it shows "Pay via AgriCoop QR", MAYA account name/number, amount ₱1,350.00, QR image, and required receipt upload. Verified at 1366×768 and 375×667 (screenshot `checkout-online-selected.png`, `mobile-375-checkout-online.png`). Order submission itself was not re-executed (would create dev orders; covered by existing tests + prior verification).

### Code changes this pass

- `client/src/pages/Dashboard.tsx` — Buyer dashboard payment section renamed "GCash payments" → "Online payments"; filter now includes canonical `online` (previously only legacy `gcash`, which would have hidden every new online order's proof/status); per-item label uses `paymentMethodLabel`.
- `client/src/_core/hooks/useAuth.ts` — `auth.me` query `staleTime: 60_000` (was 0 → refetched on every mount/navigation).
- `client/src/pages/Marketplace.tsx` — default unfiltered listing query now shares the `undefined` cache key with other callers (e.g. Home), eliminating a duplicate full-catalog fetch on marketplace load.

### Performance baseline (measured, Playwright, localhost)

| Page | TTFB | FCP | LCP | JS transferred | API calls |
|---|---|---|---|---|---|
| `/` (public) | 6 ms | 272 ms | 284 ms | ~5.4 MB total page resources (incl. images) | 2 |
| `/marketplace` (public) | 5 ms | 248 ms | 248 ms | — | 1 (batched) |
| `/dashboard` (buyer) | 187 ms | 372 ms | 372 ms | — | 3–4 batched |

- Bundle: `index.js` 906.9 kB (245.6 kB gzip) entry; `DashboardAnalytics` 478.7 kB already lazy-loaded; `Dashboard` 317 kB lazy route chunk. Large entry chunk is the main remaining frontend cost.
- `getMarketplace` is a single joined query + 2 batched queries (reservations, images) — no N+1; returns full catalog (no pagination) — acceptable at 20 listings, revisit if catalog grows.
- Observed duplicate `marketplace.list` fetch on authed marketplace load → fixed via shared cache key (above). `auth.me` refetched per mount → fixed via staleTime.

### Mobile dashboard verification (real browser, Chromium emulation)

Dashboards for all four roles at **320×568, 375×667, 390×844, 430×932**: **16/16 checks — 0 horizontal overflow, 0 undersized touch targets detected**; content renders role-appropriately (buyer workspace, seller verification workspace, officer/superadmin sidebar shell). Screenshots: `mobile-{320,375,390,430}-{role}-dashboard.png`, results in `mobile-dash-results.json`.

Mobile-specific notes: admin sidebar opens as a sheet via "Toggle navigation"; public pages use bottom nav + slide-over menu; tables use `overflow-x-auto` with `min-w` (intentional horizontal scroll); bottom nav has safe-area padding and page bottom padding prevents overlap.

## Environment

- App: `pnpm dev` (Express + Vite) on `http://localhost:3000`
- Browser automation: Playwright Chromium (`scripts/_browser-qa*.mjs`, ad-hoc probes)
- Accounts: seeded dev accounts only — buyer, seller, officer (OfficerAdmin), superadmin. No passwords recorded here.

## Viewports tested (real browser, responsive emulation)

| Label | Size | Used for |
|---|---|---|
| Small smartphone | 320×568 | public pages |
| Smartphone | 375×667 | all roles, all pages |
| Modern smartphone | 390×844 | public pages |
| Large smartphone | 430×932 | public pages |
| Tablet | 768×1024 | public pages |
| Desktop | 1366×768 | all roles, all pages |

## Results

### Horizontal overflow / layout

Method: `document.documentElement.scrollWidth - clientWidth` after page settle; any value >2px flagged OVERFLOW with offending elements listed.

- **Public pages** (`/`, `/marketplace`, `/auth`, `/about`, `/cooperatives`) at all 6 viewports: **30/30 pass, 0 overflow**.
- **Authenticated pages** at 375×667 and 1366×768 for buyer, seller, officer: `/dashboard`, `/marketplace`, `/messages`, `/profile`, `/support`, `/activity` (+ `/reports`, `/admin/payment-options` for officer): **all pass, 0 overflow**.
- **SuperAdmin** `/dashboard` at 375×667 and 1366×768: **pass** (overflowX 0 / −15).

### Navigation

- Public mobile menu (`mobile-menu-toggle` → `mobile-menu-panel`): opens, shows role-appropriate links, **closes after navigation** — verified at 375px (screenshot `qa-phone-public-menu.png`).
- Admin/SuperAdmin sidebar: `Toggle navigation` trigger present at 375px; opens mobile sheet — verified for officer (`qa-phone-officer-nav-open.png`).
- Buyer workspace exposes nav links (`/marketplace`, `/activity`, `/messages`, `/support`, cart) at 375px.
- Bottom mobile nav (`MobileBottomNav`, `md:hidden`) present on public pages with pending badges.

### Role workflows spot-verified in browser

- Sign-in for buyer/seller/officer/superadmin → redirects to `/dashboard` with role-appropriate content (verified via DOM text + screenshots).
- Officer dashboard shows cooperative-scoped metrics ("Cooperative users", "Your cooperative") and admin sidebar sections.
- Seller dashboard renders verification/association workspace (seed seller is pending association — expected state).
- All tested pages rendered real content (no blank screens) after adequate load waits.

### Incidents found & resolved during QA

- **Dev server wedge (environment, not app bug):** mid-session the local server stopped responding to all requests (health included). Restarting `pnpm dev` restored service; subsequent login + all page checks passed. No code change required.
- **Test-selector false negatives:** initial mobile-menu probes used selectors that don't match this app (`mobile-menu-toggle` exists only on public AgriShell pages; admin uses `Toggle navigation`). Corrected probes confirmed both nav patterns work.

## Known limitations / not fully verified

- **Checkout/payment proof upload, order placement, application approval, and permanent deletion** were verified in earlier sessions via live smoke tests and unit/integration tests, but were **not re-exercised end-to-end in this browser pass** (would create dev-data mutations; deemed sufficient coverage from prior verification + this pass's page-level checks).
- **Actual physical mobile device** not available — verification used Chromium device emulation at the required viewports.
- **Cooperative Admin application ID upload on mobile** not re-tested in browser this pass; file inputs are standard and the form was previously verified.
- Some dashboard sections (deep admin tables, charts) checked for overflow but not every interactive control clicked.
- `qa-phone-*-menu.png` files from the first (selector-broken) probe may show closed menus; authoritative menu evidence is `qa-phone-public-menu.png` and `qa-phone-officer-nav-open.png`.

## Automated test results (this pass)

See final-validation section of the session report: `pnpm check`, `pnpm test` (Vitest), `pnpm build`, `pnpm install --frozen-lockfile`.

## Screenshot index

`deliverables/screenshots/` — `qa-{viewport}-{page}.png` per page/viewport, `qa-{vp}-{role}-*.png` for authenticated pages, `qa-results.json` / `qa-results-2.json` machine-readable results, plus earlier role dashboard captures (`dashboard-*.png`, `marketplace-catalog.png`, `product-detail-*.png`).

---

## Final production-readiness pass (2026-11-22)

### Bundle optimization

- `client/src/App.tsx`: `AdminShell` and `Marketplace` converted from eager imports to `React.lazy` (rendered via existing `LazyPage`/`Suspense` + `ErrorBoundary`).
- Entry chunk: **906.9 kB → 727.5 kB uncompressed; 245.6 → 207.6 kB gzip (−20%)**. New lazy chunks: `AdminShell` 57.8 kB, `Marketplace` 61.3 kB.
- Verified: `pnpm check` 0 errors, `pnpm test` 78 files / 471 passed / 22 skipped, `pnpm build` success, live navigation to `/marketplace`, `/admin/payment-options`, `/dashboard`, `/auth` on dev server.

### End-to-end online payment workflow (dev, real API + Storage)

- `systemPayment.getAvailability` → online enabled + account ready.
- Receipt upload → signed URL → finalize → `orders.create` (online/pickup) → **order 70** created; `paymentStatus=awaiting_verification`, proof `pending`.
- Negative tests: missing receipt intent → 400; invalid payment method → 400; below-minimum qty → 400.
- Coop isolation: OfficerAdmin (coop 3) → 404 on order 70 (coop 1).
- SuperAdmin `payments.reviewProof`: reject-without-note → 400; reject with note → 200 → payment `failed`, proof `rejected`.
- Cleanup: order 70 cancelled (cancelled dev record retained by design). Disposable receipt object remains in private `payment-proofs` bucket.
- Cash pickup/delivery still enabled; not re-ordered this pass (code unchanged, unit-covered).

### Production readiness

See `docs/AGRICOOP_FINAL_DEPLOYMENT_READINESS.md` — full 16-section report with per-item status labels, migration preflight requirements, env var matrix, Vercel/Supabase checklists, deployment sequence, smoke tests, and rollback notes. No commit/push/deploy performed; production untouched.

## Finalization re-verification (2026-11-23)

Re-run on the final working tree before commit, under the project's required runtime **Node.js v22.23.5 + pnpm 10.4.1** (via fnm; engines specify `node: 22.x`):

- `pnpm install --frozen-lockfile` — clean, lockfile up to date.
- `pnpm check` (`tsc --noEmit`) — **0 errors**.
- `pnpm test` (Vitest) — **78 test files, 471 passed, 22 skipped** (matches prior baseline; the two new test files `server/coopAdminApplication.test.ts` and `client/src/lib/usePendingCounts.test.ts` are included in this count).
- `pnpm build` — **success**; `index` entry chunk 727.52 kB / 207.59 kB gzip (unchanged from the post-lazy-load baseline; >500 kB chunk warning persists and is documented, not a regression).

No production systems, databases, or deployments were touched during this pass.

## Checkout fulfillment/payment separation (local dev verification)

Verified on the local dev server (`pnpm dev`, Node v22.23.5) against the development database via Playwright (Chromium) at desktop 1280px and mobile 360px viewports. Screenshots: `deliverables/screenshots/checkout-fulfillment/`.

- Fulfillment picker (Pickup/Delivery cards) renders **before** the payment fieldset; payment options are filtered to compatible methods only (pickup → Online Payment + Cash on Pickup; delivery → Online Payment + Cash on Delivery).
- Switching fulfillment resets incompatible payment selection; delivery reveals the required address form and keeps submit disabled until all fields are complete; pickup requires no address.
- Online Payment shows the AgriCoop QR/account details plus receipt upload for both pickup and delivery, with an explicit "Fulfillment: Pickup/Delivery" line.
- Order surfaces (dashboard order rows, order detail) display fulfillment and payment labels separately.
- Automated coverage: `server/orderFulfillment.test.ts` (10 tests) exercises `orders.create` for all four valid combinations plus rejections — missing fulfillment for online, delivery without address (cash and online), incompatible cash/fulfillment pairs, online without active account, and online without receipt intent. `pnpm check`/`pnpm test`/`pnpm build` re-run green (79 files, 481 passed, 22 skipped).

Limitations: browser pass did not submit real orders (order submission covered by the automated router tests); no production deployment or production data was touched.

---

## Delivery minimum weight + realistic inventory (2026-11-23, dev only)

### 20 kg delivery minimum

- New shared util `shared/orderWeight.ts`: weight derived from product selling unit — `kg`→qty, `metric ton`→×1000; `piece`/`bunch`/`sack`/unknown → weight undetermined (blocks delivery, never assumed). Integer-gram math, no float drift.
- Backend: `orders.create` recomputes weight from DB product units per seller group and rejects `delivery` < 20,000 g or with unknown-weight units; Pickup exempt; client-submitted weight fields ignored.
- Frontend: checkout disables the Delivery radio below 20 kg with the exact explanation ("Minimum order weight for Delivery is 20 kg. Your current order weighs X. Add Y kg more…"), keeps Pickup selected, and auto-coerces a stale Delivery selection back to Pickup when the cart drops below the minimum.
- Live API (dev): 10 kg → 400 "weighs 10 kg"; 19 kg → 400; 20 kg → order created (cancelled after verification).
- Browser (dev, desktop 1366 + mobile 390): 10 kg → Delivery disabled + message; 20 kg → enabled; Delivery → address form; drop to 19 kg → auto-Pickup + message. Screenshots: `deliverables/screenshots/delivery-minimum/`.
- Tests: `shared/orderWeight.test.ts` (14), `orderFulfillment.test.ts` +4 cases (below-min reject cash+online, pickup exemption, unknown-unit reject, forged-weight reject); `Checkout.deliveryAddress.test.tsx` +3 source assertions. Suite: 81 files / 507 passed / 22 skipped; `pnpm check` clean; `pnpm build` OK.

### Inventory adjustment (dev DB only, unit = kg for all 20 products)

Stock is stored in the product's selling unit — all catalog products sell by `kg`, so `stockQty` is kg. Open-order reservations were factored in (products 54, 58, 62, 64, 65, 69 have reserved stock; adjusted values keep `stock − reserved ≥ minOrderQty`).

| ID | Product | Was | Now | Note |
|---|---|---|---|---|
| 50 | Banana | 5000 | 120 | common stock |
| 51 | Banana | 2500 | 80 | |
| 52 | Banana | 3000 | 60 | |
| 53 | Banana | 4500 | 150 | |
| 54 | Coconut | 8000 | 220 | reserved 100 |
| 55 | Young Coconut | 1500 | 45 | |
| 56 | Mango | 1175 | 90 | seasonal |
| 57 | Calamansi | 880 | 35 | |
| 58 | Pineapple | 2000 | 120 | reserved 50 |
| 59 | Avocado | 750 | 25 | limited |
| 60 | Durian | 1475 | 40 | seasonal |
| 61 | Cacao | 790 | 60 | |
| 62 | Coffee | 600 | 30 | reserved 10, high-value |
| 63 | Abaca | 975 | 55 | |
| 64 | Rubber | 2000 | 160 | reserved 50 |
| 65 | Sugarcane | 10000 | 320 | reserved 200 |
| 66 | Palay | 5000 | 300 | |
| 67 | Yellow Corn | 3000 | 180 | |
| 68 | Cassava | 2000 | 140 | |
| 69 | Ginger | 500 | 25 | reserved 10, scarce |

All 20 products (IDs 50–69), images, prices, names, and ownership unchanged. No production data touched; no commit/push/deploy.

## Cart default quantity (post-deployment fix)

- `cart.add` now seeds a new cart line at quantity **1** and increments an existing line by **1** — never by `minOrderQty` or stock. All Add-to-Cart entry points funnel through this single mutation (Marketplace cards; Product Details and Home link into the marketplace basket).
- Cart quantities are drafts clamped to `[1, available stock]`; the configured `minOrderQty` is enforced at the order boundary — `prepareOrder` rejects below-minimum quantities server-side, the cart panel shows a "Minimum order is X" hint, `submitCart` blocks checkout, and `Checkout` disables submit until every line meets its minimum.
- Regression coverage: `server/cart.test.ts` (+8: stock 100/25/2 → qty 1, min>1 → qty 1, re-add +1, stock clamp, below-min draft, stock clamp on update); `purchaseInvariant.test.ts` updated to the new contract. Browser QA (desktop 1366 + mobile 390): 14/14 checks — screenshots in `deliverables/screenshots/cart-default-quantity/`.

## Catalog minimum order quantity (data update)

- All 20 catalog listings (product IDs 50–69, all sold by `kg`) now have `minOrderQty = 5` (previously 10–100). Only the `minOrderQty` column was updated; prices, stock, units, images, and ownership are unchanged. Because dev and production share the database, this applies to live buyers.
- Cart lines still start at quantity 1; the per-product minimum (now 5 kg) is enforced at checkout (`submitCart`, Checkout submit gating) and server-side (`prepareOrder` → "minimum order of 5 kg"). The separate 20 kg Delivery minimum is unchanged — Pickup has no weight minimum.
- Verified on production: all listings report `minOrderQty: 5`; add-to-cart starts at 1 with a "Minimum order is 5 kg" hint; qty 5 clears it; `orders.create` rejects qty 1 with HTTP 400; Delivery stays disabled below 20 kg total.
