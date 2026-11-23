# AgriCoop Marketplace — File-by-File Technical Reference

Inventory of the repository's relevant files, their purpose, key contents, and modification risk. Generated/vendor files (`node_modules`, `dist`, `drizzle/meta` snapshots internals) are described as groups. Secrets (`.env.local`) are intentionally not reproduced.

**Coverage note:** every tracked source/config/test/script/doc file is listed below. Large generated files (Drizzle meta snapshots, lockfile) and the ~45 shadcn `ui/*` primitives are documented as groups with per-file purpose where they differ from stock shadcn. Files not individually deep-read are marked *(group)* or *(skimmed)*.

---

## Root

| File | Purpose |
|---|---|
| `.env.example` | Template for all env vars (DB URLs, Supabase keys, seed/QA creds). Copy to `.env.local`. |
| `.env.local` | Local secrets — gitignored, never commit. |
| `.gitignore` | Ignores env, dist, node_modules, test-results, backups artifacts. |
| `.prettierrc` / `.prettierignore` | Formatting config. |
| `components.json` | shadcn/ui config (aliases, style). |
| `drizzle.config.ts` | Drizzle Kit config for `pnpm db:generate`. |
| `package.json` / `pnpm-lock.yaml` | Dependencies & scripts (see §Scripts). |
| `playwright.config.ts` | E2E config (base URL, retries, projects). |
| `tsconfig.json` | TS paths (`@/*`, `@shared/*`), strict mode. |
| `vercel.json` | Vercel build/route config. |
| `vite.config.ts` | Vite + React plugin, alias, dev proxy. |
| `vitest.config.ts` | Unit test config. |
| `todo.md` | Working notes scratch file. |
| `LICENSE` | Project license — keep. |
| `README.md` | Project intro + quickstart. |
| `BACKEND_AND_FUNCTIONALITY_AUDIT.md` | Earlier backend audit notes. |
| `MANUSCRIPT_COMPLIANCE.md` | Academic compliance/AI-disclosure record — **required, do not remove**. |
| `api/index.ts` | Vercel serverless entry → `dist/vercel-api.js`. |

## `client/src` — frontend

### Entry & core

- **`main.tsx`** — React root, mounts `App`, providers (QueryClient, Theme, TRPC).
- **`App.tsx`** — Wouter routes for all pages; lazy-loads heavy pages incl. `Marketplace` and `AdminShell`; wraps in ErrorBoundary/Toaster.
- **`index.css`** — Tailwind + custom `agri-*` design tokens (colors, `agri-button`, `agri-card`, `field-control`, etc.).
- **`const.ts`** — app constants.

### `_core/hooks/useAuth.ts`
- Auth hook: exposes `{ user, loading, logout }`; sole `auth.me` caller, `staleTime: 60_000` to avoid refetching on every mount.

### `components/` — shared UI

- **`AgriShell.tsx`** — Public app shell: header (brand, nav, notification bell, cart link, profile menu), `MobileBottomNav` (fixed bottom bar <md), `MobileMenuToggle`/`MobileMenuOverlay` slide-over, `WorkspaceHeader`, `BrandMark`, `ProfileMenu`, `NotificationBell` (mark read/delete), pending badges.
- **`MobileMenuOverlay.tsx`** — Mobile slide-over menu panel + toggle button (`data-testid`s used by E2E).
- **`AdminShell.tsx`** — shadcn `SidebarProvider` shell for `admin`/`superadmin`: role-filtered `adminNavForRole` items, pending-count badges, account dropdown, `SidebarTrigger` (responsive sheet on mobile).
- **`DashboardLayout.tsx`** — Resizable sidebar layout variant (sidebar width persisted in localStorage).
- **`DashboardLayoutSkeleton.tsx`** — Loading skeleton for dashboard.
- **`ErrorBoundary.tsx`** — React error boundary fallback.
- **`OfficerApplicationsPanel.tsx`** — SuperAdmin review UI for coop-admin applications (approve/reject, ID preview via storage proxy).
- **`PendingActivityCards.tsx`** — (Retained) pending-activity card components.
- **`AddAccountDialog.tsx`** — Admin dialog to create accounts.
- **`AdminRefundManagement.tsx`** — Refund management UI for payments.
- **`AdminOrderDetailsQueryError.tsx`** (+`.test.tsx`) — Error state for order detail queries.
- **`NotificationQueryError.tsx`** (+`.test.tsx`) — Error state for notification queries.
- **`CooperativeSelect.tsx`, `CooperativeDuplicateNotice.tsx`** — Cooperative picker + duplicate-name warning.
- **`CartQuantityInput.tsx`** — Accessible qty stepper for cart.
- **`FulfillmentBadge.tsx`, `ListingOptionBadges.tsx`, `StatusPill.tsx`** (+test) — Status/fulfillment badges.
- **`ProductImage.tsx`** (+test) — Product image w/ fallback to `product-default.svg`.
- **`PasswordVisibilityInput.tsx`** (+test) — Password field with show/hide toggle.
- **`SupportTicketStatusSelect.tsx`** (+test) — Ticket status dropdown.
- **`analytics/DashboardAnalytics.tsx`** — Charts/metrics for dashboards (lazy-loaded).
- **`ui/*.tsx`** (~45 files) — shadcn/ui primitives (button, dialog, sheet, sidebar, table, form, chart, etc.). Stock components; safe to update via shadcn CLI. `chart.tsx` backs dashboard analytics.

### `hooks/`

- **`useBuyerCart.ts`** — Cart state, localStorage leftover merge, quantity ops.
- **`useMobile.tsx`** — `useIsMobile` breakpoint hook (sidebar responsiveness).
- **`useComposition.ts`, `usePersistFn.ts`** — Generic utility hooks.

### `lib/`

- **`trpc.ts`** — tRPC client + React Query integration (`trpc` proxy, `useTRPC`).
- **`supabase.ts`** — Supabase client init, `isSupabaseConfigured`, sign-out cleanup.
- **`authSession.ts` / `authSessionManager.ts`** — Session storage/listeners bridging Supabase ↔ app auth.
- **`usePendingCounts.ts`** (+test) — Pending-count queries per role for nav badges.
- **`useRealtimeInvalidation.tsx`** — Subscribes to Supabase Realtime → invalidates queries.
- **`productImages.ts`** (+test) — Image URL helpers/validation.
- **`profileImage.ts`** — Profile avatar upload helpers.
- **`emailVerification.ts`** (+test) — Email-verification return-state parsing.
- **`roleLabels.ts`, `cooperativeConflict.ts`, `datetime.ts`, `utils.ts`** — Display/format/conflict helpers (`cn`).

### `navigation/`

- **`adminNav.ts`** (+test) — `adminNavForRole(role)` item definitions (sections, icons, hrefs), `adminSectionFromSearch`, `adminNavItemForLocation`.
- **`roleNav.ts`** (+test) — Public/bottom-nav definitions per role (`mobileBottomNav`, `mobileNavBadges`).

### `pages/`

- **`Home.tsx`** — Landing page (hero, features, CTA incl. Contact Us).
- **`shared/orderWeight.ts`** — 20 kg delivery-minimum rules: unit→gram conversion (kg, metric ton; other units = unknown weight), `orderWeightGrams`, `meetsDeliveryMinimumWeight`, `formatWeightKg`. Used by Checkout UI and `orders.create`.
- **`shared/orderWeight.test.ts`** — unit tests for weight math and the 20 kg threshold.
- **`Marketplace.tsx`** — Product grid, search/filters, cart panel (`#order`); lazy-loaded route; unfiltered default query shares the `undefined` cache key with Home to avoid a duplicate catalog fetch.
- **`ProductDetails.tsx`** — Gallery, pricing, add-to-cart, favorite, quote/message.
- **`Checkout.tsx`** (+cashCopy.test) — Checkout form, per-seller payment method selection (cash pickup/delivery/online), AgriCoop QR details + receipt upload intent, order submit.
- **`Auth.tsx`** — Login/register/forgot/reset + email-verification states; role resolution after login.
- **`CoopAdminApplication.tsx`** — Cooperative admin application form (coop select + ID upload).
- **`Dashboard.tsx`** (~2500 lines) — Role router + all workspaces: BuyerDashboard, SellerVerificationWorkspace, SellerDashboard, AdminDashboard (sections: overview/users/orders/payments/products/applications/cooperatives/settings/health), member management, listings moderation, payment verification, system panels, permanent-delete dialog.
- **`CooperativePage.tsx`** — Public cooperative profile page.
- **`Activity.tsx`, `OrderDetail.tsx`** — Order tracking/detail.
- **`Messages.tsx`** — Conversation list + thread + composer.
- **`Profile.tsx`** — Profile edit, avatar, verification doc upload.
- **`Support.tsx`, `SupportTickets.tsx`** — Buyer tickets / admin ticket management.
- **`PaymentOptions.tsx`** — OfficerAdmin payment-method/QR management.
- **`Reports.tsx`** — Role-scoped reports + CSV export.
- **`AuditLogs.tsx`** — SuperAdmin audit trail.
- **`About.tsx`, `NotFound.tsx`** — Static pages.

## `server/` — backend

### `_core/`

- **`index.ts`** — Express entry: middleware, `/api/trpc`, storage proxy routes, Vite dev/SSR, health.
- **`app.ts`** — App assembly, router mounting.
- **`context.ts`** — tRPC context: auth token → user resolution.
- **`trpc.ts`** — tRPC init, `publicProcedure`/`protectedProcedure`, error formatting.
- **`env.ts`, `cookies.ts`, `types/cookie.d.ts`** — Env access, cookie helpers, cookie module types.
- **`storageProxy.ts` / `storageProxyAuth.ts`** — Authenticated Supabase Storage proxy; per-resource authorization (product images public-ish, proofs/docs private).
- **`notification.ts`, `conversationStream.ts`** — Notification helpers, streaming, keepalive.
- **`systemRouter.ts`** — System/health procedures.
- **`vite.ts`, `vercelApi.ts`** — Dev vite middleware; serverless handler for Vercel.

### Domain modules

- **`routers.ts`** — Main tRPC router: auth, products, orders, cart, payments, admin (users/coops/listings), notifications.
- **`part2Routers.ts`** — Second router: applications, cooperatives, support, reports, messaging extras.
- **`db.ts`** — Drizzle client + schema (`agricoop_app`), query helpers, `SET LOCAL ROLE` transaction wrapper.
- **`authz.ts`** — Role/coop-scope guards incl. `canSoftDeleteTargetUser` (permanent-delete guard).
- **`orderAccess.ts`** — Order visibility/participation checks (handles null buyer/seller after deletion).
- **`marketplaceRules.ts`** — Listing visibility/moderation rules (null-seller safe).
- **`paymentProofs.ts`, `paymentOptions.ts`, `paymentRefunds.ts`(via shared), `systemPayment.ts`** — Payment proof lifecycle, coop payment options, refunds, system payments.
- **`cart.ts`, `registration.ts`, `coopAdminApplication.ts`, `profileVerification.ts`, `cooperativeAssociations.ts`, `cooperativeNames.ts`, `supportTickets.ts`, `userCooperatives.ts`, `userSoftDelete.ts`, `orderArchive.ts`, `health.ts`, `realtime.ts`, `seedSafety.ts`, `demoSeedRules.ts`, `databaseConfig.ts`, `supabaseConfig.ts`, `clients.ts`, `authIdentity.ts`, `storage.ts`, `integration-test-framework.ts`, `types.d.ts`** — Domain logic: cart ops, registration/role resolution, coop-admin applications, verification, associations, tickets, coop membership, deletion guard, order archive, health, realtime channels, seed guards, DB/Supabase config, clients, identity mapping, storage helpers, test framework, ambient types.

### Tests (`server/*.test.ts`, ~45 files)

Vitest suites covering: access control, auth identity/session/logout, authz, cart, checkout, configuration, context, coop-admin application, cooperative associations/names/soft-delete, credentials, database config/scope, demo seed rules, health, inbox access, listing lifecycle, marketplace rules/list images, migration crosswalk, nested DB scope, officer notification scope, order access/archive, part2 access/security proofs, payment foundation/grant contract/options/proofs/refunds/security, postgres schema contract, production access audit, profile image upload/verification workflow, purchase invariant, quotation archive/workflow, registration(+insert contract/scope), report CSV, seed safety, server credentials, storage, storage proxy, support tickets, trpc procedure access, user cooperatives, user soft-delete(→delete), user upsert, app/conversation stream/storage proxy unit tests.

## `shared/` — isomorphic code

- **`types.ts`, `const.ts`, `_core/errors.ts`** — Shared types/constants/errors.
- **`accountAccess.ts`, `checkoutCart.ts`, `coopAdminApplication.ts`, `cooperativeConflicts.ts`, `cooperativeNames.ts`, `enumLabels.ts`, `fulfillment.ts`, `imageValidation.ts`, `paymentMethods.ts`, `paymentProofs.ts`, `paymentRefunds.ts`, `productOptions.ts`, `profileImage.ts`, `profileVerification.ts`, `quotation.ts`, `reportCsv.ts`, `supportTicketStatus.ts`** — Validation, labels, CSV, and contract helpers shared client↔server.
- **`userFacingErrors.ts`** (+test) — Maps technical errors → plain-language messages.

## `drizzle/`

- **`pg-schema.ts`** — Authoritative Drizzle schema for `agricoop_app` (tables, nullable user refs, `ON DELETE SET NULL` FKs).
- **`schema.ts`, `relations.ts`** — Generated/compat schema + relations.
- **`0000–0011_*.sql` + `meta/`** — Drizzle-generated migrations & snapshots (journal `_journal.json`).
- **`migrations/.gitkeep`** — Placeholder dir.

## `supabase/`

- **`migrations/*.sql`** (~45 files, `20261117…` → `20261205`) — Ordered hand-written migrations: auth/profile access, RLS+grants, marketplace browse perf, payments/fulfillment, coop orders, cart items, soft-delete columns (superseded by permanent deletion), association guards, coop-admin scope, authz hardening, audit writer, fulfillment classification, storage proof policies, quotation locks, counterparty visibility, realtime messaging, indexes, order approval/delivery, notifications, support replies, product online-payment toggle, **coop admin application verification**, **permanent user deletion**.
- **`rls.sql`** — Consolidated RLS policy reference.
- **`PRODUCTION_CATALOG_INSPECTION.sql`, `staging/profile_verification_read_only_preflight.sql`, `storage/profile_verification_bucket.sql`, `test.txt`, `.temp/`** — Inspection/preflight/bucket scripts & temp.

## `scripts/`

- **`seed-defaults.ts`, `seed-demo.ts`, `seed-superadmins.ts`** — Seed reference/demo/superadmin data (local only, `AGRICOOP_SEED_TARGET=local`).
- **`build-manual-sql.mjs`, `build-system-docs.mjs`, `db-push-guard.mjs`, `ship-*.mjs`** — SQL/doc generation, guarded db push, one-off ship/diagnostic utilities.
- **`db-test/`** — Dockerized disposable Postgres harness (`docker-compose.yml`, bootstrap SQL, `safety.*`, `setup.mjs`, `wait.mjs`).
- **`migration/` + `migration-templates/`** — Identity crosswalk tooling & SQL templates.
- **`_browser-qa.mjs`, `_browser-qa2.mjs`, `_menu-check*.mjs`, `_probe*.mjs`, `_pubmenu.mjs`, `_delete-user-smoke.mjs`** — Scratch QA/smoke scripts (underscore-prefixed; not part of build).

## `e2e/`

Playwright specs: `auth-payment-system`, `four-role-acceptance`, `hero-layout`, `marketplace-journeys`, `mobile-menu`, `payment-coop-orders`, `public-nav-layout`, `stage-fixes`.

## `client/public/`

- `images/` — Product photos (Banana, Cacao, Cassava, Coconut, Coffee, Corn, Mango, Pineapple, Rice, Sugarcane), `agricoop-logo/mark`, hero banners, `product-default.svg`.
- `__manus__/debug-collector.js` — Legacy Manus debug collector.

## `deliverables/`

- `IMPLEMENTATION-REPORT.md`, `screenshots/` (QA evidence + `qa-results*.json`), other report artifacts.

## `docs/`

- `AgriCoop_System_Documentation.md` — Earlier system doc (updated for permanent deletion).
- `AGRICOOP_COMPLETE_SYSTEM_DOCUMENTATION.md`, `AGRICOOP_FILE_BY_FILE_REFERENCE.md`, `AGRICOOP_USER_GUIDE.md`, `AGRICOOP_DEVELOPER_SETUP.md`, `AGRICOOP_QA_AND_VERIFICATION_REPORT.md` — This documentation set.

## `backups/` (untracked, protected)

Local backup snapshots — **do not modify or commit**.

---

### Not fully deep-read (honest coverage)

- Individual `ui/*.tsx` primitives beyond confirming they are stock shadcn.
- `drizzle/meta/*.json` snapshots (generated).
- Some `scripts/ship-*.mjs` one-off utilities (skimmed for purpose only).
- `client/public/__manus__/debug-collector.js` (third-party debug snippet).
