# AgriCoop Marketplace — Final Ship Report

Branch: `finish/agricoop-complete`  
Live URL: **https://agricoop-marketplace-final-capstone.vercel.app**  
Updated: 2026-11-17

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

---

## Still needs a human

1. Sign in as each of the four roles and exercise Message / Support / Tickets bulk actions once.  
2. Confirm Supabase Auth Site URL + email redirects match production.  
3. Optional: explicit dispute escalation path for officer access to order chats (logged) — not built; privacy decision documented.
4. Authenticated production E2E for Cash Pickup / Delivery / Online (receipt gate + seller confirm/reject + buyer re-upload) with temporary `qa-test-` accounts — no QA credentials in the agent environment; CI unit/matrix/security tests cover the authorization and receipt rules.
