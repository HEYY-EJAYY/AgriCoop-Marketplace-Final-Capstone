# Autonomous Run Progress

## Stage 0 — Tighten registration tests

**Status:** DONE

- **Files changed:** `server/registration.test.ts`, `docs/PROGRESS.md`
- **Tests added:** An active existing account's duplicate signup returns the generic success response and does not expose the inactive-account message.
- **Fix summary:** The registration DB mock now recognizes only the `deletedAt IS NOT NULL` predicate. Registration test contexts use unique default IPs so the production rate limiter cannot make test outcomes depend on test order.
- **Verified:** Node 22.23.5; `pnpm exec vitest run server/registration.test.ts` (22 passed); `pnpm check`; `pnpm test` (411 passed, 11 skipped); `pnpm build` (passed).
- **Not verified:** The 11 real-database tests were skipped because they require the CI/Postgres harness. The production database and live signup flow were not touched.
- **Manual action:** None for this stage.

## Stage 1 — B1/B2: shared purchase eligibility

**Status:** PARTIAL

- **Files changed:** `server/marketplaceRules.ts`, `server/marketplaceRules.test.ts`, `server/db.ts`, `server/cart.ts`, `server/cart.test.ts`, `server/routers.ts`, `shared/paymentMethods.ts`, `server/checkoutCart.test.ts`, `client/src/pages/Checkout.tsx`, `docs/PROGRESS.md`
- **Tests added:** Shared purchase-rule cases for product, seller, stock/minimum, and fulfillment eligibility; checkout availability/reason cases.
- **Fix summary:** Added a common server-side purchase block reason used by marketplace listing/detail, cart loading/addition/cleanup, checkout, and quotation request paths. Listing/detail and cart calculations now account for open-order reservations and minimum stock. Soft-deleted or unapproved sellers block purchase; cooperative deletion remains irrelevant. Checkout now shows all payment methods, disabling unavailable radios with a visible and associated reason, and blocks submission if a selected method becomes unavailable.
- **Filter mismatches found:** Previously, listing omitted stock-after-reservations/minimum checks and seller soft-deletion; detail omitted stock/minimum and seller soft-deletion; cart used raw stock and did not verify seller eligibility; checkout and quotation checked only a subset of listing fields. Pickup/delivery schema defaults are `true`; online defaults `false`. Existing migration adds these columns with defaults, so no data-fix SQL was warranted. `acceptsOnlinePayment` is explicitly deprecated and ignored by the payment-method helper; online availability is controlled by system settings and an active platform account.
- **Verified:** Node 22.23.5; targeted marketplace/cart/checkout tests (36 passed); `pnpm check`; `pnpm test` (413 passed, 11 skipped); `pnpm build` (passed).
- **Not verified:** The 11 real-database tests remain skipped; no production database, Supabase settings, or live user journey was accessed. The mocked cross-procedure invariant coverage was added in Stage 2b; live reproduction remains unverified.
- **Manual action:** None for this stage. No migration/data update was generated.

## Stage 2 — B3/B4/B5/B11: deletion and mutation errors

**Status:** PARTIAL

- **Files changed:** `server/part2Routers.ts`, `server/db.ts`, `server/orderArchive.ts`, `server/orderArchive.test.ts`, `server/part2SecurityProofs.test.ts`, `server/routers.ts`, `server/adminUserDelete.test.ts`, `server/_core/trpc.ts`, `shared/userFacingErrors.ts`, `shared/userFacingErrors.test.ts`, `client/src/pages/Activity.tsx`, `docs/PROGRESS.md`
- **Tests added/updated:** Regression cases prove seller order and quotation deletion use channels allowed by the existing CHECK constraint; admin user deletion does not delete owner-only cart rows and does not report success if Auth ban fails; mutation SQL errors map to action-specific messages with reference codes. The order-view security assertion now verifies buyer/seller `userId` scoping after sharing the allowed `order` channel.
- **Fix summary:** `seller_order` and `quotation` were invalid values under `thread_states_channel_check`; per-user seller order states now use `order`, and quotation states use the allowed `support` bucket. Admin deletion no longer attempts to delete another user's cart rows under the owner-only RLS policy; it retains those rows while soft-deleting the account/listings. Auth ban/unban API errors are no longer ignored. Buyers can multi-select, delete, and restore orders/quotations in a Deleted view; in-progress orders show the requested warning. tRPC query failures retain the load message; mutation failures now receive action-specific wording and a short logged reference code.
- **Grant/constraint review:** `cartItems` grants and RLS allow deletion only by the row owner, explaining the Admin delete failure. User tombstone column grants exist in `20261118190000_user_soft_delete_columns.sql`; staff update policy is in `20261117131000_marketplace_rls_grants.sql`. The existing order-channel expansion is in `20261118121000_buyer_order_archive_channel.sql`. No new migration was created.
- **Verified:** Node 22.23.5; targeted delete/error tests; `pnpm check`; `pnpm test` (418 passed, 11 skipped); `pnpm build` (passed).
- **Not verified:** No live Supabase migration catalog, RLS policy, Auth ban, or browser flow was accessed. The 11 real-database tests remain skipped. This confirms code behavior against mocks, not that the live project has applied the prerequisite migrations.
- **Manual action:** Before live testing, verify the live project has applied the existing order-channel and user-soft-delete migrations above; do not infer migration state from local files.

## Stage 2b — F1/F2/F3: archive channel collision, purchase invariant, router duplicate

**Status:** PARTIAL

- **Files changed:** `server/part2Routers.ts`, `server/db.ts`, `server/orderArchive.test.ts`, `server/part2SecurityProofs.test.ts`, `server/purchaseInvariant.test.ts`, `server/checkoutCart.test.ts`, `supabase/migrations/20261118210000_thread_state_dedicated_archive_channels.sql`, `docs/MANUAL_SQL.md`, `docs/PROGRESS.md`
- **F1 correction:** Stage 2 changed the seller-order assertion in `server/part2SecurityProofs.test.ts` from channel `seller_order` to `order` and added a buyer-channel `order` assertion. Stage 2b restores the seller's `userId = sellerId` + `seller_order` assertion and explicitly rejects seller `order`; buyer order views continue to use `order`. Quotation state writes/reads now use dedicated `quotation`, not `support`, preventing unrelated support thread IDs from colliding. The new migration preserves the current CHECK predicate and adds both dedicated values, retaining all four locally defined values and any additional live values. A read-only catalog preview and exact migration block are in `docs/MANUAL_SQL.md` BLOCK 31.
- **F2 coverage:** `server/purchaseInvariant.test.ts` calls the actual `marketplace.list`, then exercises every returned product through `cart.add`, `orders.create`, and `quotations.request` with a mocked database. `server/checkoutCart.test.ts` now checks a user-facing disabled reason for pickup, delivery, and online.
- **F3 finding:** Runtime imports use `server/routers.ts` (including `server/_core/app.ts` and `server/_core/index.ts`). No source imports `server/routers.fixed.ts`; only `server/nestedDatabaseScope.test.ts` reads it as a static audit fixture. It was not deleted or changed.
- **Test rationale:** The Stage 2 security proof was updated because sharing `order` between buyer and seller could make a seller's state hide the buyer's order. Stage 2b restores the dedicated seller channel after adding the necessary additive constraint migration.
- **Verified:** Node 22.23.5; focused Stage 2b tests; `pnpm check`; `pnpm test` (419 passed, 11 skipped); `pnpm build` (passed; existing >500 KB chunk warning).
- **Not verified:** The migration was not executed and live constraint contents were not queried. The 11 Postgres harness tests remain CI-only; no Supabase/production access was used.
- **Manual action:** Run the BLOCK 31 read-only preview in `docs/MANUAL_SQL.md`; confirm it lists the four expected current channels, then apply `20261118210000_thread_state_dedicated_archive_channels.sql`. Stop and reconcile if live constraint contents differ.

Stages 3–8 have not been implemented or verified yet.
