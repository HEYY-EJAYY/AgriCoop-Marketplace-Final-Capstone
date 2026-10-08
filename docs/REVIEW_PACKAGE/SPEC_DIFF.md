# Current Implementation vs Migration Specification — Slice 0

This document records gaps only. Slice 0 did not modify application code.

## 1. Stack

**Specification:** Next.js App Router, TypeScript, Tailwind CSS, Supabase Auth + Postgres + Realtime + Storage, Vercel-ready, free tiers, no Manus services.

**Current baseline:** React/Vite/Wouter client, Express/tRPC server, Drizzle ORM with MySQL/TiDB, Supabase Auth token verification, in-process SSE, and Manus template/runtime remnants.

**Paths:**

- `package.json`: scripts are `vite build` and Express/esbuild production build; dependencies include `vite`, `wouter`, `express`, `@trpc/*`, `drizzle-orm`, and `mysql2`.
- `vite.config.ts`: Vite application configuration and Manus runtime integration.
- `client/src/App.tsx`: Wouter route switch, not Next App Router.
- `server/_core/index.ts`: Express server entrypoint.
- `drizzle/schema.ts`: MySQL/TiDB schema.
- `server/_core/storageProxy.ts`, `server/storage.ts`: current storage path, not Supabase Storage.
- `server/realtime.ts`, `server/_core/index.ts`, `client/src/pages/Support.tsx`: in-process SSE conversation updates, not Supabase Realtime.
- `app/` and `next.config.mjs` may exist as a previously prepared native shell, but the current business runtime remains Vite/Express/MySQL and is not a completed Next.js migration.

## 2. Role names and role model

**Specification:** Buyer; Seller/Farmer; Admin Officer; SuperAdmin/System Admin. Admin Officer approves members/listings inside their cooperative; SuperAdmin approves Admin Officers and controls the platform. Buyer/Seller public registration only; Seller and Admin Officer require approval; SuperAdmin is never publicly creatable.

**Current baseline:** The runtime uses `buyer`, `seller`, `admin`, and `superadmin` in the active schema/authorization model, with Admin serving as the cooperative oversight role. The manuscript-facing name `Admin Officer` is not consistently represented in runtime names. Historical officer references remain in checklist/docs/template code.

**Paths:**

- `drizzle/schema.ts`: active role enum/model.
- `server/authz.ts`: operational role helpers.
- `server/routers.ts`: `cooperativeAdmin` and `admin` procedures; privilege gates.
- `client/src/pages/Auth.tsx`: public role registration UI.
- `client/src/pages/Dashboard.tsx`: role branches and Admin workspace.
- `supabase/rls.sql`: target policies use `admin`/`superadmin`, not the exact `admin_officer` naming requested.
- `scripts/seed-demo.ts`: demo role records.
- `todo.md`: contains historical officer terminology.

## 3. Email auto-confirmation

**Specification:** Use email verification; do not auto-confirm emails.

**Current baseline:** The server-side registration implementation creates confirmed users for the simplified demo signup path, so it bypasses the requested email-verification flow.

**Paths:**

- `server/routers.ts`: registration procedure and Supabase admin user creation.
- `client/src/pages/Auth.tsx`: registration UI/copy and sign-in flow.
- `server/_core/context.ts`: bearer-session-to-local-user onboarding behavior.
- `client/src/lib/supabase.ts`: browser Auth client.

## 4. Inventory deduction timing

**Specification:** Stock is deducted only when the authorized officer/Seller marks the order COMPLETE, after a fresh stock check; final quantities may be edited before confirmation.

**Current baseline:** The order creation path decrements stock when an order is placed. Completion/status transitions do not implement the specified fresh-stock-check-and-final-quantity workflow.

**Paths:**

- `server/routers.ts`: order creation and order status procedures.
- `server/db.ts`: product/order/inventory helpers.
- `server/marketplaceRules.ts`: stock and order rule calculations.
- `drizzle/schema.ts`: `products.stockQty`, `orders.status`, and order-item fields.
- `client/src/pages/Marketplace.tsx`: checkout/order submission.
- `client/src/pages/Dashboard.tsx`: seller order/status UI.
- `scripts/seed-demo.ts`: demo order/transaction states.

## 5. Cancellation and stock restoration

**Specification:** Cancelling never deducts stock; if stock was ever reserved, cancellation restores it.

**Current baseline:** The application does not provide a verified reserve-at-order / restore-on-cancel lifecycle matching the specification. The current placement-time deduction creates a mismatch and cancellation/restore behavior is not proven by an end-to-end test.

**Paths:**

- `server/routers.ts`: order creation/status logic.
- `server/marketplaceRules.ts`: current state-transition rules.
- `server/db.ts`: inventory update helpers.
- `client/src/pages/Dashboard.tsx`: order status controls.
- `server/marketplaceRules.test.ts`: current rule coverage does not prove the required reserve/restore semantics.

## 6. Payment handling

**Specification:** Face-to-face or externally coordinated only; no gateway; record payment reference note on transaction.

**Current baseline:** The active application is F2F-only and does not use a payment gateway. This part is aligned in intent, but the full completion-time transaction workflow depends on the inventory/order correction above.

**Paths:**

- `drizzle/schema.ts`: order/transaction payment fields.
- `server/routers.ts`: F2F transaction/order handling.
- `client/src/pages/Marketplace.tsx`: F2F-only checkout copy and controls.
- `client/src/pages/Activity.tsx`: payment method/status visibility.
- `client/src/pages/Reports.tsx`: transaction/payment reporting.
- `scripts/seed-demo.ts`: F2F demo transactions.
- `server/_core/index.ts`: legacy PayMongo route was removed, but historical payment notes remain in `docs/payment-integration-notes.md` and generated/project history.

## 7. Three-party conversations

**Specification:** Buyer inquiry or quotation opens a realtime conversation containing Buyer, Seller, and the Admin Officer of the Seller's cooperative; the product is embedded in the thread.

**Current baseline:** The current conversation model and access checks are Buyer/Seller participant-oriented, with Admin/SuperAdmin oversight. The Admin Officer is not explicitly stored as a third participant and the active realtime implementation is an in-process SSE broker rather than Supabase Realtime.

**Paths:**

- `drizzle/schema.ts`: conversation fields contain Buyer/Seller/product/order/quotation context but no explicit Admin Officer participant field.
- `server/routers.ts`: automatic thread creation and participant access logic.
- `server/db.ts`: conversation lookup and message helpers.
- `server/realtime.ts`: in-process event broker.
- `server/_core/index.ts`: authenticated SSE endpoint.
- `client/src/pages/Support.tsx`: SSE listener and support UI.
- `supabase/rls.sql`: target policies cover Buyer/Seller/admin roles but do not yet model an explicit three-party Admin Officer membership.

## 8. Order quantity and bulk-order rules

**Specification:** Each product enforces `min_order_qty` and `max_order_qty`; a bulk order may contain multiple products only when every product belongs to exactly one seller.

**Current baseline:** The active MySQL schema has no product-level minimum or maximum quantity columns. Bulk-order validation is represented in UI/business-rule code but is not yet proven as a server-side/database invariant, and the current order model stores one seller on the order without a verified multi-item single-seller constraint.

**Paths:** `drizzle/schema.ts`, `server/routers.ts`, `server/marketplaceRules.ts`, `client/src/pages/Marketplace.tsx`, `scripts/seed-demo.ts`.

## 9. Role approval rules

**Specification:** Public sign-up creates only Buyer or Seller accounts. Sellers and Admin Officers require approval. Admin Officers approve Buyers and Sellers within their own cooperative. SuperAdmin approves Admin Officers, manages the platform, and can never be created through public sign-up.

**Current baseline:** The prototype has approval fields and role gates, but the active role value is `admin` rather than `admin_officer`; the cooperative-scoped approval workflow and the prohibition on public SuperAdmin creation are not yet proven against the target Postgres/RLS model.

**Paths:** `drizzle/schema.ts`, `server/authz.ts`, `server/routers.ts`, `client/src/pages/Auth.tsx`, `client/src/pages/Dashboard.tsx`, `supabase/rls.sql`, `scripts/seed-demo.ts`.

## 10. Product quality grade

**Specification:** Quality grade A/B lets farmers list produce that fails strict market standards.

**Current baseline:** The schema and seed data have a quality-grade concept, but the implementation uses values such as `premium`/`standard` in places rather than a verified A/B workflow across UI, validation, reports, and tests.

**Paths:** `drizzle/schema.ts`, `scripts/seed-demo.ts`, `client/src/pages/Dashboard.tsx`, `client/src/pages/Marketplace.tsx`, `server/routers.ts`.

## 11. Reports

**Specification:** Admin Officer and SuperAdmin reports limited to sales, inventory, quotations, and transactions in CSV.

**Current baseline:** CSV report functionality exists and is tested, but the role naming and target dashboard/API migration are not yet aligned to the exact Admin Officer model.

**Paths:** `server/routers.ts`, `server/reportCsv.test.ts`, `shared/reportCsv.ts`, `client/src/pages/Reports.tsx`, `client/src/pages/Dashboard.tsx`.

## 12. Required quality evidence not present at baseline

- No configured lint script: `package.json`.
- No Playwright suite or evidence: repository inventory contains Vitest tests only.
- No RLS integration tests against a real Supabase Postgres project.
- No Lighthouse report.
- No four-viewport screenshot package for every role/screen.
- No low-bandwidth bundle/load report.
- No verified rate limiting for auth/write endpoints.
- No verified safe Supabase Storage upload flow.
- No verified admin audit-log implementation.
- No clean-clone final verification.
- No Vercel preview deployment backed by the fully migrated business runtime.

## 13. Baseline conclusion

The current project is a functional thesis prototype with a documented migration path, not yet the final target stack defined by the supplied specification. These gaps are the input to Slice 1 and later slices. They are intentionally not hidden or marked as complete.
