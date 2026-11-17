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

## Deploy

| Item | Value |
|------|-------|
| Commit | `b88b52d` |
| Production | `dpl_CYFdiry2J3nveq1aW7ACdbsqszru` |
| readyState | **READY** |
| Alias | https://agricoop-marketplace-final-capstone.vercel.app |
| Smoke | `/` **200**; `/api/health` ok |
| Playwright | Mobile menu overlay **8/8** (360 + 768) on production |
| Runtime logs | No errors on this deployment window |

---

## Still needs a human

1. Sign in as each of the four roles and exercise Message / Support / Tickets bulk actions once.  
2. Confirm Supabase Auth Site URL + email redirects match production.  
3. Optional: explicit dispute escalation path for officer access to order chats (logged) — not built; privacy decision documented.
