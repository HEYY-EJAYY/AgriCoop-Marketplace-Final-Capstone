# Remaining phases and unfinished work

This document records the work that is still pending after the current repo state and the phase work already completed on `manus-phases`. It is intentionally independent from the implementation notes in chat so that a future developer can pick it up without relying on memory.

## Current status snapshot

Completed in the current branch:
- Phase 1: Manila timezone/date handling was centralized in `client/src/lib/datetime.ts` and applied to dashboard/report/support views.
- Phase 2: order review and cooperative-scoped admin visibility were added via `server/authz.ts`, `server/db.ts`, and `server/routers.ts`.
- The project summary was written to `docs/PROJECT_SUMMARY.md`.
- The repo passes the project validation commands as of the latest run: `corepack pnpm check` and `corepack pnpm test`.

Not complete: the remaining market and governance phases below are still undone or only partially implemented.

## Phase 3 — Profile and verification workflow

Status: PARTIAL / NOT DONE

What is implemented now:
- `users` schema already includes verification columns in `drizzle/schema.ts` (`verificationStatus`, `verificationNote`, `verifiedBy`, `profileImageUrl`, `birthdate`, `phone`).
- `account.updateProfile` exists in `server/routers.ts`, but it only updates role, cooperative, contact number, and address.
- A minimal server-side verification submission API was added in this step to accept identity information and push verification into a pending state.

What is still not complete:
- Front-end profile page for uploading ID/selfie and saving a verification submission.
- Formal verification gating before seller/admin marketplace activity.
- Admin/Officer review workflow for identity approval and rejection.
- UI states for rejected, pending, and approved verification.
- Consent text and retention handling for ID/selfie data.
- Real document storage rules, signed URL generation, and checks for private/public bucket policy.

Relevant files:
- `drizzle/schema.ts`
- `server/routers.ts`
- `server/authz.ts`
- `client/src/pages/Dashboard.tsx` and related profile routes if present

## Phase 4 — Monitoring, suspension, and audit controls

Status: PARTIAL

What is now in place:
- Suspension is enforced centrally in `server/authz.ts`: suspended non-superadmin accounts are denied operational access, even when their role is otherwise valid.
- `getAdminOverview()` and `getOfficerOverview()` already surface member, product, order, quotation, and transaction rows so admin/officer monitoring is structurally present.
- `orderEvents` in `drizzle/schema.ts` provides a minimal audit trail for order status changes.

What is still missing:
- A complete cooperative officer monitoring dashboard with member, product, order, and transaction visibility scoped to an officer's cooperative.
- A formal user suspension UI and notification flow for buyers, sellers, or officers.
- Flagging/reporting flow for bad listings, suspicious behavior, or policy violations.
- A complete audit-log capture layer for role changes, product review, order transitions, and verification decisions.
- Admin actions that are consistently logged and visible in a queryable report.

Relevant files:
- `server/db.ts`
- `server/routers.ts`
- `server/authz.ts`
- `drizzle/schema.ts` (there is a basic order event trail, but no full audit table or reporting layer)

## Phase 5 — Support conversations and chat features

Status: PARTIAL

What exists now:
- Generic support threads and text message storage are implemented in `server/routers.ts` and `drizzle/schema.ts`.
- The client support page (`client/src/pages/Support.tsx`) renders conversations.
- SSE-style realtime updates are wired via `server/realtime.ts`.

What remains undone:
- Three-party conversation rules beyond basic buyer/seller support threads.
- Message types beyond plain text (image, location, system notice, deleted/hidden messages).
- Delete/hide/archive semantics on a message or conversation.
- Conversation role logic for officer, admin, and superadmin visibility without leaking data.
- Realtime behavior validation in second-browser-window testing.

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

Status: NOT DONE

What is not implemented:
- Buyer-to-seller rating flow after completion.
- Notification dispatch model for order changes, quotation updates, chat messages, and verification review.
- In-app notification preferences and unread counts.
- Email delivery with templates, throttling, dry-run mode, and retry behavior.
- Confirmation that no SMS flow is present and no false SMS assumptions are introduced.

Relevant files:
- `server/_core/notification.ts`
- `server/_core/systemRouter.ts`
- `server/routers.ts`
- client notification screens if present

## Phase 8 — Reference prices, pickup scheduling, and fulfillment details

Status: NOT DONE

What remains undone:
- Reference pricing model for commodity comparison.
- Pickup schedule creation and confirmation.
- Pick-up or handover assignment to cooperatives/sellers.
- Final confirmation workflow with editable deducted quantities and cancellation states.
- Inventory deduction logic or reconciliation at the exact point of completion or seller confirmation.

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
- Tight alignment between Supabase RLS design and the live MySQL app logic.

Relevant files:
- `server/storage.ts`
- `server/clients.ts`
- `supabase/rls.sql` (if present)
- `server/routers.ts`
- `docs/PROJECT_SUMMARY.md`

## Phase 11 — Supabase Postgres migration planning and execution

Status: NOT DONE

This is a major architectural change and is specifically not part of the current application code path. The repo still depends on MySQL-oriented Drizzle patterns, MySQL enum usage, and MySQL auto-increment defaults. Migration work would require:
- driver and config changes from `mysql2` to `postgres`
- schema conversion for MySQL-only features and default semantics
- mapping app users to Supabase Auth users
- RLS policy design and enablement
- seed migration differences for Postgres data types and constraints
- risk review for case sensitivity, JSON columns, and ON UPDATE semantics

Relevant files:
- `drizzle/schema.ts`
- `drizzle/*.sql`
- `drizzle.config.*` and database config files
- `docs/PROJECT_SUMMARY.md`

## Phase 12 — Manuscript and documentation alignment

Status: NOT DONE

The code does not completely match the manuscript’s relationship between Vercel/Supabase and the delivered stack. The project summary and other docs need to be aligned to what is actually implemented:
- Vite + React client
- Express + tRPC server
- MySQL + Drizzle database
- Supabase Auth + Storage used in parallel with the app engine
- Role split and approval flow as actually enforced
- F2F-only payment and transaction model
- missing or partial features that are not yet claimed as done

Relevant files:
- `docs/PROJECT_SUMMARY.md`
- `MANUSCRIPT_COMPLIANCE.md`
- `docs/REVIEW_PACKAGE/*`
- README and project docs

## Immediate next execution order

If the branch continues after this state, the most defensible order is:
1. Complete the verification workflow and admin review flow.
2. Add enforcement and UI for seller/admin identity gating.
3. Add monitoring, suspension, and audit-log hooks.
4. Implement ratings and notifications.
5. Add reference prices and pickup scheduling.
6. Finish CSV/report API coverage.
7. Then address email templates, throttling, and dry-run mode.
8. Only after the operational features are stable, handle Supabase/Postgres migration and manuscript updates.

## Summary of what is still pending

The core platform is already functional for marketplace flows, role approvals, order management, and date formatting, but the following major deliverables remain incomplete or partially implemented:
- user verification / ID and selfie workflow
- monitoring and suspension
- reports and flags
- ratings and notifications
- pickup/reference-price completion flow
- email and notification infrastructure
- security/privacy hardening
- migration to Supabase Postgres
- manuscript alignment and full documentation updates
