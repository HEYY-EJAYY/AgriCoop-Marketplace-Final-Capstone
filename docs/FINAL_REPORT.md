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

Recorded after reconciliation:

| Gate | Result |
|------|--------|
| `pnpm check` / `lint` | pass (after App + auth select fixes) |
| `pnpm test` | run in ship step |
| `pnpm build` | run in ship step |
| Playwright | run against production after READY |

---

## Deploy

Updated after push: production deployment id + READY status + smoke notes.

---

## Still needs a human

1. Sign in as each of the four roles and exercise Message / Support / Tickets bulk actions once.  
2. Confirm Supabase Auth Site URL + email redirects match production.  
3. Optional: explicit dispute escalation path for officer access to order chats (logged) — not built; privacy decision documented.
