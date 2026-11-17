# BACKEND_AND_FUNCTIONALITY_AUDIT — Historical Baseline

> This audit predates the PostgreSQL runtime conversion. Its MySQL descriptions below are historical and are not the current runtime configuration. Current status: the runtime uses `postgres-js` with request-scoped identity, but authenticated access is blocked by the inspected `agricoop_app` grants/RLS; public role lookup is blocked by missing `roles` RLS policy; one verified profile/legacy identity pair has conflicting roles; and payment tables plus `orders.demoSeedKey` are absent from the live schema. No database changes were run.

Status legend:
- Verified: directly confirmed in the checked-in code
- Partially verified: implemented in source but incomplete or not fully connected to the active runtime
- Unknown: no concrete evidence found in the inspected code

This audit is source-based only. It is based on repository inspection and code reading, not live browser-based verification or runtime interaction.

## 1. Actual technology stack

Verified from [package.json](./package.json), [server/_core/index.ts](./server/_core/index.ts), [server/_core/context.ts](./server/_core/context.ts), [drizzle/schema.ts](./drizzle/schema.ts), and [drizzle.config.ts](./drizzle.config.ts):

- Frontend: React 19 + Vite + Wouter + Tailwind CSS 4 + TanStack Query
- API layer: Express 4 + tRPC 11
- Runtime: TypeScript 5.9, ESM modules
- Database: MySQL via Drizzle ORM (`mysql2` driver)
- Identity/authentication: Supabase Auth
- Storage: Supabase Storage and a local storage proxy for app assets
- Test framework: Vitest

Important finding:
- This is not a Laravel app, not a Next.js app, and not a Supabase-only app.
- The app uses Supabase as the identity provider, while the application database is MySQL.

## 2. Backend architecture

### 2.1 Server bootstrap

Verified in [server/_core/index.ts](./server/_core/index.ts):

- It creates an Express app.
- It registers JSON body parsers.
- It exposes the live SSE endpoint `GET /api/conversations/:conversationId/stream`.
- It mounts the tRPC router at `/api/trpc`.
- It configures a storage proxy and either Vite dev middleware or static serving for production.

### 2.2 tRPC and auth middleware

Verified in [server/_core/trpc.ts](./server/_core/trpc.ts):

- `publicProcedure` is open to unauthenticated callers.
- `protectedProcedure` requires a valid local app user.
- `requireUser` checks `ctx.user` and then calls `requireOperationalRole(ctx.user, APP_ROLES)` unless the path is `auth.me`, `auth.logout`, or `account.myProfile`.
- `adminProcedure` enforces `ctx.user.role === 'admin'`.

### 2.3 Authentication and user context

Verified in [server/_core/context.ts](./server/_core/context.ts):

- The request expects a bearer token.
- It validates the token through Supabase.
- It loads the local app user record from the MySQL `users` table.
- It stores the created app user in request context.

This pattern means the application uses a two-layer auth model:
- Supabase is responsible for identity validity.
- MySQL is responsible for app-level role, cooperative, and approval state.

### 2.4 Business logic location

Verified in [server/routers.ts](./server/routers.ts), [server/db.ts](./server/db.ts), and [server/marketplaceRules.ts](./server/marketplaceRules.ts):

- Route logic is implemented in large tRPC router namespaces.
- Query logic is centralized in `server/db.ts`.
- Inventory/order rules are centralized in `server/marketplaceRules.ts`.
- Authorization logic is centralized in [server/authz.ts](./server/authz.ts).

### 2.5 Notification infrastructure

Verified in [server/_core/notification.ts](./server/_core/notification.ts) and [server/_core/systemRouter.ts](./server/_core/systemRouter.ts):

- There is a notification dispatch utility that calls an external service.
- There is a system router declaring a `notifyOwner` feature.

Status: partially verified. The notification infrastructure exists, but it is not clearly integrated into the active marketplace event flow.

## 3. API route inventory

The actual API surface is a tRPC router in [server/routers.ts](./server/routers.ts). There is no classic REST controller layer in this repo. The active routes are organized by namespace.

### 3.1 Verified tRPC namespaces

| Namespace | Verified procedures | Status |
|---|---|---|
| `auth` | `me`, `register`, `logout` | Verified |
| `account` | `myProfile`, `updateProfile`, `submitVerification`, `reviewVerification` | Verified |
| `conversations` | `mine`, `messages`, `create`, `send` | Verified |
| `cooperatives` | `list`, `create` | Verified |
| `marketplace` | `byId`, `list`, `categories` | Verified |
| `products` | `mine`, `create`, `uploadImage`, `submit`, `update`, `archive` | Verified |
| `quotations` | `buyerMine`, `sellerMine`, `request`, `respond`, `decide` | Verified |
| `orders` | `buyerMine`, `sellerMine`, `create`, `updateStatus` | Verified |
| `cooperativeAdmin` | `overview`, `orderDetails`, `updateMemberStatus` | Verified |
| `admin` | `overview`, `reviewProduct`, `updateUser` | Verified |

### 3.2 Other HTTP and system routes

Verified in [server/_core/index.ts](./server/_core/index.ts):

- `GET /api/conversations/:conversationId/stream` for SSE conversation streaming
- `/api/trpc` for all tRPC procedures
- storage proxy endpoints handled by `registerStorageProxy(app)`

Partially verified / not active:
- [server/_core/systemRouter.ts](./server/_core/systemRouter.ts) defines `system.health` and `system.notifyOwner`, but this is not evidently mounted into the active runtime.

## 4. Database schema and entity investigation

The canonical schema is in [drizzle/schema.ts](./drizzle/schema.ts). The app uses Drizzle with MySQL tables and not a separate `migrations`-only schema layer.

### 4.1 Verified tables

- `cooperatives`
- `users`
- `products`
- `quotations`
- `orders`
- `orderItems`
- `transactions`
- `conversations`
- `conversationMessages`
- `orderEvents`

### 4.2 Actual implementation of key entities

#### Users

Verified in [drizzle/schema.ts](./drizzle/schema.ts):

- `users` stores `openId`, `name`, `email`, `role`, `approvalStatus`, `verificationStatus`, `cooperativeId`, `verifiedBy`, and profile metadata.
- Role values are `buyer`, `seller`, `admin`, `superadmin`.
- This is a single-table role model.

#### Cooperatives

Verified in [drizzle/schema.ts](./drizzle/schema.ts):

- `cooperatives` stores organization-level metadata and `normalizedName` uniqueness.
- `users.cooperativeId` links a user to a cooperative.

#### Sellers

Not modeled as a standalone table. Sellers are represented through `users.role = 'seller'` and ownership relationships such as `products.sellerId` and `orders.sellerId`.

#### Products

Verified in [drizzle/schema.ts](./drizzle/schema.ts):

- Products include `sellerId`, `cooperativeId`, name, category, variety, unit, price, stock, min order quantity, status, verificationStatus, visibility, and `primaryImageUrl`.
- Inventory is scalar `stockQty`, not a separate stock ledger or reservation table.

#### Product categories

Partially verified:
- category is a string field on `products.category`.
- there is no dedicated `product_categories` table.
- categories are derived dynamically in [server/db.ts](./server/db.ts) with `getCategories()`.

#### Product images

Partially verified:
- `products.primaryImageUrl` is the only image reference in the main schema.
- `products.uploadImage` exists in [server/routers.ts](./server/routers.ts), but this is not a normalized product-image gallery table.

#### Inventory / stock management

Verified in [server/marketplaceRules.ts](./server/marketplaceRules.ts):

- `stockQty` is checked before order creation.
- `applyInventoryDeductions` reduces stock when the order completes.

Missing feature:
- no reservation ledger or stock movement table
- no per-batch inventory tracking

#### Shopping carts and cart items

Unknown / not implemented in schema:
- No `shoppingCarts` or `cartItems` table was found in [drizzle/schema.ts](./drizzle/schema.ts).
- The UI stores cart state in React local state in [client/src/pages/Marketplace.tsx](./client/src/pages/Marketplace.tsx), not in persisted database tables.

#### Orders and order items

Verified in [drizzle/schema.ts](./drizzle/schema.ts):

- `orders` stores buyer/seller/cooperative references, order type, status, payment status, totals, and notes.
- `orderItems` stores per-line item quantities and unit price.
- `orderEvents` captures actor and status-change metadata.

#### Transactions and payments

Partially verified:
- `transactions` stores amount, reference note, payment method, status, externalId, and completion metadata.
- The payment model is closer to a coordinated payment record than a real gateway integration.
- There is no full online checkout processor found in the repository.

#### Quotations

Verified in [drizzle/schema.ts](./drizzle/schema.ts):

- `quotations` stores `productId`, `buyerId`, `sellerId`, `requestedQty`, `buyerNote`, `quotedPriceCents`, `sellerNote`, and status.
- This is a real offer/response workflow.

#### Conversations and messages

Verified in [drizzle/schema.ts](./drizzle/schema.ts):

- `conversations` has subject, buyer, seller, product, order, and quotation references.
- `conversationMessages` stores actual message bodies.

#### Support tickets

Partially verified:
- There is no dedicated `support_tickets` table.
- Support is implemented as conversational threads using `conversations`.

#### Notifications

Partially verified:
- `server/_core/notification.ts` exists but is a standalone dispatcher.
- No user notification table or notification inbox was found.

#### Reviews

Unknown: no `reviews` or rating table was found.

#### Audit logs

Partial:
- `orderEvents` exists and logs status changes.
- There is no general-purpose audit log or immutable admin audit table.

### 4.3 Missing/absent relationships

The following relationships are absent or under-modeled:

- no cart-to-user relationship
- no product-to-image gallery relationship
- no category master table
- no inventory ledger or reservation table
- no payment processor integration table
- no audit log for all app actions
- no notifications table
- no read/unread message table
- no complaint/escalation model
- no review entity
- no RBAC permission matrix table

## 5. ER diagram

```mermaid
erDiagram
  cooperatives ||--o{ users
  cooperatives ||--o{ products
  cooperatives ||--o{ orders

  users ||--o{ products : sells
  users ||--o{ orders as buyer_orders : buys
  users ||--o{ orders as seller_orders : sells
  users ||--o{ quotations as buyer_quotations : requests
  users ||--o{ quotations as seller_quotations : responds
  users ||--o{ conversations as buyer_threads : starts
  users ||--o{ conversations as seller_threads : linked
  users ||--o{ conversationMessages : sends
  users ||--o{ orderEvents : acts_on
  users ||--o{ transactions as buyer_tx : pays
  users ||--o{ transactions as seller_tx : receives

  products ||--o{ quotations
  products ||--o{ orderItems
  products ||--o{ conversations

  orders ||--o{ orderItems
  orders ||--o{ transactions
  orders ||--o{ orderEvents
  orders ||--o{ conversations

  quotations ||--o{ conversations
```

## 6. Role and permission investigation

### 6.1 Runtime roles

Verified in [drizzle/schema.ts](./drizzle/schema.ts) and [server/authz.ts](./server/authz.ts):

- `buyer`
- `seller`
- `admin`
- `superadmin`

The app treats `admin` as the cooperative/officer role and `superadmin` as the platform-level role.

### 6.2 What is “Coop”?

Verified:
- `cooperatives` is a real table.
- `users.cooperativeId` links users to a cooperative.
- `products.cooperativeId` and `orders.cooperativeId` maintain cooperative scope.

Conclusion:
- “Coop” is an organization/entity in the database, not a top-level runtime role string.

### 6.3 Officer versus admin

Verified in [server/authz.ts](./server/authz.ts):

- `canAccessOrderForCooperative()` allows `admin` users only inside their `cooperativeId` scope.
- `superadmin` bypasses cooperative restriction.
- `canUpdateCooperativeUser()` enforces cooperative member management only within the same cooperative.

This means there is a real officer/admin distinction in practice, even though the enum value is still `admin`.

### 6.4 Seller access enforcement

Verified in [server/authz.ts](./server/authz.ts), [server/db.ts](./server/db.ts), and [server/routers.ts](./server/routers.ts):

- `getSellerProducts(sellerId)` filters by `products.sellerId`.
- `orders.sellerMine` is scoped to `orders.sellerId`.
- `canUpdateOrderStatus()` ensures sellers may only update orders that belong to them.
- A seller cannot update another seller’s product or order in the checked-in logic.

### 6.5 Buyer access enforcement

Verified in [server/db.ts](./server/db.ts):

- buyer order queries are scoped with `eq(orders.buyerId, buyerId)`.
- `quotations.decide` and `orders.create` enforce buyer ownership and self-order restrictions.

Conclusion:
- buyers are unable to access another buyer’s orders in the verified route logic.

### 6.6 Role matrix

| Role | Verified backend access |
|---|---|
| Buyer | Browse products, buy, request quotes, view own orders and quotations |
| Seller | Manage own products, respond to quotations, view own orders |
| Officer / `admin` | Manage cooperative overview, view member/product/order data in same cooperative |
| Superadmin | Platform-wide scope, bypass cooperative restrictions |

### 6.7 Authorization caveat

The app does not use a formal RBAC table. Permissions are directly encoded in route checks and helper functions in [server/authz.ts](./server/authz.ts). This is workable for a prototype but more brittle for production.

## 7. Transaction workflow investigation

### 7.1 Buyer adds product to cart

Verified in [client/src/pages/Marketplace.tsx](./client/src/pages/Marketplace.tsx):

- The cart is managed in client-side state, not persisted in a backend cart table.
- `addToCart` checks for non-seller, valid product availability, and prevented self-order conditions.

### 7.2 Buyer checks out

Verified in [server/routers.ts](./server/routers.ts) and [server/marketplaceRules.ts](./server/marketplaceRules.ts):

- `orders.create` validates products, quantity, and seller scope.
- `prepareOrder()` aggregates items, checks product availability, and enforces one-seller bulk orders.
- `assertInventorySufficient()` checks stock before order completion flow.

### 7.3 Order is created

Verified in [server/routers.ts](./server/routers.ts):

- Inserts a new row into `orders`
- Inserts rows into `orderItems`
- Creates a transaction record in `transactions`
- Opens a support conversation thread with the buyer and seller involved

### 7.4 Inventory deduction / reservation

Verified in [server/marketplaceRules.ts](./server/marketplaceRules.ts):

- `applyInventoryDeductions()` deducts stock during completion flow.
- `assertInventorySufficient()` validates available stock before order submission.

Important issue:
- inventory is not reserved at checkout time.
- stock is only reduced in completion logic, so the app does not implement a true reservation workflow.

### 7.5 Seller accepts/rejects order

The workflow is not a strict accept/reject system. Instead, it uses status progression.

Verified in [server/marketplaceRules.ts](./server/marketplaceRules.ts):

- `submitted -> confirmed` or `cancelled`
- `confirmed -> ready` or `cancelled`
- `ready -> completed` or `cancelled`

This is a status model rather than a classic buyer-seller acceptance panel.

### 7.6 Order processing and delivery validation

Verified in [server/routers.ts](./server/routers.ts) and [server/marketplaceRules.ts](./server/marketplaceRules.ts):

- `prepareOrderCompletion()` validates final item quantities.
- Final quantity totals update order line data and total price.
- `applyInventoryDeductions()` releases product stock deductions when the order is completed.

### 7.7 Completion and cancellation

Verified in [server/routers.ts](./server/routers.ts):

- Orders can be `completed` only with valid final quantities.
- Orders can be cancelled through transition logic.
- `orderEvents` records the action.

### 7.8 Problem reporting / complaint flow

Partially verified / missing:
- no `complaints`, `disputes`, or `refundCases` table found
- no specialized escalation model found
- the app uses generic support conversations as the closest thing to a complaint channel

### 7.9 Data consistency issues and gaps

Verified or likely concerns:

1. `aggregateOrderItems()` normalizes duplicate product lines, but there is no unique order-item constraint to prevent duplicate `productId` lines at the database layer.
2. Inventory is not reserved at checkout; high-risk if multiple buyers act concurrently.
3. The order status model allows direct transitions, but there is no explicit delivery confirmation workflow beyond quantity completion.
4. There is no full payment settlement path beyond recorded transaction status.

## 8. Messaging and support architecture

### 8.1 Buyer-to-seller conversations

Partially verified:
- `conversations` rows store `buyerId` and `sellerId` in [drizzle/schema.ts](./drizzle/schema.ts).
- `conversations.create` and `conversations.send` exist in [server/routers.ts](./server/routers.ts).
- The permission check uses `canAccessConversation()` in [server/authz.ts](./server/authz.ts).

This is a working basic conversation system, but not a full marketplace chat platform.

### 8.2 Conversation-to-order linkage

Verified:
- `conversations.orderId` and `conversations.quotationId` exist in [drizzle/schema.ts](./drizzle/schema.ts).
- `openSupportThread()` in [server/routers.ts](./server/routers.ts) creates a thread when an order is created.

### 8.3 Message history

Verified:
- `conversationMessages` stores each message body and timestamp.
- `getConversationMessages()` is used in [server/db.ts](./server/db.ts).

### 8.4 Real-time communication

Verified in [server/realtime.ts](./server/realtime.ts) and [server/_core/index.ts](./server/_core/index.ts):

- `publishConversationMessage()` emits to an in-memory channel.
- `subscribeConversation()` registers listeners.
- `/api/conversations/:conversationId/stream` sends SSE events.

Important limitation:
- this is in-memory, process-local event delivery and is not multi-instance safe.

### 8.5 Read/unread status

Unknown:
- no read markers, unseen counters, or message-status table were found.

### 8.6 Message ownership and support channels

Partially verified:
- message ownership is tracked by `senderId`.
- conversation access is validated by role and participant checks.
- however, there is no dedicated participants table or robust permission model for all chat interactions.

### 8.7 Support tickets

Partially verified:
- there is no dedicated ticketing table.
- the app approximates support as `conversations` without formal escalation or routing.

## 9. Loading, notifications, and async behavior

### 9.1 Loading indicators

Verified in [client/src/pages/Marketplace.tsx](./client/src/pages/Marketplace.tsx), [client/src/pages/Dashboard.tsx](./client/src/pages/Dashboard.tsx), and [client/src/pages/Support.tsx](./client/src/pages/Support.tsx):

- the app uses React state and query loading patterns.
- some operations use pending/mutation states and disable buttons while in flight.

Gaps:
- not every network action has the same consistent pattern.
- some flows rely on user feedback rather than a strong global loading state.

### 9.2 Browser alerts/prompts

Verified entries in [client/src/pages/Dashboard.tsx](./client/src/pages/Dashboard.tsx):

- `window.confirm(...)` is used for order cancellation confirmation.
- `window.prompt(...)` is used for rejection reason input.

No `alert()` calls were found in the audited frontend files.

### 9.3 Duplicate submissions and error handling

Partially verified:
- some actions use pending state, but there is no global duplicate-submission guard across all async operations.
- there are some success and error toasts, but not a single consistent notification system.

### 9.4 Notification architecture

Verified in [server/_core/notification.ts](./server/_core/notification.ts):

- there is a platform-level notification dispatch utility.

Missing integration:
- no database-backed user notification inbox
- no app-level event bus wired to user-facing notifications across the marketplace

## 10. Security findings

### 10.1 Verified protections

- Supabase token validation in [server/_core/context.ts](./server/_core/context.ts)
- role checks and operational approval validation in [server/authz.ts](./server/authz.ts)
- seller/buyer access filtering in [server/db.ts](./server/db.ts)
- order transition restriction in [server/marketplaceRules.ts](./server/marketplaceRules.ts)

### 10.2 Material security concerns / gaps

1. Role checks are encoded directly across routes and helpers rather than in a single RBAC policy object.
2. `adminProcedure` in [server/_core/trpc.ts](./server/_core/trpc.ts) requires `ctx.user.role === 'admin'` and excludes `superadmin`, which is inconsistent with the broader app policy in [server/authz.ts](./server/authz.ts).
3. Inventory reservation is not implemented, so stock can be oversold in faster concurrent flows.
4. SSE message streaming is in-memory only and is not safe across multiple app instances.
5. Notification infrastructure is present but not wired to all business events.
6. There is no universal audit log for user actions beyond `orderEvents`.

## 11. Missing backend functionality

The following were not found as actual implemented features in the checked-in code:

- persistent shopping carts
- cart item persistence
- product category master table
- dedicated product image gallery management
- inventory ledger and reservation table
- review/rating system
- full support ticket system with escalation
- global notification inbox
- payment gateway integration
- global audit trail for non-order actions
- RBAC permission table
- multi-instance real-time communication support

## 12. Broken or incomplete workflows

### Verified incomplete or weak areas

1. `systemRouter` exists but does not appear mounted in the application startup path in [server/_core/index.ts](./server/_core/index.ts) or [server/_core/app.ts](./server/_core/app.ts).
2. `adminProcedure` excludes `superadmin` in [server/_core/trpc.ts](./server/_core/trpc.ts), despite broader logic treating `superadmin` as platform-level authority.
3. The marketplace has no backend cart persistence, so cart state resets when the user refreshes or changes session.
4. Inventory is not reserved before checkout, creating a stock-consistency risk.
5. Support is simplified to `conversations` and does not contain a formal ticket lifecycle, moderation, or escalation model.
6. Notification delivery is not part of a persistent user-event pipeline.

## 13. Frontend-to-backend mapping

| Feature | Frontend component | API endpoint | Backend controller/service | Database table | Current status |
|---|---|---|---|---|---|
| Login/register | [client/src/pages/Auth.tsx](./client/src/pages/Auth.tsx) | tRPC `auth.register`, `auth.me`, `auth.logout` | [server/routers.ts](./server/routers.ts) | `users` | Verified |
| Marketplace browse | [client/src/pages/Marketplace.tsx](./client/src/pages/Marketplace.tsx) | `marketplace.list`, `marketplace.byId`, `marketplace.categories` | [server/db.ts](./server/db.ts) + [server/routers.ts](./server/routers.ts) | `products`, `users`, `cooperatives` | Verified |
| Product management | [client/src/pages/Dashboard.tsx](./client/src/pages/Dashboard.tsx) | `products.mine`, `products.create`, `products.update`, `products.submit`, `products.archive` | [server/routers.ts](./server/routers.ts) | `products` | Verified |
| Image upload | [client/src/pages/Dashboard.tsx](./client/src/pages/Dashboard.tsx) | `products.uploadImage` | [server/routers.ts](./server/routers.ts) + [server/storage.ts](./server/storage.ts) | `products.primaryImageUrl` + storage bucket | Verified |
| Quotations | [client/src/pages/Dashboard.tsx](./client/src/pages/Dashboard.tsx) | `quotations.request`, `quotations.respond`, `quotations.decide` | [server/routers.ts](./server/routers.ts) | `quotations` | Verified |
| Orders | [client/src/pages/Marketplace.tsx](./client/src/pages/Marketplace.tsx) and [client/src/pages/Dashboard.tsx](./client/src/pages/Dashboard.tsx) | `orders.create`, `orders.buyerMine`, `orders.sellerMine`, `orders.updateStatus` | [server/routers.ts](./server/routers.ts) + [server/marketplaceRules.ts](./server/marketplaceRules.ts) | `orders`, `orderItems`, `transactions`, `products` | Verified but inventory reservation incomplete |
| Support chat | [client/src/pages/Support.tsx](./client/src/pages/Support.tsx) | `conversations.mine`, `conversations.messages`, `conversations.send` | [server/routers.ts](./server/routers.ts) + [server/realtime.ts](./server/realtime.ts) | `conversations`, `conversationMessages` | Verified partial |
| Cooperative admin flow | [client/src/pages/Dashboard.tsx](./client/src/pages/Dashboard.tsx) | `cooperativeAdmin.overview`, `cooperativeAdmin.orderDetails`, `cooperativeAdmin.updateMemberStatus` | [server/db.ts](./server/db.ts) + [server/routers.ts](./server/routers.ts) | `users`, `orders`, `products`, `transactions` | Verified |
| Platform admin flow | [client/src/pages/Dashboard.tsx](./client/src/pages/Dashboard.tsx) | `admin.overview`, `admin.reviewProduct`, `admin.updateUser` | [server/routers.ts](./server/routers.ts) | `users`, `products`, `cooperatives` | Verified |
| Notifications | not clearly connected in UI | `system.notifyOwner` (not clearly active) | [server/_core/notification.ts](./server/_core/notification.ts) | none found | Partially verified |

## 14. Prioritized technical recommendations

### Priority 1: fix runtime inconsistencies

1. Mount or remove `systemRouter`
   - [server/_core/systemRouter.ts](./server/_core/systemRouter.ts)
   - [server/_core/index.ts](./server/_core/index.ts)
   - [server/_core/app.ts](./server/_core/app.ts)

2. Reconcile `adminProcedure` with `superadmin` access
   - [server/_core/trpc.ts](./server/_core/trpc.ts)
   - [server/authz.ts](./server/authz.ts)

3. Add true inventory reservation and concurrency-safe stock checks
   - [server/marketplaceRules.ts](./server/marketplaceRules.ts)
   - [server/routers.ts](./server/routers.ts)

### Priority 2: formalize the business model

4. Introduce a persistent cart model
   - current state is React local state only
   - [client/src/pages/Marketplace.tsx](./client/src/pages/Marketplace.tsx)

5. Separate permissions from route code with explicit RBAC policies
   - [server/authz.ts](./server/authz.ts)

6. Replace the simplified support-thread model with a complete ticket/escalation model if this is a real support operation
   - [drizzle/schema.ts](./drizzle/schema.ts)
   - [server/routers.ts](./server/routers.ts)

### Priority 3: make it production-grade

7. Add a persistent notification table and delivery pipeline
8. Add a global audit ledger for all important actions
9. Add read/unread tracking for conversations
10. Add support for refunds, dispute tracking, and payment settlement logic
11. Replace in-memory SSE with a shared multi-instance broker

## 15. Final conclusion

The checked-in codebase is a real, functional commercial prototype for a cooperative marketplace. It has a genuine backend, database schema, role model, marketplace workflow, quoting logic, order lifecycle, and real-time conversations. It is not merely a mockup or a frontend-only app.

However, it is still a prototype rather than a production-grade marketplace backend:

- the cart is client-side only
- stock is not reserved
- notification infrastructure is incomplete
- support is conversation-based rather than proper ticket-based
- RBAC is spread across helpers and route code
- admin/system-admin permission rules are not fully consistent
- the app has no complete payment, dispute, review, or audit architecture

The codebase is therefore best described as a working cooperative e-commerce prototype with a legitimate backend and database, but with important business-process gaps that would need to be closed before production deployment.

## 16. Evidence files reviewed

- [package.json](./package.json)
- [server/_core/index.ts](./server/_core/index.ts)
- [server/_core/app.ts](./server/_core/app.ts)
- [server/_core/context.ts](./server/_core/context.ts)
- [server/_core/trpc.ts](./server/_core/trpc.ts)
- [server/_core/systemRouter.ts](./server/_core/systemRouter.ts)
- [server/_core/notification.ts](./server/_core/notification.ts)
- [server/authz.ts](./server/authz.ts)
- [server/marketplaceRules.ts](./server/marketplaceRules.ts)
- [server/db.ts](./server/db.ts)
- [server/routers.ts](./server/routers.ts)
- [server/realtime.ts](./server/realtime.ts)
- [drizzle/schema.ts](./drizzle/schema.ts)
- [client/src/pages/Marketplace.tsx](./client/src/pages/Marketplace.tsx)
- [client/src/pages/Dashboard.tsx](./client/src/pages/Dashboard.tsx)
- [client/src/pages/Support.tsx](./client/src/pages/Support.tsx)
