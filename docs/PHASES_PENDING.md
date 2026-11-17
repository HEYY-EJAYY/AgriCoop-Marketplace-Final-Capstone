# Remaining phases and unfinished work

> Historical status note: the PostgreSQL runtime conversion described as future work in Phase 11 has since been started. The application code now uses a PostgreSQL Drizzle adapter, but database-side grants/RLS and missing payment/demo-seed schema prevent staging validation. No migration or seed was executed. See the current status in [`PROJECT_SUMMARY.md`](./PROJECT_SUMMARY.md).

This document records the work that is still pending after the current repo state and the phase work already completed on `manus-phases`. It is intentionally independent from the implementation notes in chat so that a future developer can pick it up without relying on memory.

## Current status snapshot

### Verification update — 2026-11-17

- The active runtime is PostgreSQL through `postgres-js`/Drizzle and the `drizzle/pg-schema.ts` schema; `server/_core/index.ts` is the package dev/build/start entry. Legacy MySQL schema and migration artifacts remain and are not the active runtime.
- The Vercel function entry is `api/index.ts` → `server/_core/app.ts`; both runtime entry points use `server/routers.ts`. The authenticated conversation stream is now registered from a shared route helper in both apps. `server/routers.fixed.ts` remains an unreferenced alternative and was preserved.
- The shared conversation stream now requires verified email and an operational account, enforces role/cooperative thread scope, and handles invalid credentials and provider/database failures explicitly. Regression tests cover blocked and authorized cases in both route-level and app-mount tests.
- Auth/profile resolution now queries `agricoop_app.users.openId` directly with the verified Supabase Auth UUID, then validates the separate canonical public role mapping. Missing/duplicate mappings fail closed; no profile is created at login. SQLSTATE permission/schema failures have distinct safe outcomes.
- A security review found and the current code fixes a moderation bypass: changes to an approved listing's content or gallery now hide it and reset it to pending. A direct `primaryImageUrl` update can no longer bypass gallery validation.
- Current local validation passes: `pnpm check`, `pnpm test` (38 files, 218 tests), `pnpm build` (Vite client and package server), Vercel API in-memory bundling/config JSON validation, and `git diff --check`. Existing ignored `dist` contents were preserved and restored after the build. Vite reports the existing >500 kB chunk warning and Node `module.register()` deprecation warning. Vercel CLI validation and deployment were not performed. Uploads are capped at 3 MiB per image with a 4,300,000-byte Express parser limit to fit Vercel's request-size budget. No authenticated browser, isolated PostgreSQL, Supabase Auth/Storage/Realtime, RLS, or staging integration test was performed.
- Active Buyer/Seller registration now relies on Supabase email confirmation instead of auto-confirming users. Public roles and approval remain server-assigned; unconfirmed Auth identities are rejected before application mapping. The `/auth` UI handles required, successful, expired, and resend states. The process-local signup/resend limiter is not distributed and does not replace Supabase Auth rate limits.
- `server/routers.fixed.ts` remains unreferenced and unchanged; it contains an obsolete registration implementation and must not be wired into either server entry point without replacing it with the verified flow.
- The legacy `/manus-storage/*` package-server route is retained for existing referenced product images and now requires a verified, operational account plus exact product-image reference and role scope (Seller ownership, cooperative Admin, platform SuperAdmin, or eligible public listing). It rejects arbitrary and payment-proof paths. The Vercel app does not mount this route. Local route/helper tests pass; no live storage request was made.
- A read-only active-code security review reported no exploitable vulnerability meeting its reporting threshold. It identified unverified production-schema/RLS gates and the conditional risk that legacy `/manus-storage/` image references will not resolve on Vercel. Production references were not queried; see [`SECURITY_REVIEW.md`](./SECURITY_REVIEW.md).
- Deployment still requires Supabase Auth email confirmation, HTTPS `APP_URL`, the exact `/auth?verification=success` redirect allowlist entry, delivery/SMTP, and Auth rate limits. These settings were not changed or verified. Accounts created while the previous code auto-confirmed email may still have `email_confirmed_at` and cannot be distinguished from genuinely confirmed users by the current application; an authorized owner review is required.
- No local database was started or contacted. `DATABASE_URL` is absent from the process environment; `.env.local` exists but its contents were intentionally not inspected because its target is unverified. No repository-local Compose/test database configuration was found.

Completed in the current branch:
- Phase 1: Manila timezone/date handling was centralized in `client/src/lib/datetime.ts` and applied to dashboard/report/support views.
- Phase 2: order review and cooperative-scoped admin visibility were added via `server/authz.ts`, `server/db.ts`, and `server/routers.ts`.
- The project summary was written to `docs/PROJECT_SUMMARY.md`.
- The repo passes the project validation commands as of the latest run: `corepack pnpm check` and `corepack pnpm test`.

Not complete: the remaining market and governance phases below are still undone or only partially implemented.

## Phase 3 — Profile and verification workflow

Status: IMPLEMENTED LOCALLY; DATABASE/STORAGE SETUP AND RETENTION REVIEW PENDING

What is implemented now:
- Buyer/Seller verification form with required birthdate, phone, consent, optional address/note, supported image checks, and pending/approved/rejected status/history.
- Upload authorization is owner-bound and short-lived; file type, actual byte count, path, and image signature are revalidated server-side.
- Evidence is private; only an authorized Admin in the applicant's cooperative or a SuperAdmin receives a short-lived signed review URL.
- Admin/SuperAdmin queue and decision controls enforce cooperative/platform scope. Rejection requires a reason; locked, pending-only review updates the submission and profile, audit log, and applicant notification in one transaction.
- A partial unique index and locked user row prevent concurrent pending submissions. Rejected applicants may resubmit; pending or approved applicants may not.
- The new additive PostgreSQL migration remains an unexecuted draft; no live schema/policy behavior is claimed.

What remains:
- Manually confirm/configure the proposed private `profile-verification-documents` bucket (5 MiB, JPEG/PNG/WebP) and review its Storage policies. The app does not create buckets.
- Reconcile the migration's catalog and existing RLS/ACL preconditions before any separately approved execution.
- Decide identity-document retention/deletion rules. Previous and abandoned objects are not automatically deleted.
- Add/live-verify DB grants, policies, trigger behavior, private upload/download, and cooperative isolation only after an approved database operation; no production SQL or Storage access has been performed.

Relevant files:
- `drizzle/pg-schema.ts`
- `server/routers.ts`, `server/profileVerification.ts`, `server/storage.ts`
- `shared/profileVerification.ts`, `shared/imageValidation.ts`
- `client/src/pages/Dashboard.tsx`
- `supabase/migrations/20261117120000_profile_verification_submissions.sql`
- `docs/SUPABASE_CONFIGURATION.md`

## Phase 4 — Monitoring, suspension, and audit controls

Status: PARTIAL

What is now in place:
- Suspension is enforced centrally in `server/authz.ts`: suspended non-superadmin accounts are denied operational access, even when their role is otherwise valid.
- `getAdminOverview()` and `getOfficerOverview()` already surface member, product, order, quotation, and transaction rows so admin/officer monitoring is structurally present.
- `orderEvents` in `drizzle/schema.ts` provides a minimal audit trail for order status changes.
- Local writes now include audit/notification records for product review, refunds/cash receipts, support ticket work, cooperative association reviews, and account-access changes where implemented.

What is still missing:
- A complete cooperative officer monitoring dashboard with member, product, order, and transaction visibility scoped to an officer's cooperative.
- A formal user suspension UI and notification flow for buyers, sellers, or officers.
- Flagging/reporting flow for bad listings, suspicious behavior, or policy violations.
- Complete audit coverage for every role/status change, Seller listing edit, and order/payment transition; profile-verification decisions are now audited.
- A consistent, user-facing audit report for all Admin and SuperAdmin actions.

Relevant files:
- `server/db.ts`
- `server/routers.ts`
- `server/authz.ts`
- `drizzle/schema.ts` (there is a basic order event trail, but no full audit table or reporting layer)

## Phase 5 — Support conversations and chat features

Status: PARTIAL

What exists now:
- Support-ticket creation, replies, status transitions, cooperative assignment, and role-scoped access are implemented in `server/routers.ts`; associated ticket messages are stored in the application schema.
- Support notifications/audit writes are included in the relevant transactional procedures.
- The client support page (`client/src/pages/Support.tsx`) renders conversations.
- SSE-style realtime updates are wired via `server/realtime.ts`.
- Conversation clients reconnect with backoff and database polling remains the cross-instance fallback.

What remains undone:
- Three-party conversation rules beyond basic buyer/seller support threads.
- Message types beyond plain text (image, location, system notice, deleted/hidden messages).
- Delete/hide/archive semantics on a message or conversation.
- Conversation role logic for officer, admin, and superadmin visibility without leaking data.
- Realtime behavior validation in a second browser and across multiple server instances.
- Supabase Realtime integration; current SSE notifications are process-local.

Relevant files:
- `server/routers.ts`
- `server/realtime.ts`
- `client/src/pages/Support.tsx`
- `drizzle/schema.ts`

## Phase 6 — Reports, reconciliation, and CSV exports

Status: PARTIAL

What exists now:
- Some CSV export logic is present in report-related server/client code.
- Date/time formatting in exports was improved for Manila time.

What remains undone:
- Formal CSV reports for each required domain (sales, inventory, quotations, transactions, membership review).
- Who can run each report and what data is scoped for officers vs admins.
- Report generation as a server-side API with proper authorization and predictable schema.
- Validation for CSV content, escaping, and line format across all report types.

Relevant files:
- `server/reportCsv.test.ts`
- `client/src/pages/Reports.tsx`
- `server/routers.ts`

## Phase 7 — Ratings, notifications, and customer communications

Status: PARTIAL

What exists now:
- Persistent in-app notification records, authorized retrieval/mark-read procedures, and an inbox/bell UI are implemented locally.
- Notification creation is included in several audited support, association, product-review, payment, and account-access operations.

What is not implemented or not verified:
- Buyer-to-seller rating flow after completion.
- Complete notification coverage for every order/quotation/chat/verification transition and user notification preferences.
- Email delivery with templates, throttling, dry-run mode, and retry behavior.
- Confirmation that no SMS flow is present and no false SMS assumptions are introduced.
- Hosted multi-instance delivery and Supabase Realtime validation.

Relevant files:
- `server/_core/notification.ts`
- `server/_core/systemRouter.ts`
- `server/routers.ts`
- client notification screens if present

## Phase 8 — Reference prices, pickup scheduling, and fulfillment details

Status: PARTIAL

What exists now:
- Local cancellation logic couples the eligible order, payment, attempt, transaction, and payment-event updates in a database transaction; verified payments cannot be cancelled until refunded.
- Inventory reservation and completion rules have local unit coverage, but not PostgreSQL concurrency verification.
- Sellers can set existing product inventory to zero; negative inventory is rejected. New listings still require positive starting stock.

What remains undone:
- Reference pricing model for commodity comparison.
- Pickup schedule creation and confirmation.
- Pick-up or handover assignment to cooperatives/sellers.
- Full staging validation of final delivered quantities, stock deductions, reservation release, and cancellation behavior.
- Application of the review-only PostgreSQL enum artifact required for the new cancellation state.

Relevant files:
- `drizzle/schema.ts`
- `server/routers.ts`
- `server/marketplaceRules.ts`
- order detail UI components

## Phase 9 — Seed data, demo environment, and role walkthroughs

Status: PARTIAL

What exists now:
- Demo accounts and seed logic were mentioned in prior repo review, but they are not a complete operational demo flow for all roles.

What remains undone:
- A complete, reproducible role-based demo dataset covering Buyer, Seller, Officer, and Admin roles.
- End-to-end demo flow for sign-up approval, listing, quotation, order, completion, and reporting.
- Role-specific walkthrough documentation that matches the actual current app behavior exactly.

Relevant files:
- `scripts/seed-demo.ts`
- `docs/ENVIRONMENT.md`
- `docs/PROJECT_SUMMARY.md`

## Phase 10 — Security, privacy, and deployment hardening

Status: PARTIAL / NEEDS REVIEW

What is still missing or weak:
- Stronger enforcement of identity document storage and access policy.
- Clear retention rules for ID/selfie and related personal data.
- Review of public storage bucket use versus private bucket separation.
- Review of signed URL generation and any exposure paths.
- Verification of private file handling and authorization checks beyond the current route implementation.
- Tight alignment between Supabase RLS/grants and the active PostgreSQL application schema.

Relevant files:
- `server/storage.ts`
- `server/clients.ts`
- `supabase/rls.sql` (if present)
- `server/routers.ts`
- `docs/PROJECT_SUMMARY.md`

## Phase 11 — Supabase Postgres migration planning and execution

Status: PARTIAL — LOCAL RUNTIME CONVERSION STARTED; DATABASE VALIDATION BLOCKED

The active server runtime and Drizzle config use PostgreSQL. `drizzle/pg-schema.ts` models the target PostgreSQL schema, including the `agricoop_app` application schema and canonical `public.profiles`/`public.roles` records. The legacy `drizzle/schema.ts`, MySQL migration SQL, and journal entries remain historical artifacts and must not be used for Supabase. No migration, seed, or database change was run.

Remaining work requires an explicitly authorized isolated environment:
- reconcile active PostgreSQL schema definitions and review-only SQL artifacts against a disposable/staging database
- validate exact verified identity mappings without guessing or email matching
- approve least-privilege grants, RLS and Storage policies
- exercise request-scoped roles, transactions, locks, and cross-cooperative isolation against PostgreSQL
- port or retire any remaining MySQL-only historical scripts without executing them against the target

Relevant files:
- `drizzle/schema.ts`
- `drizzle/*.sql`
- `drizzle.config.*` and database config files
- `docs/PROJECT_SUMMARY.md`

## Phase 12 — Manuscript and documentation alignment

Status: PARTIAL

The project summary and other docs still need a full evidence-based alignment to the delivered stack:
- Vite + React client
- Express + tRPC server
- PostgreSQL + Drizzle runtime; MySQL schema/migrations retained as historical artifacts
- Supabase Auth and Storage integration present in source but not staging-verified
- Role split and approval flow as actually enforced
- F2F-only payment and transaction model
- missing or partial features that are not yet claimed as done

Relevant files:
- `docs/PROJECT_SUMMARY.md`
- `MANUSCRIPT_COMPLIANCE.md`
- `docs/REVIEW_PACKAGE/*`
- README and project docs

## Immediate next execution order

1. Provide an isolated PostgreSQL/Supabase test environment with verified local credentials and representative fixtures.
2. Verify grants/RLS, Storage policies and the review-only SQL artifacts without using production.
3. Exercise buyer/seller/Admin/SuperAdmin browser workflows and cross-cooperative denial cases.
4. Validate order stock locking, payment/refund/cash state transitions, and cancellation persistence.
5. Complete identity verification, ratings, pickup scheduling, and remaining report coverage.
6. Add notification preferences and email delivery only after provider configuration and retry rules are approved.
7. Align manuscript/documentation claims to the validated implementation.

## Summary of what is still pending

The application has broad local marketplace and role-management implementation with unit tests, but it is not release-ready. The following deliverables remain incomplete or integration-blocked:
- user verification / ID and selfie workflow
- complete monitoring, audit and reporting coverage
- ratings and remaining reports/flags
- pickup/reference-price completion flow
- notification preferences, email delivery, and cross-instance realtime
- security/privacy hardening
- isolated Supabase PostgreSQL/RLS/Storage/Auth verification
- manuscript alignment and full documentation updates
