# AgriCoop Marketplace — Current Project Summary

**Evidence scope:** this summary describes the repository as inspected on 2026-10-19. Statements about implemented behavior are based on current source, not the original phase plan or stale generated documentation. “NOT VERIFIED” means the behavior could not be established from the checked-in code. No `.env` file was opened or used as evidence.

## 1. OVERVIEW

AgriCoop is a cooperative-oriented agricultural marketplace for Buyers, Sellers/Farmers, cooperative Admin Officers (runtime role `admin`), and platform SuperAdmins. It supports approved visible produce listings, quotation requests, single- and multi-product orders from one Seller, order fulfillment, F2F payment/handover records, and support conversations. Payment processing is not implemented: an order records `f2f`, and the app stores a coordination/reference note. Evidence: [`client/src/pages/Marketplace.tsx`](../client/src/pages/Marketplace.tsx) (`Marketplace`), [`server/marketplaceRules.ts`](../server/marketplaceRules.ts) (`prepareOrder`, `transactionStatusFor`), [`server/routers.ts`](../server/routers.ts) (`orders.create`, `orders.updateStatus`).

| Layer | Version / current implementation |
|---|---|
| Package manager | pnpm 10.4.1 (declared package manager in [`package.json`](../package.json)) |
| UI/runtime | React ^19.2.1, Vite ^7.1.7, Wouter ^3.3.5, Tailwind CSS ^4.1.14 |
| API/runtime | Express ^4.21.2, tRPC ^11.6.0, TypeScript 5.9.3 |
| Persistence | Drizzle ORM ^0.44.5, MySQL dialect, mysql2 ^3.15.0 |
| Identity/storage SDK | Supabase JS ^2.116.0; Supabase Auth is used for identity. Supabase Storage is used by the product image upload helper. |
| UI/data utilities | TanStack React Query ^5.90.2, Radix UI packages, Lucide React ^0.453.0, date-fns ^4.1.0 |
| Build/test | Vitest ^2.1.4, drizzle-kit ^0.31.4, esbuild ^0.25.0 |

This is **not** a Next.js application and the active database is MySQL, not Supabase Postgres. There is no checked-in live PostgreSQL migration. See [`client/src/App.tsx`](../client/src/App.tsx), [`server/_core/index.ts`](../server/_core/index.ts), [`drizzle/schema.ts`](../drizzle/schema.ts), and [`drizzle.config.ts`](../drizzle.config.ts).

## 2. ARCHITECTURE

### Folder map

| Folder | Contents and current purpose |
|---|---|
| [`client/`](../client/) | React/Vite application, pages, UI components, Supabase browser client, tRPC client, and static product images. |
| [`server/`](../server/) | Express/tRPC API, authorization, MySQL queries, marketplace rules, Supabase clients/storage, and unit tests. |
| [`shared/`](../shared/) | Shared product units/options, CSV serialization, constants, and shared error/type definitions. |
| [`drizzle/`](../drizzle/) | MySQL Drizzle schema, seven numbered MySQL migrations, metadata snapshots, and relations. |
| [`scripts/`](../scripts/) | Default/demo/SuperAdmin seeding scripts. |
| [`supabase/`](../supabase/) | `rls.sql`, a proposed Postgres RLS baseline; it is not shown as applied to the current MySQL runtime. |
| [`docs/`](../docs/) | Setup/environment instructions, generated manuals, review-package notes, payment notes, and this summary. |

### Request and authentication flow

1. [`client/src/main.tsx`](../client/src/main.tsx) initializes React Query and the typed tRPC client, retrieves the Supabase access token, and sends it in the tRPC `Authorization` header to `/api/trpc`.
2. [`server/_core/index.ts`](../server/_core/index.ts) runs the local Express server and serves Vite in development or static files in local production. Vercel exports the same Express app from [`api/index.ts`](../api/index.ts); static assets are served by Vercel.
3. [`server/_core/context.ts`](../server/_core/context.ts) validates a bearer token using Supabase Auth (`supabaseAdmin.auth.getUser`), looks up/creates a local MySQL `users` profile by `openId`, and places that local profile in tRPC context.
4. [`server/_core/trpc.ts`](../server/_core/trpc.ts) provides public, protected, and `adminProcedure` middleware. Most application authorization is performed in the individual procedures using [`server/authz.ts`](../server/authz.ts) (`requireOperationalRole`).
5. [`server/routers.ts`](../server/routers.ts) implements business procedures. They use helpers in [`server/db.ts`](../server/db.ts), which constructs Drizzle through `drizzle-orm/mysql2`, against the `DATABASE_URL` MySQL connection.

Supabase Auth is therefore an identity provider; application roles, approvals, cooperative assignments, and business records live in the separate MySQL `users` table. This is not the same as using Supabase Postgres as the app database.

### Storage

| Bucket/path | Visibility in code | Current use |
|---|---|---|
| `product-images` (or the `SUPABASE_STORAGE_BUCKET` override) | Public | Product images use a short-lived Supabase signed upload token for direct browser uploads and public URLs. The bucket is constrained to 5 MiB and JPEG/PNG/WebP. |
| `verification-docs` | NOT VERIFIED / not implemented | No such bucket name or upload/review procedure was found. |
| `chat-images` | NOT VERIFIED / not implemented | No such bucket name or upload/message procedure was found. |
| `/manus-storage/*` | Removed | Product and profile image URL counts in the configured database were zero before removing the legacy proxy. New uploads use Supabase Storage directly. |

`storagePut` accepts an optional bucket and `{ bucket, public, expiresIn }` configuration. Private upload URLs are signed for a default of 300 seconds. This helper does not itself authorize the caller or establish ownership; a future private-file endpoint must do so. No current verification/chat workflow invokes it. Evidence: [`server/storage.ts`](../server/storage.ts) (`ensureBucket`, `storagePut`, `storageGet`, `storageGetSignedUrl`) and [`server/routers.ts`](../server/routers.ts) (`products.uploadImage`).

### Chat updates

Conversation updates use tRPC polling: the Support page refreshes messages every five seconds and the thread list every ten seconds. This avoids process-local pub/sub and SSE connections that do not work reliably across serverless invocations. Evidence: [`server/routers.ts`](../server/routers.ts) (`conversations.send`) and [`client/src/pages/Support.tsx`](../client/src/pages/Support.tsx).

## 3. ROLES AND PERMISSIONS MATRIX

Runtime roles are `buyer`, `seller`, `admin`, and `superadmin` in [`drizzle/schema.ts`](../drizzle/schema.ts). UI copy calls `admin` a Cooperative Admin Officer. The matrix reflects current procedure checks, not the stronger requested design. “Scoped” means the procedure/query applies an owner or cooperative filter. `requireOperationalRole` rejects non-SuperAdmin users whose `approvalStatus` is not `approved`.

| Procedure / feature group | SuperAdmin | Admin/Officer | Seller | Buyer | Enforcement / tests |
|---|---|---|---|---|---|
| `auth.me`, `auth.logout` | Allowed | Allowed | Allowed | Allowed | Public procedures in [`server/routers.ts`](../server/routers.ts); logout test in [`server/auth.logout.test.ts`](../server/auth.logout.test.ts). |
| `auth.register` | Denied as selectable role | Allowed to request `admin`, pending | Allowed to register, pending | Allowed to register, approved | Public schema accepts buyer/seller/admin, not superadmin; account creation in `auth.register`. No route-level registration authorization test. |
| `cooperatives.list` | Allowed | Allowed | Allowed | Allowed | Public procedure and active cooperative query (`getCooperatives`). |
| `cooperatives.create` | Allowed | Allowed | Denied | Denied | `requireOperationalRole(["admin","superadmin"])`; `cooperatives.create`. |
| `marketplace.list`, `categories`, `byId` | Allowed | Allowed | Allowed | Allowed | Public procedures and public eligibility filters in `getMarketplace` / `getMarketplaceProduct`. |
| `account.myProfile`, `account.updateProfile` | Allowed for own row | Allowed for own row | Allowed for own row | Allowed for own row | Protected procedure; `updateProfile` writes only `ctx.user.id` but accepts a buyer/seller role and caller-selected cooperative ID. |
| `products.mine` | Allowed, query filtered to own user ID | Allowed, query filtered to own user ID | Allowed, own listings | Denied | Role check in `products.mine`; `getSellerProducts(ctx.user.id)`. |
| Product create/upload/submit/update/archive | Allowed by role gate; ownership still enforced on edit | Allowed by role gate; ownership still enforced on edit | Allowed for Seller-owned listings | Denied | `requireOperationalRole(["seller","admin","superadmin"])`; updates include `sellerId` equality. No user-verification gate. |
| `quotations.buyerMine`, `request` | Denied | Denied | Allowed, own requests / eligible listings | Allowed, own requests / eligible listings | Role checks in quotation procedures; self-transaction and stock/minimum checks in `marketplaceRules.ts`. |
| `quotations.sellerMine`, `respond` | Denied | Denied | Allowed, own Seller quotations | Denied | `sellerMine` and `respond` require seller; `respond` checks Seller ID and requested state. |
| `orders.buyerMine`, `create` | Denied | Denied | Allowed as Buyer of another Seller's listing | Allowed | Role check, owner/self-transaction and order rules in `orders.create`; query keyed by buyer ID. |
| `orders.sellerMine` | Denied | Denied | Allowed, own Seller orders | Denied | Seller role check and `getSellerOrders(ctx.user.id)`. |
| `orders.updateStatus` | **Denied by current role allow-list** | Allowed, but not cooperative-scoped | Allowed only for own Seller orders | Denied | `requireOperationalRole(["seller","admin"])`, `canManageSellerOrder`, transition and stock checks. SuperAdmin is not in the allowed roles. |
| `conversations.mine` | Allowed, global | Allowed, global | Scoped to buyer/seller IDs | Scoped to buyer/seller IDs | Query in `getConversationsForUser`; Admin/SuperAdmin `canSeeAll`. |
| `conversations.messages`, `send` | Allowed, global | Allowed, global | **Denied by current tRPC check** | Allowed only when `buyerId` is self | Conditions check `thread.buyerId`, not `thread.sellerId` or a participants table. No nonparticipant route test. |
| `conversations.create` | Allowed for signed-in account | Allowed | Allowed | Allowed | Any protected user can open a buyer-owned generic support thread. |
| `cooperativeAdmin.overview` | Scoped to assigned cooperative; empty if no cooperative | Scoped to assigned cooperative | Denied | Denied | `getOfficerOverview(cooperativeId)`; SuperAdmin gets the same query semantics, not a global view. |
| `cooperativeAdmin.updateMemberStatus` | Scoped to assigned cooperative | Scoped to assigned cooperative | Denied | Denied | SQL update includes target `cooperativeId`; requires actor cooperative assignment. |
| `admin.overview`, `reviewProduct`, `updateUser` | Allowed, platform-wide | Allowed, platform-wide (not cooperative-scoped) | Denied | Denied | `requireOperationalRole(["admin","superadmin"])`. `updateUser` prevents an Admin from assigning SuperAdmin, but does not constrain other targets to the Officer’s cooperative. |
| `system.health` | Allowed | Allowed | Allowed | Allowed | Public procedure, timestamp input. |
| `system.notifyOwner` | **Denied** | Allowed | Denied | Denied | `adminProcedure` specifically accepts role `admin` only. It calls the Manus notification service, not a user notification/email system. |
| CSV report page | UI blocked by role condition | UI allowed; global dataset | Denied | Denied | `Reports.tsx` fetches `admin.overview`; backend admin/superadmin could call overview, but page enables it only when `role === "admin"`. |

The underlying helper tests cover role membership, Seller order ownership, and pending Admin rejection; they do not exercise every procedure in this table. See [`server/authz.test.ts`](../server/authz.test.ts) and Section 10.

## 4. FEATURE INVENTORY

Status terms: **DONE** means the code provides the described core workflow; **PARTIAL** means some but not all behavior exists; **MISSING** means no implementation was found. This is about the current repository, not the planned phases.

| Feature | Status | What current code actually does |
|---|---|---|
| Sign-up/login and account approval | PARTIAL | `/auth` supports Supabase email/password sign-in and registration for Buyer, Seller, and Admin Officer. `auth.register` creates confirmed Auth users (`email_confirm: true`); Buyers get `approvalStatus: approved`, Sellers/Admins `pending`. No email confirmation step. Operational role checks enforce approval. [`client/src/pages/Auth.tsx`](../client/src/pages/Auth.tsx), [`server/routers.ts`](../server/routers.ts) (`auth.register`), [`server/authz.ts`](../server/authz.ts). |
| Cooperative picker / add new cooperative | PARTIAL | Cooperative Seller registration can choose an active cooperative or submit a new name; names are normalized and duplicate-matched. The option is not shown for an individual Seller. `cooperatives.create` is a separate Admin/SuperAdmin operation. [`Auth.tsx`](../client/src/pages/Auth.tsx), [`cooperativeNames.ts`](../server/cooperativeNames.ts), [`routers.ts`](../server/routers.ts) (`cooperatives`). |
| Listings and listing verification | DONE (basic) | Seller can create/edit/archive/submit a listing; new listings default to hidden and pending (or draft if not submitted). Admin can approve/reject; approved listings become published/visible, rejected ones hidden/archived with reason. Public query requires published + approved + visible. [`Dashboard.tsx`](../client/src/pages/Dashboard.tsx) (`SellerDashboard`), [`routers.ts`](../server/routers.ts) (`products`, `admin.reviewProduct`), [`db.ts`](../server/db.ts) (`getMarketplace`). |
| Price sort, category and text filter | DONE | Marketplace supports price ascending/descending, category selection, and client-side search across product/category/Seller/cooperative names. [`Marketplace.tsx`](../client/src/pages/Marketplace.tsx), [`db.ts`](../server/db.ts) (`getMarketplace`). |
| Product details and images | DONE (basic) | Public detail route renders one primary image or a local crop-image fallback, variety, description, price, available stock, minimum quantity, Seller and cooperative. Product upload accepts JPEG/PNG/WebP. No multi-image gallery or browser image compression. [`ProductDetails.tsx`](../client/src/pages/ProductDetails.tsx), [`productImages.ts`](../client/src/lib/productImages.ts), [`routers.ts`](../server/routers.ts) (`products.uploadImage`). |
| Quotations | PARTIAL | Buyer/Seller can request and respond/decline; a quotation-linked conversation is created. `quotedPriceCents` is stored, but accepted quotation handling, conversion to order, three-party membership, and user-verification gating are absent. The seller UI labels entry “Total PHP quote” while Buyer display treats it as per-unit price. [`routers.ts`](../server/routers.ts) (`quotations`), [`Dashboard.tsx`](../client/src/pages/Dashboard.tsx) (`QuotationResponse`), [`Activity.tsx`](../client/src/pages/Activity.tsx). |
| Regular and bulk orders / price rules | PARTIAL | `prepareOrder` labels one line item `regular` and multiple line items `bulk`, requires all products to belong to one Seller, enforces each item’s `minOrderQty` and available `stockQty`, then totals `quantity × current listing price`. There is no product `maxOrderQty`, min/max price range, price negotiation logic for bulk, or application of a quotation price to an order. The UI also prevents mixing sellers. Duplicate product IDs can be submitted as separate items; the checks do not sum duplicate quantities before comparing them with stock. [`marketplaceRules.ts`](../server/marketplaceRules.ts) (`prepareOrder`), [`routers.ts`](../server/routers.ts) (`orders.create`), [`Marketplace.tsx`](../client/src/pages/Marketplace.tsx). |
| Completion, final quantity edit, cancellation and stock deduction | PARTIAL | Seller or Admin can move `submitted → confirmed → ready → completed`, or cancel before terminal status. On completion the API rechecks stock, decrements product stock using each order-item quantity, sets completion time, and updates the transaction note/status. There is no Admin-only final confirmation, editable final/deducted quantity, or order event/timeline. SuperAdmin cannot call this procedure because it is excluded from the allowed role list. [`marketplaceRules.ts`](../server/marketplaceRules.ts) (`canTransitionOrder`, `assertInventorySufficient`), [`routers.ts`](../server/routers.ts) (`orders.updateStatus`), [`db.ts`](../server/db.ts) (`decrementProductStock`). |
| Transactions | DONE (basic) | Creating an order creates a `transactions` row with F2F method and coordinated status. Completing the order updates status and optional reference note. `transactions.completedAt` defaults at row creation, so its name does not prove it records actual completion time. [`routers.ts`](../server/routers.ts) (`orders.create`, `orders.updateStatus`), [`drizzle/schema.ts`](../drizzle/schema.ts) (`transactions`). |
| CSV reports | DONE (four client-generated exports) | The Admin reports page exports Sales, Inventory, Quotation, and Transaction CSVs from `admin.overview`. There is no server-side report router; CSV generation is client-side with shared escaping. Reports are platform-wide for the Admin UI; no Officer cooperative-filtered reports. Dates use raw Date string conversion rather than Manila-specific formatting. [`Reports.tsx`](../client/src/pages/Reports.tsx), [`shared/reportCsv.ts`](../shared/reportCsv.ts), [`routers.ts`](../server/routers.ts) (`admin.overview`). |
| Profile page and user profile fields | MISSING / PARTIAL | No `/profile` route or profile UI. Current `account.myProfile` returns the local user and `updateProfile` accepts role, cooperative, contact number, and address. Schema has no profile image or birthdate. [`client/src/App.tsx`](../client/src/App.tsx), [`routers.ts`](../server/routers.ts) (`account`), [`drizzle/schema.ts`](../drizzle/schema.ts) (`users`). |
| ID/selfie verification and verification gating | MISSING | `verificationStatus` belongs to products, not users. No verification submissions table, file upload/review, consent checkbox, privacy notice, age gate, or verification gate for listings/orders/quotations/messages. Account `approvalStatus` is a separate role-approval mechanism. [`drizzle/schema.ts`](../drizzle/schema.ts), [`routers.ts`](../server/routers.ts), [`Auth.tsx`](../client/src/pages/Auth.tsx). |
| Conversations | PARTIAL | Text-only `body` messages; generic inquiry, quotation-linked, and order-linked threads; buyer and Seller IDs stored on conversations, but no explicit participants table. tRPC message authorization wrongly permits the buyer or Admin/SuperAdmin, not the Seller ID. No image/location messages, map cards, emoji picker, unread counts, per-user hiding, archive/delete, or chat image bucket. [`drizzle/schema.ts`](../drizzle/schema.ts) (`conversations`, `conversationMessages`), [`routers.ts`](../server/routers.ts) (`conversations`), [`Support.tsx`](../client/src/pages/Support.tsx). |
| Monitoring notice and acknowledgement | MISSING | No permanent conversation banner and no stored notice acknowledgement field or table. [`Support.tsx`](../client/src/pages/Support.tsx), [`drizzle/schema.ts`](../drizzle/schema.ts). |
| Reports/flags, suspension, audit log | PARTIAL | `approvalStatus` includes `suspended`, and member/Admin updates can set it. No user-generated reports/flags or audit-log table/events. Suspended status is not independently checked by every tRPC procedure; enforcement depends on `requireOperationalRole` at that procedure. [`drizzle/schema.ts`](../drizzle/schema.ts) (`users`), [`routers.ts`](../server/routers.ts) (`cooperativeAdmin.updateMemberStatus`, `admin.updateUser`), [`authz.ts`](../server/authz.ts). |
| Order details and event timeline | MISSING | Orders are shown as summary/fulfillment cards. No order-events table, event writer, full timeline, agreed/listing price comparison, threshold warning, or order detail screen. [`Dashboard.tsx`](../client/src/pages/Dashboard.tsx), [`drizzle/schema.ts`](../drizzle/schema.ts), [`routers.ts`](../server/routers.ts) (`orders`). |
| Asia/Manila display and UTC storage | MISSING | No shared formatter. Support uses browser-default time zone with `en-PH`; Dashboard uses date-only `toLocaleDateString`; CSV includes stringified date values. Schema uses MySQL timestamps/defaults without explicit UTC session policy. [`Support.tsx`](../client/src/pages/Support.tsx), [`Dashboard.tsx`](../client/src/pages/Dashboard.tsx), [`Reports.tsx`](../client/src/pages/Reports.tsx), [`drizzle/schema.ts`](../drizzle/schema.ts). |
| Ratings | MISSING | No rating/review schema or app routes. Rating fields found in the Manus map proxy types relate to external places, not AgriCoop transactions. [`drizzle/schema.ts`](../drizzle/schema.ts), [`server/routers.ts`](../server/routers.ts). |
| Notifications and email | PARTIAL | `system.notifyOwner` sends a title/content payload to a Manus-hosted notification endpoint. No app event dispatcher, user notification table, email templates, delivery preferences, throttling/caps, or dry-run mode. No SMS integration was found. [`server/_core/notification.ts`](../server/_core/notification.ts), [`server/_core/systemRouter.ts`](../server/_core/systemRouter.ts). |
| Reference prices and pickup scheduling | MISSING | No reference-price source/table or structured pickup schedule fields or UI. Conversations can contain free-text coordination only. [`drizzle/schema.ts`](../drizzle/schema.ts), [`Support.tsx`](../client/src/pages/Support.tsx). |
| Seed data | PARTIAL | `seed-defaults.ts` defines five default accounts, sets their application `approvalStatus` to approved, seeds approved/visible crop products, and does not set any monitoring acknowledgement (no corresponding schema field). `seed-demo.ts` is a separate demo data script. Exact credentials are intentionally not reproduced. [`scripts/seed-defaults.ts`](../scripts/seed-defaults.ts), [`scripts/seed-demo.ts`](../scripts/seed-demo.ts), [`docs/ENVIRONMENT.md`](./ENVIRONMENT.md). |

## 5. DATABASE

### Current tables and columns

The live Drizzle schema has nine MySQL tables. There are no conversation participant, order event, verification submission, audit log, notification, rating, report/flag, reference-price, pickup-schedule, or profile-image tables/columns.

| Table | Columns (type summary) | Relationships / purpose |
|---|---|---|
| `cooperatives` | `id` int PK; `name`, `normalizedName`, `location` varchar; `description` text; `status` active/inactive enum; `createdAt` timestamp | `normalizedName` unique. Parent grouping for users, products, and orders. |
| `users` | `id` int PK; `openId` varchar unique; nullable `name` text, `email` varchar, `loginMethod` varchar; `role` buyer/seller/admin/superadmin enum; `approvalStatus` approved/pending/suspended enum; nullable `cooperativeId` int, `contactNumber` varchar, `address` text; `createdAt`, `updatedAt`, `lastSignedIn` timestamps | `cooperativeId → cooperatives.id`; Supabase Auth UUID is stored in `openId`; no explicit `auth_user_id` Postgres field. |
| `products` | `id` int PK; `sellerId` int; nullable `cooperativeId`; `name`, `category`, `variety`, `unit`; `description` text; `priceCents`, `stockQty`, `minOrderQty` ints; `qualityGrade` premium/standard/imperfect enum; `status` published/archived enum; `verificationStatus` draft/pending/approved/rejected enum; `visibility` hidden/visible enum; `rejectionReason` text; `primaryImageUrl` varchar; `createdAt`, `updatedAt` timestamps | `sellerId → users.id`, `cooperativeId → cooperatives.id`; marketplace listing and moderation. |
| `quotations` | `id` int PK; `productId`, `buyerId`, `sellerId`, `requestedQty` ints; `buyerNote`, `sellerNote` text; nullable `quotedPriceCents`; `status` requested/responded/accepted/declined enum; `createdAt`, nullable `respondedAt` timestamps | Links product, Buyer and Seller. The `accepted` state is in schema but no procedure sets it. |
| `orders` | `id` int PK; `buyerId`, `sellerId` ints; nullable `cooperativeId`; `orderType` regular/bulk enum; `status` submitted/confirmed/ready/completed/cancelled enum; `paymentStatus` pending/paid/failed/F2F-pending-confirmation enum; nullable `paymentMethod`; `totalCents`; `buyerNote`; nullable `completedAt`; `createdAt`, `updatedAt` timestamps | Buyer/Seller/cooperative relationships; one-to-many `orderItems`; `transactions` unique per order. |
| `orderItems` | `id` int PK; `orderId`, `productId`, `quantity`, `unitPriceCents` ints | `orderId → orders.id`, `productId → products.id`; line-item quantity and price. |
| `transactions` | `id` int PK; `orderId`, `buyerId`, `sellerId`, `amountCents` ints; `paymentReferenceNote` text; `status` recorded/payment_coordinated/pending/paid/failed enum; `paymentMethod`, `externalId` varchar; `completedAt` timestamp defaulting now | `orderId` has a unique index; F2F coordination record. |
| `conversations` | `id` int PK; `subject` varchar; `buyerId` int; nullable `sellerId`, `productId`, `orderId`, `quotationId`; `status` open/closed enum; `createdAt`, `updatedAt` timestamps | Links Buyer, optional Seller/product/order/quotation. No participants join table or hidden/deleted fields. |
| `conversationMessages` | `id` int PK; `conversationId`, `senderId` ints; `body` text; `createdAt` timestamp | `conversationId → conversations.id`; `senderId → users.id`; text-only messages. |

Evidence: [`drizzle/schema.ts`](../drizzle/schema.ts) and query helpers in [`server/db.ts`](../server/db.ts).

### Migration order and contents

| Order | File | Change represented |
|---:|---|---|
| 0 | [`drizzle/0000_flawless_screwball.sql`](../drizzle/0000_flawless_screwball.sql) | Initial `users` table. |
| 1 | [`drizzle/0001_smart_wiccan.sql`](../drizzle/0001_smart_wiccan.sql) | Adds cooperatives, products, quotations, orders/order items and transactions; adds basic role/approval/cooperative/contact columns and foreign keys. |
| 2 | [`drizzle/0002_foamy_random.sql`](../drizzle/0002_foamy_random.sql) | Adds payment status/method and external transaction ID fields. |
| 3 | [`drizzle/0003_slim_otto_octavius.sql`](../drizzle/0003_slim_otto_octavius.sql) | Adds conversations/messages and their original foreign keys. |
| 4 | [`drizzle/0004_panoramic_archangel.sql`](../drizzle/0004_panoramic_archangel.sql) | Normalizes legacy `officer`/`user` role values; narrows role enum; adds conversation Seller/product context and product verification/visibility/rejection/image columns. |
| 5 | [`drizzle/0005_chief_toad_men.sql`](../drizzle/0005_chief_toad_men.sql) | Adds `cooperatives.normalizedName`, populates it from existing names, and adds a unique index. |
| 6 | [`drizzle/0006_same_inertia.sql`](../drizzle/0006_same_inertia.sql) | Adds required product `variety` (backfilled as `Unspecified`) and `minOrderQty`. |

The journal at [`drizzle/meta/_journal.json`](../drizzle/meta/_journal.json) lists the seven migrations in that order with dialect `mysql`. The current checked-in chain contains forward migrations; whether earlier migrations were rewritten before the current repository state is **NOT VERIFIED**.

### MySQL-to-Supabase-Postgres incompatibilities

- `mysqlTable`, `mysqlEnum`, `int().autoincrement()`, and MySQL Drizzle driver/config must become `pgTable`/Postgres enums or checked text, identity/serial columns, and a PostgreSQL driver/dialect.
- `onUpdateNow()` in `users.updatedAt`, `products.updatedAt`, `orders.updatedAt`, and `conversations.updatedAt` relies on MySQL `ON UPDATE CURRENT_TIMESTAMP`; Postgres requires explicit application updates or a trigger.
- All identifiers are camelCase (`orderItems`, `conversationMessages`, `openId`, `createdAt`). PostgreSQL unquoted names fold to lowercase; quoted camelCase remains case-sensitive. Decide a consistent snake_case mapping and update every query, migration, and policy.
- MySQL `timestamp`/`defaultNow()` does not establish the repository's required UTC session/display policy. Use `timestamptz`, explicit UTC migration semantics, and test round-trips.
- MySQL enum alteration/data conversion and `REGEXP_REPLACE` migration semantics must be reviewed. Money is integer cents; keep range/precision consistent in Postgres.
- Existing integer PK/FK relationships need consistent identity widths and sequence state. `openId` currently holds the Supabase Auth identity but is not declared as a UUID FK to `auth.users`.
- JSON-specific migration is not applicable to current business tables: no JSON column is defined in `drizzle/schema.ts`. Any template JSON usage must be reviewed separately.

## 6. API SURFACE

All routes below are tRPC procedures unless noted. Procedure definitions are in [`server/routers.ts`](../server/routers.ts); system procedures are in [`server/_core/systemRouter.ts`](../server/_core/systemRouter.ts). Inputs are summarized from current Zod schemas.

| Procedure | Input | Caller | Effect |
|---|---|---|---|
| `auth.me` | none | Public | Returns current context user or null. |
| `auth.register` | email, password, name, role buyer/seller/admin; optional Seller type individual/cooperative; optional cooperative ID or new name | Public | Creates a confirmed Supabase Auth user and local profile; Buyer approved, Seller/Admin pending. |
| `auth.logout` | none | Public | Clears app cookie and prevents response caching; browser logout also clears Supabase session. |
| `conversations.mine` | none | Protected | Lists a user's threads; Admin/SuperAdmin request all threads. |
| `conversations.messages` | positive `conversationId` | Protected, but code grants only buyer owner or admin/superadmin | Returns chronological text messages. |
| `conversations.create` | subject (3–180 chars), body (1–2000 chars) | Any protected user | Creates buyer-owned generic support thread and initial message. |
| `conversations.send` | positive `conversationId`, body (1–2000 chars) | Protected, but code grants only buyer owner or admin/superadmin | Inserts text and updates thread timestamp; clients receive changes through polling. |
| `account.myProfile` | none | Protected | Returns current local user. |
| `account.updateProfile` | role buyer/seller, nullable cooperative ID, optional contact number/address | Protected | Updates the current user's role/cooperative/contact/address; forces approval to approved for buyer or pending for seller. |
| `cooperatives.list` | none | Public | Lists active cooperatives. |
| `cooperatives.create` | name, location, optional description | Admin/SuperAdmin | Normalizes and inserts cooperative. |
| `marketplace.byId` | positive product ID | Public | Returns one public-eligible listing or NOT_FOUND. |
| `marketplace.list` | optional category and sort asc/desc (default asc) | Public | Returns public-eligible listings sorted by unit price. |
| `marketplace.categories` | none | Public | Returns distinct categories from visible, approved, published listings. |
| `products.mine` | none | Seller/Admin/SuperAdmin | Returns products matching the caller's local user ID. |
| `products.create` | product name/category/variety/description/unit/price/stock/minimum; optional quality grade, image URLs, submit flag | Seller/Admin/SuperAdmin | Inserts listing owned by caller; hidden and pending by default submission. |
| `products.uploadImage` | filename, JPEG/PNG/WebP content type, base64 bytes | Seller/Admin/SuperAdmin | Validates base64 and max 8 MB decoded content, uploads to default public bucket. |
| `products.submit` | product ID | Seller/Admin/SuperAdmin | Marks caller-owned product pending/hidden and clears rejection reason. |
| `products.update` | product ID plus listing fields/status/image | Seller/Admin/SuperAdmin | Updates only a product whose `sellerId` equals caller ID. |
| `products.archive` | product ID | Seller/Admin/SuperAdmin | Archives caller-owned product. |
| `quotations.buyerMine` | none | Buyer/Seller | Lists quotations where caller is Buyer. |
| `quotations.sellerMine` | none | Seller | Lists quotations where caller is Seller. |
| `quotations.request` | product ID, positive quantity, optional Buyer note | Buyer/Seller | Checks listing availability, min/stock/self-trade; creates quotation and linked conversation. |
| `quotations.respond` | quotation ID, positive quoted price, optional note, status responded/declined | Seller | Updates own open request and response time. |
| `orders.buyerMine` | none | Buyer/Seller | Lists orders where caller is Buyer with line items. |
| `orders.sellerMine` | none | Seller | Lists Seller-owned orders and item details. |
| `orders.create` | one or more product ID/positive quantity items; optional note | Buyer/Seller | Validates listings, one Seller, min/stock/self-trade; creates order, items, transaction and linked conversation. |
| `orders.updateStatus` | order ID, confirmed/ready/completed/cancelled; optional payment note | Seller/Admin | Enforces Seller ownership/Admin oversight and valid transition; on completion checks stock, decrements it and updates transaction. |
| `cooperativeAdmin.overview` | none | Admin/SuperAdmin | Returns members, products, orders, quotations and transactions for caller's cooperative. |
| `cooperativeAdmin.updateMemberStatus` | user ID, approved/suspended | Admin/SuperAdmin | Updates target only when target shares actor's cooperative. |
| `admin.overview` | none | Admin/SuperAdmin | Returns platform-wide users, cooperatives, products, orders, quotations and transactions. |
| `admin.reviewProduct` | product ID, approved/rejected, optional rejection reason | Admin/SuperAdmin | Sets moderation status/visibility/publication and reason. |
| `admin.updateUser` | user ID, role, approval status, nullable cooperative ID | Admin/SuperAdmin | Changes role/status/cooperative; Admin cannot assign SuperAdmin. |
| `system.health` | nonnegative timestamp | Public | Returns `{ ok: true }`. |
| `system.notifyOwner` | nonempty title/content | Admin only | Calls Manus notification service; payload max lengths are validated in `notifyOwner`. |

There is no dedicated report API. Reports are composed in the browser from `admin.overview`. There is no route for user verification, order events/details, ratings, reports/flags, audit events, image/location chat, or notice acknowledgement.

## 7. NOTIFICATIONS AND EMAIL

The only dispatcher found is `notifyOwner` in [`server/_core/notification.ts`](../server/_core/notification.ts), exposed by `system.notifyOwner`. It validates nonempty title/content, maximum lengths 1,200 and 20,000 characters, then POSTs to the Manus Notification Service using the optional Manus endpoint/key configuration. A failed upstream request logs a warning and returns `false`; missing configuration throws a tRPC internal error. No marketplace event calls this dispatcher.

No app email templates, transactional email provider integration, event-to-notification mapping, notification preferences, per-user caps/throttling, or dry-run switch were found. Supabase Auth email/password sign-in exists, but app-level lifecycle email behavior is **NOT VERIFIED**. No SMS implementation was found. Environment variable **names only** related to this subsystem: `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY`. Evidence: [`server/_core/notification.ts`](../server/_core/notification.ts), [`server/_core/systemRouter.ts`](../server/_core/systemRouter.ts), [`package.json`](../package.json).

## 8. SECURITY AND PRIVACY REVIEW

### Enforced server-side

- Bearer token validation with Supabase Auth occurs in `createContext`; protected procedures reject missing users. [`server/_core/context.ts`](../server/_core/context.ts), [`server/_core/trpc.ts`](../server/_core/trpc.ts).
- `requireOperationalRole` checks role allow-lists and rejects pending/suspended accounts except SuperAdmin where a procedure uses it. `account.updateProfile` does not use this guard and can reset a suspended Buyer to approved. [`server/authz.ts`](../server/authz.ts), [`server/routers.ts`](../server/routers.ts) (`account.updateProfile`).
- Listing queries require published + approved + visible; order/quotation requests validate listing state, stock/minimum, same-Seller bulk rule and self-transactions. [`server/db.ts`](../server/db.ts), [`server/routers.ts`](../server/routers.ts), [`server/marketplaceRules.ts`](../server/marketplaceRules.ts).
- Seller product updates include caller ownership; cooperative member-status update includes cooperative ID. [`server/routers.ts`](../server/routers.ts) (`products.update`, `cooperativeAdmin.updateMemberStatus`).
- UI role hiding exists but is not a substitute for the server controls. The app does **not** consistently enforce cooperative scoping on all Admin endpoints.

### Personal data and file privacy

Current `users` data includes name, email, Supabase identity ID (`openId`), login method, role, account approval, cooperative, contact number, address, and sign-in/creation/update timestamps. No birthdate, profile picture, government ID, selfie, or user verification submission field/table exists. Officers' cooperative overview returns member rows; platform Admin overview returns all user rows. Thus current admin query results can include email/contact/address, with broad Admin scope. [`drizzle/schema.ts`](../drizzle/schema.ts), [`server/db.ts`](../server/db.ts) (`getOfficerOverview`, `getAdminOverview`).

Only product imagery uses Supabase Storage in the current app, via the public default `product-images` bucket. Private `verification-docs` and `chat-images` use is absent. Signed URL generation defaults to 300 seconds when a private bucket is configured, but no endpoint performs owner/reviewer authorization before returning one. No data-retention/deletion schedule is implemented (**NOT IMPLEMENTED**). No verification consent text exists to quote. [`server/storage.ts`](../server/storage.ts), [`server/routers.ts`](../server/routers.ts).

### Weak spots requiring remediation

| Priority | File and lines | Finding |
|---|---|---|
| High | [`server/routers.ts`](../server/routers.ts#L214) | `account.updateProfile` accepts caller-supplied buyer/seller role and arbitrary cooperative ID for the current profile, and sets approval to `approved` whenever the caller selects buyer. A suspended account can therefore change itself to Buyer and clear its suspension; role assignment should be server-controlled. |
| High | [`server/routers.ts`](../server/routers.ts#L191), [`server/routers.ts`](../server/routers.ts#L196) | `conversations.create` and `conversations.send` require authentication but do not call `requireOperationalRole`; a suspended Buyer can continue creating support threads and sending messages. Suspension is therefore not a global block. |
| High | [`server/routers.ts`](../server/routers.ts#L430), [`server/db.ts`](../server/db.ts#L199) | Admin is the cooperative Officer role, but `admin.overview`, `admin.reviewProduct`, and `admin.updateUser` are platform-wide. Product review and user role/status/cooperative changes do not check the actor's cooperative. The Admin overview also returns all users and associated cooperative data. |
| High | [`server/routers.ts`](../server/routers.ts#L188) | tRPC message read/send permits buyer owner or global Admin/SuperAdmin, but not `sellerId`; Seller is excluded despite appearing as a thread participant. There is no participant table. Admin access is not cooperative-limited. |
| High | [`server/routers.ts`](../server/routers.ts#L400), [`server/db.ts`](../server/db.ts#L224) | Completion checks stock then decrements with an unconditional `stockQty - quantity` update. The check and decrement are not protected by a transaction/conditional update; concurrent completions can oversell, and multi-item completion can partially apply if an intermediate write fails. |
| Medium | [`server/routers.ts`](../server/routers.ts#L334), [`server/routers.ts`](../server/routers.ts#L377) | Quotation and order creation check listing status but do not re-check the Seller's current account approval status. A listing hidden from marketplace queries after Seller suspension may still be acted on through a direct mutation with its product ID. |
| High | [`supabase/rls.sql`](../supabase/rls.sql#L24), [`supabase/rls.sql`](../supabase/rls.sql#L44), [`drizzle/schema.ts`](../drizzle/schema.ts) | RLS is only a target SQL file, assumes `auth_user_id` and snake_case columns/tables not present in the current Drizzle schema, and is not a functioning enforcement layer for the live MySQL database. Several policies grant Admin/SuperAdmin broad access and do not encode cooperative scope or explicit conversation participants. |
| Medium | [`server/routers.ts`](../server/routers.ts#L160) | Public registration creates Auth accounts with `email_confirm: true`; email ownership is not confirmed by this flow. |
| Medium | [`server/routers.ts`](../server/routers.ts) | Product images are public by design. The signed upload flow now limits uploads to 5 MiB and JPEG/PNG/WebP; private documents would need a separate private bucket and ownership checks. |
| Medium | [`server/clients.ts`](../server/clients.ts#L3), [`server/_core/env.ts`](../server/_core/env.ts#L1) | Development retains localhost/dummy Supabase defaults; production startup now rejects missing database or Supabase variables before serving requests. |
| Medium | [`client/src/pages/Reports.tsx`](../client/src/pages/Reports.tsx#L13), [`server/routers.ts`](../server/routers.ts#L426) | CSV page is enabled only for role `admin`, while API overview also allows SuperAdmin; conversely Admin/Officer's report data is platform-wide rather than cooperative-scoped. |

## 9. ENVIRONMENT AND HOW TO RUN

### Tools and environment variable names

Required/optional judgments below describe current runtime/setup dependencies; variable values are deliberately omitted. Consult [`docs/ENVIRONMENT.md`](./ENVIRONMENT.md) for private local configuration instructions. Do not commit local environment files.

| Name | Purpose | Requirement |
|---|---|---|
| `DATABASE_URL` | MySQL connection for Drizzle runtime and migrations | Required for database-backed app/setup. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Auth client/server project URL; also used by storage | Required for Auth; Storage calls also require it. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser Supabase Auth client key | Required for browser Auth. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase admin Auth/storage client | Required for account creation, seed operations, and storage. Never expose to browser. |
| `DATABASE_SSL` / `DATABASE_SSL_CA` | Optional MySQL TLS configuration | Enable verified TLS when required by the database provider. |
| `PORT` | Preferred Express port; defaults to 3000 | Optional. |
| `NODE_ENV` | Selects Vite development server or production static serving | Optional; set appropriately for mode. |
| `SUPABASE_STORAGE_BUCKET` | Overrides default product image bucket name | Optional. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Alternate browser Supabase values read by `client/src/lib/supabase.ts` | Optional aliases for the `NEXT_PUBLIC_*` values. |
| `OWNER_OPEN_ID` | Optional owner identity used during account upsert | Optional. |
| `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY` | Optional server-side template integrations (notification, image/LLM/map/transcription helpers) | Not required for core marketplace; required only for those integrations. |
| `VITE_FRONTEND_FORGE_API_URL`, `VITE_FRONTEND_FORGE_API_KEY` | Optional browser map integration | Public configuration; restrict any key by origin. |
| `SEED_SUPERADMIN_1_EMAIL`, `SEED_SUPERADMIN_1_PASSWORD`, `SEED_SUPERADMIN_2_EMAIL`, `SEED_SUPERADMIN_2_PASSWORD`, `SEED_OFFICER_EMAIL`, `SEED_OFFICER_PASSWORD`, `SEED_BUYER_EMAIL`, `SEED_BUYER_PASSWORD`, `SEED_SELLER_EMAIL`, `SEED_SELLER_PASSWORD` | Five-account `seed:defaults` configuration | Required by that seed script, not ordinary app startup. |
| `SUPERADMIN_JOAN_PASSWORD`, `SUPERADMIN_EROL_PASSWORD` | Legacy `seed:superadmins` inputs | Required only for that separate script; its script also contains inline identity data. |

Names are sourced from [`docs/ENVIRONMENT.md`](./ENVIRONMENT.md), [`server/_core/env.ts`](../server/_core/env.ts), and `process.env`/`import.meta.env` references in runtime and seed code. No environment values are included here.

### Every package script

| Script | Command | Purpose |
|---|---|---|
| `dev` | `cross-env DOTENV_CONFIG_PATH=.env.local NODE_ENV=development tsx watch server/_core/index.ts` | Development Express + Vite server. |
| `build` | `vite build && esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist` | Build browser assets and bundled Express server. |
| `start` | `cross-env DOTENV_CONFIG_PATH=.env.local NODE_ENV=production node dist/index.js` | Run production build. |
| `check` | `tsc --noEmit` | TypeScript check. |
| `format` | `prettier --write .` | Formats repository files; do not run for a documentation-only task. |
| `test` | `vitest run` | Vitest suite. |
| `db:generate` | `drizzle-kit generate` | Generate a MySQL migration from schema changes. |
| `db:migrate` | `drizzle-kit migrate` | Apply committed MySQL migrations; do not use `drizzle-kit push`. |
| `seed:demo` | `cross-env DOTENV_CONFIG_PATH=.env.local tsx scripts/seed-demo.ts` | Legacy demo-data seed; separate from default five-account seed. |
| `seed:defaults` | `cross-env DOTENV_CONFIG_PATH=.env.local tsx scripts/seed-defaults.ts` | Default accounts and visible listing seed. |
| `seed:superadmins` | `tsx scripts/seed-superadmins.ts` | Separate SuperAdmin provisioning script. |

### Windows PowerShell setup

1. Install Node.js 22.x and enable Corepack. The package pins pnpm 10.4.1.
2. In PowerShell, enter the repository root and install dependencies:
   ```powershell
   Set-Location 'C:\Users\joana\Downloads\CAPSTONE\VSC\AgriCoop-Marketplace-Final-Capstone'
   corepack pnpm install
   ```
3. Start a local MySQL/MariaDB server. Create the database (matching the database name configured privately in `DATABASE_URL`):
   ```powershell
   mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS agricoop CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
   ```
4. Configure the required environment **names** and local secret values privately, using [`docs/ENVIRONMENT.md`](./ENVIRONMENT.md). Do not paste secret values into prompts or commit them.
5. Before applying migrations, back up the database:
   ```powershell
   mysqldump -u root -p agricoop --result-file=backup.sql
   ```
   Then apply committed migrations:
   ```powershell
   corepack pnpm db:migrate
   ```
6. To load the default five role accounts and crop catalog, configure all `SEED_*` variables privately and run:
   ```powershell
   corepack pnpm seed:defaults
   ```
   `seed:demo` is an alternative legacy demo dataset; do not mix it with defaults without first understanding the data it writes.
7. Start the app:
   ```powershell
   corepack pnpm dev
   ```
   The server logs its URL (normally port 3000; if busy, it searches later ports).
8. Production build/run:
   ```powershell
   corepack pnpm build
   corepack pnpm start
   ```

### Role demo click-through

Demo account credentials are not included here. Use locally configured seed accounts.

| Role | Suggested clicks |
|---|---|
| Buyer | Sign in → Marketplace → search/filter and price sort → open Product Details → request quotation or add to cart/place order → Activity → Support. |
| Seller/Farmer | Sign in → Dashboard → add harvest/listing → submit for review → after Admin approval inspect Marketplace → review incoming quotations/orders → confirm, mark ready, complete or cancel. |
| Admin/Officer | Sign in → Dashboard → inspect cooperative overview, members and product moderation → approve/reject listing or update member status → Reports. Note current report/admin procedures are not fully cooperative-scoped. |
| SuperAdmin | Sign in → Dashboard → inspect platform admin overview and user controls. The current order status procedure does not allow SuperAdmin, despite the intended platform-wide model. |

## 10. TESTS AND QUALITY

### Required checks run for this summary

| Command | Result |
|---|---|
| `corepack pnpm check` | **PASS** — `tsc --noEmit`, exit code 0. |
| `corepack pnpm test` | **PASS** — 7 test files, 16 tests passed, 0 failed. No failing test names. |

### Test inventory

| File | Tests | Coverage |
|---|---:|---|
| [`server/auth.logout.test.ts`](../server/auth.logout.test.ts) | 1 | Logout cookie clearing and cache header. |
| [`server/authz.test.ts`](../server/authz.test.ts) | 3 | Role inclusion, Seller order ownership helper, pending Admin approval. |
| [`server/cooperativeNames.test.ts`](../server/cooperativeNames.test.ts) | 3 | Cooperative normalization, duplicate key normalization, invalid names. |
| [`server/credentials.test.ts`](../server/credentials.test.ts) | 1 | Browser credential configuration behavior. |
| [`server/marketplaceRules.test.ts`](../server/marketplaceRules.test.ts) | 5 | Order preparation/total, same-Seller and stock/minimum constraints, transitions, quotation open status, self-trade, transaction status. |
| [`server/reportCsv.test.ts`](../server/reportCsv.test.ts) | 2 | CSV quoting/escaping and empty cells. |
| [`server/serverCredentials.test.ts`](../server/serverCredentials.test.ts) | 1 | Server credential configuration behavior. |

Important behaviors with **no direct test found**: actual tRPC authorization by procedure (including Seller/nonparticipant conversation access and Admin cooperative scope), database migrations/queries, concurrent stock completion/rollback, order/transaction integration, listing moderation endpoints, private storage and URL ownership, UTC/Manila formatting, report date output, notification dispatch, seed idempotence/statuses, and UI flows. Existing helper tests are not a substitute for these integrations.

## 11. LEFTOVER TEMPLATE CODE

| Template artifact | Current status |
|---|---|
| `vite-plugin-manus-runtime` | Removed from package dependencies and Vite configuration. |
| `.manus-logs` debug collector and `client/public/__manus__/debug-collector.js` | Removed; no browser log endpoint or filesystem debug logging remains. |
| Legacy `/manus-storage/*` proxy | Removed after the configured database had zero product/profile references; new uploads use Supabase signed uploads. |
| [`server/_core/notification.ts`](../server/_core/notification.ts) | Used by `systemRouter.notifyOwner`; calls Manus Notification Service. |
| [`server/_core/dataApi.ts`](../server/_core/dataApi.ts) | Not imported by active routers/server entry; no live call site found. Dead/unwired in current route graph. |
| [`server/_core/imageGeneration.ts`](../server/_core/imageGeneration.ts) | Contains Forge image-generation/list-model helpers and uses `storagePut`; no active route imports it. Dead/unwired. |
| [`server/_core/map.ts`](../server/_core/map.ts) | Manus/Google Maps proxy helper; no active server route imports it. Dead/unwired. |
| [`server/_core/voiceTranscription.ts`](../server/_core/voiceTranscription.ts) | Forge transcription helper; no active route imports it. Dead/unwired. |
| [`server/_core/heartbeat.ts`](../server/_core/heartbeat.ts), [`server/_core/llm.ts`](../server/_core/llm.ts) | Template helpers with Manus API configuration; no active app route/import call sites found. Dead/unwired. |
| [`client/src/components/AIChatBox.tsx`](../client/src/components/AIChatBox.tsx) | Referenced by [`client/src/pages/ComponentShowcase.tsx`](../client/src/pages/ComponentShowcase.tsx), which is not imported or routed in [`client/src/App.tsx`](../client/src/App.tsx); not reachable through active routes. |
| [`client/src/components/Map.tsx`](../client/src/components/Map.tsx) | Not imported by active app routes. |
| `client/src/components/ManusDialog.tsx`, `server/_core/types/manusTypes.ts` | Removed as unreferenced Manus-only artifacts. |
| AWS SDK S3 packages and Google Maps types | Unused template dependencies remain; live Supabase product-image upload uses `server/storage.ts`, not AWS S3. |

“Dead/unwired” means no code import/call path from the active app router/server entry was found in this repository scan; dynamic external invocation is **NOT VERIFIED**. Evidence: [`vite.config.ts`](../vite.config.ts), [`server/_core/index.ts`](../server/_core/index.ts), [`client/src/App.tsx`](../client/src/App.tsx), [`package.json`](../package.json).

## 12. GAPS AGAINST THE MANUSCRIPT

| Requirement | Result | Evidence-based comparison |
|---|---|---|
| Next.js + Supabase + Vercel stack | **DIFFERS** | Active app is React/Vite + Express/tRPC + Drizzle/MySQL. Supabase is used for Auth and Storage, not Postgres persistence; no active Next.js route tree is present. |
| Four roles and single sign-in with approval | **MATCHES** | Four DB roles and one `/auth` sign-in/registration page exist. Buyer is immediately approved; Seller/Admin are pending; SuperAdmin is not a public registration option. |
| Buyer access on sign-up | **MATCHES** | Buyer account registration assigns `approvalStatus: approved`. |
| Product listing with price sort and filter | **MATCHES** | Approved visible listings can be filtered by category/search and sorted by price ascending/descending. |
| Quotations | **MATCHES** | Request and Seller response/decline workflows are present; accepted/conversion behavior is not. |
| Regular and bulk orders | **MATCHES** | One item is regular; multiple items from one Seller are bulk. Current limits are minimum and stock, not configurable max quantity or max price. |
| Inventory deduction on completion | **MATCHES** | `orders.updateStatus` deducts order-item quantity on transition to completed after a stock check. Atomic concurrency protection and editable final quantities are absent. |
| Transaction records | **MATCHES** | Order submission creates a transaction; completion updates transaction status/note. It is a record, not payment processing. |
| Cooperative-scoped Officer monitoring | **DIFFERS** | `cooperativeAdmin.overview` is scoped, but `admin.overview`, listing review, conversation oversight, user updates, reports and order status changes are broad Admin procedures. |
| CSV reports | **MATCHES** | Sales, inventory, quotation, and transaction CSV exports exist; dates are not normalized to Manila time, and reports are not Officer-scoped. |
| Responsive layouts | **MATCHES** | React pages use responsive Tailwind breakpoints/layout classes. Formal visual/accessibility verification is **NOT VERIFIED**. |
| F2F-only payment | **MATCHES** | Order and transaction methods use `f2f`; no payment gateway workflow is present in active routes. |

Evidence: [`package.json`](../package.json), [`client/src/App.tsx`](../client/src/App.tsx), [`drizzle/schema.ts`](../drizzle/schema.ts), [`server/routers.ts`](../server/routers.ts), [`server/marketplaceRules.ts`](../server/marketplaceRules.ts), [`client/src/pages/Reports.tsx`](../client/src/pages/Reports.tsx).

## 13. SUPABASE POSTGRES MIGRATION PLAN

This is a plan only; no migration work was performed.

1. **Inventory and freeze the data contract.** Back up the current MySQL database, record table counts and constraints, and test a repeatable restore. Decide whether internal integer IDs remain stable or all relations move to UUIDs.
2. **Design the Postgres schema first.** Replace `mysqlTable` with `pgTable`; represent each MySQL enum as a named PostgreSQL enum or text plus check constraint; map integer auto-increments to identity columns; preserve unique indexes and all foreign keys. Prefer explicit snake_case names rather than retaining quoted camelCase.
3. **Convert timestamp semantics.** Use `timestamptz`; migrate existing values with an explicitly chosen interpretation; set database/session/application policy to UTC; replace MySQL `ON UPDATE` with explicit updates or Postgres triggers. Verify ordering and display at DST/offset boundaries.
4. **Switch Drizzle config and driver.** Add a Postgres driver package, change `drizzle.config.ts` dialect/credentials, update `server/db.ts` to a PostgreSQL Drizzle driver, replace MySQL-only `onDuplicateKeyUpdate` and result handling with `ON CONFLICT`/Postgres return semantics, and regenerate—not hand-edit—the Postgres migrations.
5. **Map local users to Supabase Auth.** Add a unique `auth_user_id UUID REFERENCES auth.users(id)` (or deliberately migrate `openId` into that field after UUID validation). Retain a stable internal app-user ID if that minimizes FK rewrites. Reconcile deleted/duplicate Auth identities and preserve roles/approval/cooperative assignments without trusting editable user metadata.
6. **Migrate data in dependency order.** Cooperatives → users → products → quotations → orders → order items → transactions → conversations → messages. Preserve PKs where selected, reset identity sequences, validate row counts, uniqueness, enum values, and foreign-key integrity.
7. **Implement and test RLS before production cutover.** Enable RLS on every table that the browser/API can reach. Add self-profile policies; public approved-listing read; Seller-owned listing writes; Buyer/Seller participant reads/writes; member and order visibility constrained to the actor's cooperative; explicit SuperAdmin platform policy; and separate moderation/update policies. Add a `conversation_participants` model before participant policies. Add Storage policies for public product images and owner/reviewer-only private files. The current Express/Drizzle service connection must not silently bypass the intended policy: either apply user JWT claims in a transaction-scoped Postgres connection or keep privileged access server-only with complete, tested procedure authorization and do not expose direct table access.
8. **Update seed and integration tests.** Rework scripts for Postgres/identity mapping, remove credential/identity literals from source, make seeds repeatable, and test all roles against real RLS sessions, not only service-role connections.
9. **Cut over in staging.** Run dual-read comparisons or a controlled downtime export/import, validate order totals/stock and auth mapping, exercise image URLs and conversation polling, then switch `DATABASE_URL`/deployment configuration. Keep a rollback snapshot until validated.

Principal risks: integer IDs and Supabase Auth UUIDs can be mismatched; MySQL enum/default/`ON UPDATE` behavior differs; quoted camelCase names can break policies; MySQL `ON DUPLICATE KEY` result shapes differ; timestamps can shift; service-role database access bypasses RLS; policy leakage can expose PII or conversations; migration must preserve order-item/transaction relationships and unique order transaction constraints. `supabase/rls.sql` is a draft baseline and does not currently match the live schema.

## 14. MANUSCRIPT UPDATE LIST

The checked-in Typst manuscript sources are [`docs/generated/agricoop-documentation/main.typ`](./generated/agricoop-documentation/main.typ) and [`docs/generated/agricoop-complete-manual/main.typ`](./generated/agricoop-complete-manual/main.typ). Their generated PDFs are derivative artifacts and must be rebuilt after source edits. The shorter source has headings but no explicit `#figure` declarations found; the list below maps current sections/tables rather than assuming numbered chapter labels.

### Main project documentation

| Existing heading/table | Required correction/addition |
|---|---|
| Development process; Executive summary; Product purpose and problem statement; Intended users table | State which requirements were implemented versus proposed, and the current scope, four runtime roles and terminology mapping (`admin` = Officer), F2F record-only behavior, and absent verification/monitoring features. |
| Current technology stack table | Replace any Next.js/Supabase Postgres/Vercel-as-current wording with React/Vite, Express/tRPC on a Vercel Function, MySQL/Drizzle, Supabase Auth/Storage, and conversation polling. |
| System architecture: Current runtime architecture / Native migration architecture | Correct active request flow and distinguish the proposed Postgres/Next architecture from current code; include the public product bucket and serverless polling behavior. |
| Data model and persistence: Main entities / Database migrations | Replace any participant/audit/evidence entities described as present; list the nine actual tables and the seven actual migrations. |
| Authentication and authorization: Registration, Authorization layers, Role matrix table | Document `email_confirm: true`, Buyer approved vs Seller/Admin pending, SuperAdmin registration/procedure exceptions, self-editable role/cooperative field, and current non-scoped Admin endpoints. |
| Public user experience / Seller workflow / Buyer workflow | Add actual routes and distinguish implemented UI from missing profile, user verification, image compression, bulk price negotiation, and accepted quotation conversion. |
| Payment and transaction policy | Clarify transaction completion timestamp default occurs on row creation; actual online transfer/card processing is absent. |
| Conversations and real-time support | Correct Seller tRPC read/send mismatch; explain no participants table, no three-party Officer inclusion, five-/ten-second tRPC polling, and no message types besides text. |
| Administration, moderation, and reporting | Explain cooperative overview scope vs global `admin.overview`, global product review/user updates, CSV page role mismatch, and no audit events. |
| Demo data and defense preparation | Verify role seed claims against `seed-defaults.ts`; state default accounts are application-approved and listings approved/visible, but no user verification or monitoring acknowledgement exists. Do not include account email/password values. |
| Security and privacy considerations | Replace broad assurance with Section 8 findings: public listing bucket, no private KYC/chat uploads, no retention, RLS not active/mismatched, PII reachability, and role/scope gaps. |
| Testing and quality assurance table | Update from older counts to the fresh result: 7 test files / 16 passing tests, and list uncovered endpoint/integration behaviors. |
| Deployment and operations; File and directory guide | Remove references to non-existent active Next app/deployment scripts if still present; document actual Windows commands/scripts and MySQL requirement. |
| End-to-end scenario walkthroughs | Correct current behavior: stock is deducted at completion (not order placement); no pickup schedule field, final quantity editor, order event trail, third-party chat member, or verification gate. |
| Limitations and future roadmap; Glossary; Conclusion | Convert claimed completed features to actual status and add verification, auditing, scoped moderation/reporting, Postgres cutover, UTC/Manila display, and evidence limitations. |
| Existing tables: intended users (source around line 64), stack (102), role matrix (196), tests (360), directory guide (431), glossary (495) | Revise each table to current evidence; add tables for the actual schema, procedure authorization, environment names without values, and prioritized gaps. |
| Figures | No explicit figure declarations were found in the checked-in main Typst source. Existing figure list is therefore **NOT VERIFIED / none found**; any architecture/screenshots in external manuscript versions must be checked manually. |

### Complete manual appendices

Update the same topics wherever repeated in [`docs/generated/agricoop-complete-manual/main.typ`](./generated/agricoop-complete-manual/main.typ): “Complete route and screen map” (no `/profile`; reports UI only Admin), Buyer/Seller/Admin/SuperAdmin playbooks, Product/Quotation/Order/Transaction/Conversation lifecycle sections, “Exact business rules and validation checklist,” “API and procedure reference,” “Data dictionary and relationships,” defense-demo walkthroughs, troubleshooting, “Current implementation versus final target,” “Document control and maintenance,” and the continuation/logout/role-registration updates. Revise the route map table, role matrix, validation checklist, API table, data dictionary, implementation-vs-target table, and historical verification-evidence tables; mark past test results as historical rather than current. Add the distinctions between Admin/Officer and SuperAdmin, product-only approval versus absent ID verification, absent three-party chat/monitoring acknowledgement/audit log, no user notifications/email, no transaction ratings/reference prices/pickup schedule, and the current stack wording. The external submitted manuscript and its exact page/figure numbering are **NOT VERIFIED** from this repository; compare the generated source and submitted PDF before defense revisions.

## 15. KNOWN ISSUES AND OPEN QUESTIONS

Prioritized by likely impact on marketplace correctness, privacy, and defense claims:

1. **Suspended accounts can self-reactivate.** A suspended account can call `account.updateProfile` with role `buyer`; the procedure writes `approvalStatus: approved`. Remove caller control of role/status. [`server/routers.ts`](../server/routers.ts) (`account.updateProfile`).
2. **Admin scope contradicts cooperative Officer model.** Can an Officer really see/change all cooperatives? If not, add cooperative checks to listing review, user management, order status, conversation oversight, and report data. [`server/routers.ts`](../server/routers.ts) (`admin.*`, `orders.updateStatus`).
3. **Conversation access is inconsistent.** Seller threads appear in their list but `messages`/`send` reject them. Decide the explicit participant model and enforce it uniformly. [`server/routers.ts`](../server/routers.ts).
4. **Completion inventory is race-prone and non-atomic.** Use a transaction/conditional stock decrement and test simultaneous completion and rollback, including repeated product IDs in one request. [`server/routers.ts`](../server/routers.ts) (`orders.updateStatus`, `orders.create`), [`server/db.ts`](../server/db.ts) (`decrementProductStock`).
5. **Suspension is not consistently enforced.** A Buyer can self-reactivate through profile update, and conversation create/send checks authentication but not operational approval. Quotation/order mutations also fail to re-check the Seller's account approval; decide which actions suspension must block. [`server/routers.ts`](../server/routers.ts) (`account.updateProfile`, `conversations.create`, `conversations.send`, `quotations.request`, `orders.create`).
6. **Privacy features in the requested manuscript are not implemented.** There is no KYC/ID/selfie workflow, user verification gate, consent, notice acknowledgement, retention policy, private document bucket, or review queue. Do not claim these are operational.
7. **RLS file cannot be applied as-is to the current schema/runtime.** It assumes different identifiers and Auth mapping; decide the exact Postgres schema and how the Express connection will respect RLS. [`supabase/rls.sql`](../supabase/rls.sql), [`drizzle/schema.ts`](../drizzle/schema.ts).
8. **Orders lack final quantity edit and event history.** No transparent record of actor/status changes exists; also decide whether an Admin or Seller is the final confirming authority. [`drizzle/schema.ts`](../drizzle/schema.ts) (`orders`, `orderItems`), [`server/routers.ts`](../server/routers.ts) (`orders.updateStatus`).
9. **Bulk/quotation commercial terms are ambiguous.** Bulk total always uses listing price; no min/max price range or max quantity exists. Seller quote input says “Total PHP quote” but is displayed as per-unit; accepted quotations do not create orders. [`Dashboard.tsx`](../client/src/pages/Dashboard.tsx), [`marketplaceRules.ts`](../server/marketplaceRules.ts), [`routers.ts`](../server/routers.ts).
10. **Dates and report exports can mislead.** No UTC policy or Manila formatter; report date fields are raw string output; transaction `completedAt` is set when transaction is inserted. [`drizzle/schema.ts`](../drizzle/schema.ts), [`Reports.tsx`](../client/src/pages/Reports.tsx), [`Support.tsx`](../client/src/pages/Support.tsx).
11. **Product image policy misses the stated storage budget.** Client upload allows 8 MB and does not resize/compress; only one public image is stored. Decide compression dependency/canvas approach and a strict pre-compression cap. [`Dashboard.tsx`](../client/src/pages/Dashboard.tsx), [`routers.ts`](../server/routers.ts) (`products.uploadImage`).
12. **No route-level tests cover most authorization and sensitive workflows.** Add tests for own-cooperative restrictions, nonparticipant reads/sends, role/approval mutation, storage ownership, and privacy gating before defense claims rely on them. [`server/*.test.ts`](../server/).
13. **Optional template-service dependencies remain.** Notification and other Forge integrations still need their server-only variables if used; the Manus runtime/debug collector and legacy storage proxy have been removed. [`server/_core/notification.ts`](../server/_core/notification.ts), [`vite.config.ts`](../vite.config.ts).
14. **Manual and generated docs are stale in important places.** One generated source describes placement-time stock deduction, but current code deducts on completion; other procedure/role claims also differ. Which exact external PDF/version will be submitted is **NOT VERIFIED**.

### HANDOFF CHECKLIST

- **Repository / branch:** `HEYY-EJAYY/AgriCoop-Marketplace-Final-Capstone`, branch `pre-manus-baseline` at inspection. No commit was made.
- **Keep:** current role/approval checks, product moderation states, marketplace validation, F2F-only scope, existing MySQL migrations (do not rewrite historical SQL), and the scoped change history. Back up the database before schema work.
- **Change deliberately:** cooperative scoping and tRPC conversation access first; atomic inventory completion; explicit order events/final quantities; missing user verification and private-file ownership if still required; UTC/Manila reporting; then Postgres/RLS cutover and documentation regeneration. Add procedure/integration tests alongside each change.
- **Never put in a prompt, issue, commit, screenshot, or generated document:** `.env` contents, passwords, access/service-role keys, bearer/refresh tokens, private signed URLs, database URLs, or seed account email addresses. Share environment variable **names only** unless a secure secret-management channel is explicitly provided.
- **Files most needing review:** [`drizzle/schema.ts`](../drizzle/schema.ts), [`server/routers.ts`](../server/routers.ts), [`server/authz.ts`](../server/authz.ts), [`server/db.ts`](../server/db.ts), [`server/_core/context.ts`](../server/_core/context.ts), [`server/_core/index.ts`](../server/_core/index.ts), [`server/realtime.ts`](../server/realtime.ts), [`server/storage.ts`](../server/storage.ts), [`supabase/rls.sql`](../supabase/rls.sql), [`client/src/pages/Dashboard.tsx`](../client/src/pages/Dashboard.tsx), [`client/src/pages/Support.tsx`](../client/src/pages/Support.tsx), [`client/src/pages/Reports.tsx`](../client/src/pages/Reports.tsx), [`docs/ENVIRONMENT.md`](./ENVIRONMENT.md), and both Typst `main.typ` sources under `docs/generated/`.
