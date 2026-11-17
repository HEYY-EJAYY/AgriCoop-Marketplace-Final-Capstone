# AGRICOOP IMPLEMENTATION BLUEPRINT

Status legend:
- Verified: directly confirmed in the checked-in repository
- Proposed: designed to satisfy the project requirements without changing the current app implementation
- Approved decision: requirement explicitly approved by the project owner and now incorporated into this blueprint

This document records the approved architecture and verified implementation state. The repository has canonical payment tables and order-creation integration, plus a verified-payment completion gate and seller cash-receipt workflow. GCash evidence and review, payment QR configuration, refunds, a separate fulfillment model, and persistent notifications remain unimplemented unless explicitly marked otherwise below.

## 1. Executive architecture summary

The repository is already a cooperative marketplace prototype built on:

- React 19 + Vite + TypeScript
- Wouter
- Tailwind CSS 4
- TanStack Query
- Express + tRPC
- MySQL + Drizzle ORM
- Supabase Auth + Supabase Storage

Verified implementation details:

- Role model exists in [server/authz.ts](../server/authz.ts): `buyer`, `seller`, `admin`, `superadmin`
- Cooperative scoping exists via `users.cooperativeId` in [drizzle/schema.ts](../drizzle/schema.ts)
- Orders and order status transitions are implemented in [server/routers.ts](../server/routers.ts) and [server/marketplaceRules.ts](../server/marketplaceRules.ts)
- Cart is front-end state only in [client/src/pages/Marketplace.tsx](../client/src/pages/Marketplace.tsx)
- Messaging uses conversations + SSE in [server/realtime.ts](../server/realtime.ts) and [server/_core/index.ts](../server/_core/index.ts)
- Notification utility exists in [server/_core/notification.ts](../server/_core/notification.ts), but it is not a persistent inbox implementation

The key correction required by the project brief is this:

- A single payment status source of truth must be defined.
- Payment and fulfillment must be modeled independently.
- Manual QR verification must be explicit and authorized, not inferred from file upload alone.

## 2. Current verified architecture and actual responsibilities

### 2.1 Verified payment-related table usage

The existing schema in [drizzle/schema.ts](../drizzle/schema.ts) includes:

- `orders` with `paymentStatus`, `paymentMethod`, `totalCents`
- `transactions` with `orderId`, `buyerId`, `sellerId`, `amountCents`, `paymentReferenceNote`, `status`, `paymentMethod`, `completedAt`
- `orderEvents` for status change history
- Phase 1 `payments`, `paymentEvents`, and `paymentAttempts` tables

The order creation flow in [server/routers.ts](../server/routers.ts) creates these related records:

- `orders.create` inserts a row into `orders`
- it inserts the order items, one canonical payment, its initial payment event and attempt, and a legacy `transactions` row in one database transaction
- it sets `orders.paymentMethod = "f2f"` and `orders.paymentStatus = "F2F-pending-confirmation"`
- it sets `transactions.status = "payment_coordinated"`

The new `payments` row is the canonical payment record. The legacy `transactions` row is still maintained for compatibility and reporting, not as the authoritative payment status. Payment read and verification procedures are not implemented in Phase 1.

### 2.2 Clarified financial model

The requirement is to support both offline and online payment and to avoid duplicate financial records.

The correct long-term model is:

- `orders` = order intent and business transaction context
- `transactions` = legacy/bridge record currently used by the app and should remain as compatibility data until migration time
- `payments` = the canonical payment domain table for status, amount, method, and verification lifecycle
- `payment_attempts` = evidence submissions and online payment attempts
- `payment_events` = append-only status change history
- `refunds` = separate refund ledger, not duplicated into `payments` or `transactions`

Important restriction:
- Do not create duplicate financial records for the same order amount in both `payments` and `transactions` as active source-of-truth records.
- One canonical state must exist for payment status and amount. For the capstone, that canonical state is the order payment record in the new `payments` model; `transactions` can remain as a backward-compatible historical table while the migration is phased.

### 2.3 Payment source of truth decision

For architecture design, the source of truth should be:

- `orders.totalCents` = order amount
- `payments.amountCents` = expected payment total for that order
- `payments.status` = payment lifecycle status
- `payment_attempts` = evidence submissions and payment initiation attempts
- `payment_events` = immutable audit trail

The existing `transactions` table is retained for compatibility and historical reporting. New payment decisions must use `payments`; legacy status fields are not an independent authority.

## 3. Payment and transaction architecture

### 3.1 Existing verified responsibilities of `transactions`

From [drizzle/schema.ts](../drizzle/schema.ts):

- `transactions.orderId` links to order
- `transactions.buyerId`, `transactions.sellerId`
- `transactions.amountCents`
- `transactions.paymentReferenceNote`
- `transactions.status` (`recorded`, `payment_coordinated`, `pending`, `paid`, `failed`)
- `transactions.paymentMethod`
- `transactions.externalId`
- `transactions.completedAt`

This is not a full payment domain. The application still creates and updates this compatibility row, but the canonical payment lifecycle is now represented by `payments`.

### 3.2 Approved financial source of truth

Approved decision: there must be exactly one authoritative payment status and amount. The project owner approved the following rule:

- `orders` = order intent and order business context
- `payments` = authoritative payment record for the order, including amount, method, status, and verification lifecycle
- `payment_attempts` = buyer evidence submissions, payment submissions, and payment initiation attempts
- `payment_events` = append-only audit trail of payment state changes
- `refunds` = separate refund ledger linked to the original payment
- `transactions` = legacy compatibility table retained only for historical or migration compatibility; it must not become a second active financial source of truth

The authoritative source of truth must be:

- `orders.totalCents` = order total amount, as the business amount to settle
- `payments.amountCents` = the authoritative payment amount for the order
- `payments.status` = the authoritative payment lifecycle status
- `payment_events` = immutable event history for payment changes
- `refunds` = explicit refund records linked to the original payment, never a silent overwrite of the original financial record

This means `transactions` and `payments` must not both operate as active competing payment ledgers. The app may retain `transactions` for compatibility until the migration to the canonical `payments` model is complete, but the live business logic must use only one authoritative payment state.

### 3.3 Proposed domain relationships

The approved payment domain should be modeled as follows:

- `orders` has one payment lifecycle; not all order items are separate payment records
- `payments` is the authoritative payment record for that order
- `payment_attempts` are the discrete evidence or external payment submissions tied to a payment
- `payment_events` log each payment state change
- `refunds` are created only when there is a refund or cancellation settlement, not as a duplicate payment record

Approved relationship:

- one `orders` row -> one `payments` row
- one `payments` row -> many `payment_attempts`
- one `payments` row -> many `payment_events`
- one `payments` row -> zero or many `refunds`

The historical `transactions` table should not be treated as an alternate payment source of truth.

### 3.4 Phase 1 compatibility and integrity notes

Verified Phase 1 implementation:

- Legacy `recorded`, `payment_coordinated`, `pending`, and historical `paid` values map to canonical `pending`; a legacy `failed` value may map to `failed`. No historical state is promoted to `verified` because the existing code does not prove receipt of funds.
- Historical payment amounts are initialized from `orders.totalCents`. Legacy transaction rows and their values are preserved; their status, amount, and notes are retained in the backfill event metadata for review.
- A legacy `f2f` method is preserved as the generic method value. It does not imply cash, pickup, or delivery. The current order model has no fulfillment type, so the migration does not infer one.
- On order completion, a changed order amount is reconciled to `payments.amountCents` only while payment status is `pending`, in the same database transaction and with an `amount_adjusted` payment event. If payment is not pending, a changed total is rejected. Equal amounts do not require an adjustment.
- Payment events are appended by application code; the schema does not enforce database-level immutability. No payment-event update/delete procedure is introduced in Phase 1.

#### Demo seed safety

The demo seed uses stable, unique `orders.demoSeedKey` values rather than relying on buyer notes to identify orders. Legacy seeded orders may be adopted only when their order fields, item signature, demo account identity, and any existing compatibility transaction match the expected fixture. Existing transaction values are preserved; an unrecognized transaction causes the seed to stop instead of being normalized. New demo compatibility transactions are labeled `DEMO ONLY` and use `recorded`, not a received-payment status. Seeded canonical payments remain pending unless separately changed through an authorized workflow.

The order seed key's unique index prevents concurrent runs from creating duplicate demo orders. Order items, canonical payment, initial event, initial attempt, and compatibility transaction are reconciled in one transaction. Event and attempt repair is serialized by locking the order/payment rows; `(paymentId, attemptNumber)` remains uniquely constrained.

All seed scripts now require the explicit `AGRICOOP_SEED_TARGET=local` setting and reject `NODE_ENV=production`. This is a guardrail, not database-host verification; operators must independently confirm the configured target is local and disposable.

### 3.5 Manual and online payment support

Project requirement: both offline and online payment must be supported.

Approved combinations:

- Cash on pickup
- Cash on delivery
- Manual GCash QR before pickup
- Manual GCash QR before delivery
- Future online gateway payment

The approved payment architecture therefore uses a payment method type and a fulfillment type that are independent:

- `payment_method`: `cash`, `gcash_qr`, `gateway`
- `fulfillment_type`: `pickup`, `delivery`

Important approved rule:

- Payment receipt and fulfillment status are independent business states.
- Final order completion requires both fulfillment confirmation and payment confirmation.
- Cash-on-delivery does not mean payment is automatically confirmed at delivery; it means the cash receipt may be recorded by the seller after handoff, and the payment state remains pending until recorded.

### 3.5 Payment behavior by method

| Payment method | Verification model | Allowed before fulfillment? | Verified by |
|---|---|---|---|
| Cash on pickup | seller records cash receipt at pickup | yes | seller (standard) / admin for cooperative operational exceptions |
| Cash on delivery | seller records cash receipt at handoff or immediately after delivery | yes | seller (standard) / admin for cooperative operational exceptions |
| Manual GCash QR | buyer submits evidence; `admin` verifies within cooperative; `superadmin` has platform oversight | yes | `admin` and `superadmin` only |
| Future online gateway | server-side confirmation and webhook verification | yes | platform system / server verification |

This keeps payment and fulfillment independent while preserving the approved completion gate.

## 4. Approved payment and fulfillment combinations

The following combinations are approved and must be supported explicitly.

### 4.1 Cash on pickup

- buyer creates order
- seller confirms the order
- fulfillment is scheduled as pickup
- buyer pays in cash at pickup
- seller records the cash receipt with acting user, timestamp, order, amount, and payment reference where applicable
- order may remain in payment pending and fulfillment pending until both are confirmed
- final order completion requires confirmed pickup and confirmed payment

### 4.2 Cash on delivery

- buyer creates order
- seller confirms the order
- fulfillment is scheduled as delivery
- buyer pays in cash at handoff or immediately after delivery
- seller records the cash receipt with acting user, timestamp, order, amount, and payment reference where applicable
- payment status remains independent from fulfillment status
- delivery can be performed, but the order is not completed until both fulfillment and payment are confirmed

### 4.3 Manual GCash QR before pickup

- buyer submits QR screenshot or payment reference
- payment attempt is stored with `status = pending_verification`
- `admin` verifies the payment within the assigned cooperative
- `superadmin` may provide platform-wide oversight and administrative authority
- sellers cannot verify QR payments
- buyers cannot verify their own payments
- payoff, payment verification, and fulfillment remain independent states until the order reaches the final completion gate

### 4.4 Manual GCash QR before delivery

- same logic as above, but with `fulfillment_type = delivery`
- the delivery schedule can proceed after the cooperative policy allows it, but completion is still gated by final payment confirmation
- the status remains independent from fulfillment state

### 4.5 Future online gateway

- buyer initiates payment through a gateway integration
- server verifies callback or signed response
- payment is recorded only after trusted server-side confirmation
- duplicate callbacks are ignored using idempotency keys
- no business state should be changed from client-supplied values alone
- this is extensible and future-facing but not required for the capstone MVP

### 4.6 Completion gate principle

Approved rule:

- `orders.status` is the order lifecycle
- `payments.status` is the authoritative payment lifecycle
- `fulfillment.status` is a separate fulfillment lifecycle
- An order cannot reach `completed` until both fulfillment is confirmed and payment is confirmed

Examples:

- `fulfillment.status = "completed"` without `payments.status = "verified"` does not permit the order to be marked `completed`
- `payments.status = "verified"` without a finalized fulfillment record does not allow the order to be marked `completed`
- payment state and fulfillment state are independent, but final completion is a combined business gate

## 5. Correct authorization rules

The existing app already preserves the main role model and cooperative scope in [server/authz.ts](../server/authz.ts):

- `buyer` = buyer/customer
- `seller` = seller/farm account
- `admin` = cooperative-scoped admin/officer
- `superadmin` = platform-wide admin

The blueprint must not give `superadmin` implicit buyer or seller privileges. `superadmin` is a separate platform authority and must be treated as such.

### 5.1 Role-by-role permissions

| Action | Buyer | Seller | Admin | Superadmin |
|---|---|---|---|---|
| Place order | Yes | Yes if approved seller/role context | No | Yes |
| View own orders | Yes | Yes | Yes if cooperative-scoped | Yes |
| Manage own products | No | Yes | No | Yes |
| Upload QR configuration | No | No | Yes for own cooperative | Yes |
| Replace/deactivate QR code | No | No | Yes for own cooperative | Yes |
| View payment evidence | Yes for own order | Yes for own order | Yes for own cooperative | Yes |
| Verify QR payments | No | No | Yes for own cooperative | Yes |
| Record cash receipt | No | Yes for own order | Yes for cooperative operations if policy allows | Yes |
| Issue refund | No | No | Yes if cooperative policy allows | Yes |
| Access cooperative payment information | No | No | Yes for own cooperative | Yes |
| Access platform-wide payment data | No | No | No | Yes |

### 5.2 Mandatory authorization rules

Approved rules:

- Only `admin` and `superadmin` may upload or manage QR configurations.
- Only `admin` and `superadmin` may verify QR payment evidence.
- Sellers cannot verify QR payments.
- Buyers cannot verify their own payments.
- The seller records cash receipt for both pickup and delivery, with acting user, timestamp, order, amount, and payment reference where applicable.
- Approval and audit history for refunds, payment verification, and cash receipts must be stored in the audit trail and never silently overwritten.
- Payment access, refund access, QR configuration access, and coop-scoped order access must be enforced on the server; client UI must never be the only authorization layer.

### 5.3 Role enforcement source

The role enforcement should remain in the backend helper layer in [server/authz.ts](../server/authz.ts). This is important because the current app explicitly centralizes access logic there.

## 6. Fulfillment state machine and roles

The current code has no separate fulfillment table in [drizzle/schema.ts](../drizzle/schema.ts). The approved fulfillment table should be explicit and consistent.

### 6.1 Proposed fulfillment table

Fields should include:

- `id`
- `orderId` unique
- `fulfillmentType` (`pickup` or `delivery`)
- `status`
- `pickupLocation` nullable
- `pickupScheduledAt` nullable
- `deliveryAddress` nullable
- `deliveryContactName` nullable
- `deliveryContactNumber` nullable
- `deliveryInstructions` nullable
- `deliveryFeeCents` default 0
- `createdByUserId`
- `assignedToUserId` nullable
- `createdAt`, `updatedAt`, `completedAt`

### 6.2 Fulfillment status enum

Approved enum:

- `pending`
- `scheduled`
- `confirmed`
- `in_transit`
- `ready_for_handover`
- `completed`
- `cancelled`

This should be distinct from both order and payment states.

### 6.3 Pickup transitions

```text
pending -> scheduled -> confirmed -> ready_for_handover -> completed
      \-> cancelled
```

Roles allowed to perform each transition:

- buyer: may request pickup details or choose pickup option, but cannot complete pickup alone
- seller: may schedule pickup, confirm pickup readiness, and mark handoff complete when the buyer receives the order
- admin: may coordinate pickup arrangement and resolve operational issues within cooperative scope
- superadmin: may manage platform-level overrides and exception handling

### 6.4 Delivery transitions

```text
pending -> scheduled -> confirmed -> in_transit -> ready_for_handover -> completed
      \-> cancelled
```

Roles allowed to perform each transition:

- buyer: may provide delivery address and instructions; cannot mark delivery complete by themselves
- seller: may schedule and confirm delivery preparation and handoff completion
- admin: may coordinate with buyer and seller and handle cooperative-level issue resolution
- superadmin: platform override for operational exceptions

### 6.5 Final completion gate

Approved rule: the order can only become `completed` when:

1. the fulfillment status is `completed` or equivalent final confirmation state
2. the payment status has been confirmed as received or verified
3. all required audit fields are recorded

This prevents a seller from marking an order as complete while cash payment or QR verification remains unconfirmed.

### 6.6 Fulfillment and payment independence

Payment and fulfillment remain independent business states, but final order completion is a combined gate. Examples:

- `fulfillment.status = "completed"` while `payments.status = "pending_verification"` does not satisfy the completion rule
- `payments.status = "verified"` while `fulfillment.status = "scheduled"` does not satisfy the completion rule
- `orders.status` remains the business-level aggregate, not a replacement for payment or fulfillment state

## 7. Inventory and order integrity

### 7.1 Current verified limitation

The current product stock model is scalar and checked in [server/marketplaceRules.ts](../server/marketplaceRules.ts). The schema in [drizzle/schema.ts](../drizzle/schema.ts) has no reservation table or stock movement table.

This means the app already enforces some validation, but under concurrent requests it is vulnerable to overselling because there is no reservation ledger or atomic stock reservation model.

### 7.2 Capstone MVP requirement

Approved decision: server-side stock validation and atomic inventory updates are mandatory in the capstone MVP.

Required capstone behavior:

- validate order quantity against current product stock on the server in a transaction
- lock the relevant product row or use an atomic update pattern before updating inventory
- prevent negative inventory, duplicate deductions, and concurrent overselling
- ensure retries and duplicate submissions do not double-deduct stock
- log inventory movement with orderId, productId, quantity, reason, and acting user for traceability

### 7.3 Cancellation and completion impact on stock

Approved rules:

- order creation must not permanently reduce stock by itself in the MVP unless the business intentionally reserves inventory
- stock deduction must happen within a transaction at the point the order is confirmed or finalized according to the business policy
- cancelled orders must release reserved stock or avoid deduction if no stock was taken
- a completed order must not be double-counted when stock has already been deducted
- a cancellation after completion should only reverse stock when explicitly permitted by policy and logged as an inventory adjustment

### 7.4 Recommended MVP stock protection

For the capstone, use:

- transaction-based stock check at order confirmation or completion boundary
- validation that `stockQty >= requestedQty` before final stock reduction
- atomic update logic or row locking to avoid race conditions
- an `inventory_movements` table or equivalent movement ledger if the team wants a full audit history

This is the minimum practical protection that remains compatible with the existing app without redesigning the whole stack.

## 8. Persistent notifications

The current repo contains a notification utility in [server/_core/notification.ts](../server/_core/notification.ts), but no persistent notification table in [drizzle/schema.ts](../drizzle/schema.ts).

### 8.1 Approved capstone MVP notification scope

Approved decision: persistent in-app notifications are mandatory in the capstone MVP.

The MVP must include notifications for:

- new orders
- order status changes
- payment submission and payment verification outcomes
- pickup and delivery updates
- refund events
- new messages relevant to the order or conversation
- approval and rejection events for cooperative policies

These notifications should be delivered as:

- persistent in-app notification entries
- immediate UI toast feedback when the event occurs
- access-controlled recipients only

### 8.2 Production notification scope

Production should add:

- notification read state and history retention policy
- email/SMS or push channel abstraction
- escalation workflows for admin approvals
- advanced notification preference settings

### 8.3 Approved split

| Notification type | Capstone MVP | Production |
|---|---|---|
| New order | Yes | Yes |
| Order status change | Yes | Yes |
| Payment submission | Yes | Yes |
| Payment verification | Yes | Yes |
| Pickup/delivery update | Yes | Yes |
| Refund update | Yes | Yes |
| New messages | Yes | Yes |
| Persistent notification history | Yes | Yes |
| Read receipts / detailed read-state sync | No (deferred) | Yes |
| Email/SMS push | No | Yes |
| Admin escalation | No | Yes |

### 8.4 Message read state

Approved decision: advanced message read receipts and detailed read-state synchronization are deferred to production. The current application may retain the basic conversation and messaging functionality already present, but not a production-grade read-state system yet.

## 9. End-to-end acceptance criteria

### 9.1 Buyer paying cash on pickup

1. Buyer creates order.
2. Seller confirms the order.
3. Pickup fulfillment is scheduled.
4. Buyer pays cash at pickup.
5. Seller records the cash receipt with acting user, timestamp, order, amount, and payment reference where applicable.
6. Payment state updates to a verified/received status only after seller recording is completed.
7. Pickup is marked complete.
8. The order cannot become `completed` until both payment and fulfillment are confirmed.

### 9.2 Buyer paying cash on delivery

1. Buyer creates order.
2. Seller confirms order and schedules delivery.
3. Delivery is performed.
4. Buyer pays cash at handoff or immediately after delivery.
5. Seller records the cash receipt with acting user, timestamp, order, amount, and payment reference where applicable.
6. Payment state becomes verified/received after the seller records the receipt.
7. The order remains in a valid delivery state until the payment record is confirmed.
8. Final completion is allowed only after payment verification and fulfillment completion are both satisfied.

### 9.3 Buyer submitting GCash QR evidence

1. Buyer selects GCash QR payment method.
2. Buyer uploads screenshot and payment reference details.
3. Payment attempt is created with `status = pending_verification`.
4. `admin` reviews the evidence within the assigned cooperative and verifies it.
5. `superadmin` may exercise oversight or platform-level exception handling.
6. `payments.status` changes to `verified` only after authorized verification.
7. Acceptance: evidence upload alone does not convert payment into a verified state.

### 9.4 Buyer using future gateway payment

1. Buyer initiates payment via a future gateway integration.
2. Server stores payment attempt and idempotency key.
3. Gateway callback or verification response is processed on the server.
4. Duplicate callback is ignored.
5. `payments.status` becomes verified only after trusted server-side confirmation.
6. Acceptance: no client-only confirmation is trusted.

### 9.5 Seller processing an order

1. Seller sees the order in their workspace.
2. Seller confirms the order and chooses fulfillment method.
3. Seller updates the fulfillment schedule.
4. Seller records cash receipt for cash orders or fulfills the required cooperative payment workflow for QR orders.
5. Seller marks the handoff complete only after the physical fulfillment is complete and payment requirements are satisfied.
6. Acceptance: seller cannot verify QR payment on behalf of the cooperative.

### 9.6 Officer verifying payments and managing QR configuration

1. `admin` logs in with a cooperative-scoped account.
2. `admin` sees payment evidence and QR configuration for their assigned cooperative only.
3. `admin` verifies GCash QR payment and updates QR configuration within their scope.
4. `admin` may replace or deactivate QR codes when required.
5. Acceptance: `admin` cannot access another cooperative’s payment evidence or QR configuration.

### 9.7 System Admin managing platform settings

1. `superadmin` logs in.
2. `superadmin` reviews platform-wide payment configuration, order issues, and cooperative-level verification queues.
3. `superadmin` resolves platform-level exceptions and applies system-wide settings.
4. Acceptance: `superadmin` remains a platform authority and is not automatically granted buyer or seller privileges.

## 10. Final consistency review

This section confirms the blueprint remains internally aligned.

### 10.1 Verified existing behavior

- Role model in [server/authz.ts](../server/authz.ts): buyer, seller, admin, superadmin
- Cooperative scoping via `users.cooperativeId` in [drizzle/schema.ts](../drizzle/schema.ts)
- Order lifecycle in [server/marketplaceRules.ts](../server/marketplaceRules.ts)
- `orders.create` creates `transactions` rows in [server/routers.ts](../server/routers.ts)
- `orders.create` also creates one canonical payment and its initial attempt; new orders explicitly select cash pickup or cash delivery in [server/routers.ts](../server/routers.ts) and [client/src/pages/Marketplace.tsx](../client/src/pages/Marketplace.tsx)
- Order completion requires a verified canonical payment; sellers can record cash receipt only for their own ready orders using cash pickup or cash delivery in [server/routers.ts](../server/routers.ts)
- Accepted-quotation checkout exposes the same cash payment-method choice in [client/src/pages/Dashboard.tsx](../client/src/pages/Dashboard.tsx)
- `conversations` and SSE message streaming exist in [server/realtime.ts](../server/realtime.ts) and [server/_core/index.ts](../server/_core/index.ts)
- Notification utility exists in [server/_core/notification.ts](../server/_core/notification.ts)

### 10.2 Approved architectural decisions

- `admin` verifies GCash QR payments within their assigned cooperative
- `superadmin` has platform-wide oversight and administrative authority
- sellers cannot verify QR payments
- buyers cannot verify their own payments
- seller records cash receipt for both pickup and delivery
- final order completion requires payment confirmation and fulfillment confirmation
- refund architecture uses a separate refund table/record linked to the original payment and preserves original payment history
- persistent in-app notifications are part of the capstone MVP
- advanced read receipts are deferred to production
- future gateway integration is planned but not a capstone MVP dependence

### 10.3 Remaining genuine technical uncertainties

These are implementation details rather than open business approval questions:

1. Whether the team implements stock movement tracking as a dedicated `inventory_movements` table or as a lighter stock-adjustment ledger in the capstone MVP.
2. Whether payment, fulfillment, and order event tables are named exactly as the final migration plan chooses, as long as the architecture and source-of-truth rules remain consistent.
3. Whether the real-time messaging system is extended beyond the current SSE event pattern during the capstone or left as-is for production enhancements.

## 11. Summary of corrections made

This revision incorporates the approved project decisions by:

- clarifying the exact role of the existing `transactions` record versus the authoritative `payments` record
- enforcing a single payment source of truth and preventing competing financial records
- making QR verification explicitly cooperative-admin-scoped and prohibiting seller/self-verification
- requiring seller cash receipt recording for both pickup and delivery
- enforcing the completion gate: payment confirmed + fulfillment confirmed before order completion
- separating refund history from original payment history without overwriting financial records
- mandating persistent in-app notifications in the capstone MVP
- deferring advanced message read-state implementation to production
- aligning the acceptance criteria and role matrix with the approved requirements
- removing the unresolved business decisions that were already approved by the project owner

## 12. Final note

The verified implementation establishes canonical payment records, conservative legacy mapping, transactional order creation, and payment-amount reconciliation for pending payments. It also blocks order completion until payment is verified, supports seller recording of cash receipt for eligible ready orders, and exposes payment records within buyer, seller, and cooperative-admin scopes. GCash evidence submission and verification, QR configuration, refunds, a separate fulfillment state model, persistent notifications, and PostgreSQL runtime conversion remain unimplemented. No live Supabase database was accessed or changed.
