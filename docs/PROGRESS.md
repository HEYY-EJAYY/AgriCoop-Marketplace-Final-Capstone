# Autonomous Run Progress

## Stage 0 — Tighten registration tests

**Status:** DONE

- **Files changed:** `server/registration.test.ts`, `docs/PROGRESS.md`
- **Tests added:** An active existing account's duplicate signup returns the generic success response and does not expose the inactive-account message.
- **Fix summary:** The registration DB mock now recognizes only the `deletedAt IS NOT NULL` predicate. Registration test contexts use unique default IPs so the production rate limiter cannot make test outcomes depend on test order.
- **Verified:** Node 22.23.5; `pnpm exec vitest run server/registration.test.ts` (22 passed); `pnpm check`; `pnpm test` (411 passed, 11 skipped); `pnpm build` (passed).
- **Not verified:** The 11 real-database tests were skipped because they require the CI/Postgres harness. The production database and live signup flow were not touched.
- **Manual action:** None for this stage.

## Remaining stages

## Stage 1 — B1/B2: shared purchase eligibility

**Status:** PARTIAL

- **Files changed:** `server/marketplaceRules.ts`, `server/marketplaceRules.test.ts`, `server/db.ts`, `server/cart.ts`, `server/cart.test.ts`, `server/routers.ts`, `shared/paymentMethods.ts`, `server/checkoutCart.test.ts`, `client/src/pages/Checkout.tsx`, `docs/PROGRESS.md`
- **Tests added:** Shared purchase-rule cases for product, seller, stock/minimum, and fulfillment eligibility; checkout availability/reason cases.
- **Fix summary:** Added a common server-side purchase block reason used by marketplace listing/detail, cart loading/addition/cleanup, checkout, and quotation request paths. Listing/detail and cart calculations now account for open-order reservations and minimum stock. Soft-deleted or unapproved sellers block purchase; cooperative deletion remains irrelevant. Checkout now shows all payment methods, disabling unavailable radios with a visible and associated reason, and blocks submission if a selected method becomes unavailable.
- **Filter mismatches found:** Previously, listing omitted stock-after-reservations/minimum checks and seller soft-deletion; detail omitted stock/minimum and seller soft-deletion; cart used raw stock and did not verify seller eligibility; checkout and quotation checked only a subset of listing fields. Pickup/delivery schema defaults are `true`; online defaults `false`. Existing migration adds these columns with defaults, so no data-fix SQL was warranted. `acceptsOnlinePayment` is explicitly deprecated and ignored by the payment-method helper; online availability is controlled by system settings and an active platform account.
- **Verified:** Node 22.23.5; targeted marketplace/cart/checkout tests (36 passed); `pnpm check`; `pnpm test` (413 passed, 11 skipped); `pnpm build` (passed).
- **Not verified:** The 11 real-database tests remain skipped; no production database, Supabase settings, or live user journey was accessed. The requested end-to-end invariant test proving every marketplace result through cart, checkout, and quotation mutations is not yet present.
- **Manual action:** None for this stage. No migration/data update was generated.

Stages 2–8 have not been implemented or verified yet.
