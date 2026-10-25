# AgriCoop implementation status

**Status reviewed:** 26 October 2026

This document describes the active Supabase/Vercel runtime. The historical Drizzle/MySQL schema and scripts remain in the repository for reference only and are not imported by the active tRPC router.

## Feature matrix

| Area                          | Status                              | Boundary                                                                                                                                                                                                                                             |
| ----------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public website and navigation | Functional                          | Home, About, marketplace, product details, Auth, activity, dashboard, reports, and support routes are present.                                                                                                                                       |
| Supabase Auth and `auth.me`   | Functional                          | The browser resolves the session at request time; the server maps Auth UUID → `profiles` → `roles` and never creates a legacy user.                                                                                                                  |
| Account profile               | Partial but safe                    | The live `profiles` table supports display name, email, role, approval status, and cooperative assignment. Contact/address and identity-verification fields are not present, so the UI does not pretend to save them.                                |
| Marketplace                   | Functional with empty state         | Reads live `products` and `inventory`, filters to approved seller profiles and public product statuses, supports category filtering and price sorting, and returns an empty listing when tables have no rows.                                        |
| Seller products/inventory     | Functional for live columns         | Sellers can create, edit, and archive products and write separate inventory rows. Variety, images, quality grade, and minimum-order fields are intentionally not submitted because the live table does not contain them.                             |
| Product moderation            | Partial                             | Cooperative Officers can activate/archive products in their cooperative. A separate pending/verification column is not present in the live products table.                                                                                           |
| Quotations                    | Functional for live columns         | Buyer requests, officer response/decline, buyer accept/decline, and accepted-quotation order checks use `quotations` and `quotation_items`. Notes are not collected because no note column exists.                                                   |
| Orders and transactions       | Functional with known limits        | Buyer order creation, officer status transitions, inventory checks, and transaction records match the live columns. Stock is not reserved at submission, and REST compensating writes are used because no database transaction RPC was supplied.     |
| Buyer activity                | Functional                          | Buyer/seller marketplace activity reads the live quotation and order tables and shows proper empty states.                                                                                                                                           |
| Seller dashboard              | Partial                             | Product and inventory maintenance works. Seller-facing quotation/order queues from the legacy schema are not shown because the live schema assigns quotation/order coordination to `officer_id` and has no seller ownership column on those headers. |
| Cooperative Officer dashboard | Functional for existing tables      | Member approval, product status, quotation decisions, order fulfillment, and inventory views are scoped by cooperative server-side.                                                                                                                  |
| System administration         | Partial but safe                    | Profile/account status administration and platform summaries work. The live schema has no `activity_logs` table, so activity history is explicitly empty.                                                                                            |
| CSV reports                   | Partial                             | Officer reports export live cooperative products, quotations, orders, and transactions. System-admin reports export available platform records and clearly label unsupported inventory/quotation detail.                                             |
| Support conversations         | Incomplete                          | The live Supabase schema exposes no conversation/message tables. The old MySQL support endpoints are disabled; the UI explains the missing schema instead of issuing HTTP 500s or creating fake records.                                             |
| Online payment                | Not implemented by design           | Transactions record face-to-face payment coordination/status only; no gateway is called.                                                                                                                                                             |
| Vercel deployment             | Locally prepared; remote unverified | `api/index.ts`, `vercel.json`, public/server environment boundaries, and local Vercel-path tests are in place. A preview deployment was not created by this repair.                                                                                  |

## Development data

The configured Supabase project currently has no `products`, `inventory`, `cooperatives`, quotation, order, or transaction rows. Use the guarded `corepack pnpm seed:supabase-demo` script only with `SUPABASE_SEED_ALLOW_WRITE=true`, `NODE_ENV=development`, and an existing approved `SUPABASE_DEV_SELLER_ID`. The script writes only labeled development products and inventory and never creates transactions or Auth users.

## Required future decisions

Before enabling support messaging, identity verification, product images, minimum-order rules, or richer seller workflows, approve a Supabase schema/RLS migration for those fields/tables. Do not apply the checked-in legacy `supabase/rls.sql` unchanged: it targets a different `users` schema and does not describe the live `profiles` tables.

## Verification scope

The automated suite covers Supabase profile mapping, bearer context resolution, request-time browser authorization headers, role/approval gates, marketplace rules, configuration, Vercel path handling, and CSV helpers. A live browser/E2E run against a disposable database and a remote Vercel preview remains a deployment-owner step.
