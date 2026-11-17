# AgriCoop Marketplace — Platform Guide

**Production site:** [agricoop-marketplace-final-capstone.vercel.app](https://agricoop-marketplace-final-capstone.vercel.app)  
**Last checked:** 2026-10-26  
**Audience:** users, cooperative officers, administrators, developers, and project reviewers

This guide documents the deployed application as it is implemented in this repository. It describes current behavior and names the main code locations so the guide can be checked against the source. It is not a promise that every external service or account-specific workflow has been manually tested.

## 1. What the site is for

AgriCoop is a cooperative-centered marketplace for agricultural produce. Buyers can discover listings, ask for a quotation, and submit an order to a farmer. Sellers manage products and respond to orders. Cooperative Admin Officers review members and product listings, oversee orders, and export operational reports. SuperAdmins administer the platform across cooperatives.

Orders are coordinated for **face-to-face payment and handover**. The application records payment method, status, and reference notes; it does not collect money or call a payment gateway.

The public landing page describes the service and links into the marketplace. Authentication, approval checks, order processing, messaging, and reporting are handled by the same application.

## 2. Main pages and routes

Routes are registered in `client/src/App.tsx` using Wouter.

| Route | Page | Who uses it | Purpose |
|---|---|---|---|
| `/` | `client/src/pages/Home.tsx` | Everyone | Site introduction and links to marketplace and guide pages |
| `/about` | `client/src/pages/About.tsx` | Everyone | Describes the cooperative marketplace process |
| `/auth` | `client/src/pages/Auth.tsx` | Everyone | Sign in, register, and request a password reset |
| `/reset-password` | `client/src/pages/ResetPassword.tsx` | Password recovery | Set a new password from a Supabase recovery session |
| `/marketplace` | `client/src/pages/Marketplace.tsx` | Everyone can browse; approved roles can transact | Search/filter/sort listings, add items to a one-seller cart, request quotes, submit orders |
| `/products/:id` | `client/src/pages/ProductDetails.tsx` | Everyone can view; approved roles can transact | Product details, quantity, total, and direct order action |
| `/activity` | `client/src/pages/Activity.tsx` | Signed-in Buyer, Seller, Admin, SuperAdmin | View outgoing orders and quotations; cancel eligible orders |
| `/dashboard` | `client/src/pages/Dashboard.tsx` | Signed-in users | Role workspace, seller fulfillment, buyer activity, or administration |
| `/support` | `client/src/pages/Support.tsx` | Signed-in users | Start and continue order, quotation, and general support conversations |
| `/reports` | `client/src/pages/Reports.tsx` | Admin and SuperAdmin | Download CSV reports within the caller’s authorized scope |

Unknown routes render `client/src/pages/NotFound.tsx`.

## 3. User roles and access

Role checks are enforced in server procedures, not only by hiding buttons. The main authorization rules live in `server/authz.ts`; procedures live in `server/routers.ts`.

### Buyer

- Buyer registration is approved immediately by the current registration procedure.
- Browse published, visible, approved listings from approved sellers.
- Search listing name/category/seller/cooperative, filter by category, and sort price ascending or descending.
- Request a quotation, accept or decline a seller response, then order at the accepted quoted price and quantity.
- Submit a regular order or a multi-product bulk order to one seller.
- Review order/quotation status, cancel an eligible order, and message the seller/support in the linked thread.

### Seller / Farmer

- Registration may choose individual seller or cooperative member. Cooperative sellers may select an active cooperative or enter a new name; duplicate names are normalized and reuse the existing cooperative.
- Seller registration is pending until approved.
- Create, edit, submit, and archive listings; seller uploads use signed Supabase Storage URLs.
- Review incoming quotations and reply with a unit price or decline.
- Confirm an order and mark it ready. The Seller UI does not offer order completion or cancellation.
- A Seller can also shop from other Sellers’ listings; self-orders and self-quotations are rejected.
- Coordinate pickup/payment in the order conversation.

### Cooperative Admin Officer (`admin` role)

- Public registration creates a pending Admin Officer account; a SuperAdmin must approve it.
- Admin access is scoped to the assigned cooperative for member management, product moderation, order oversight, and reports.
- Approve/suspend eligible members and approve/reject Seller product submissions.
- Review cooperative orders. Complete ready orders by entering final delivered quantities; cancel active orders when needed.
- The Admin workspace includes “Shop as buyer” and “Manage as seller” modes. These actions continue to use the Admin’s own application user record and remain subject to the server’s operation guards.
- Admins can read and reply to unassigned general support threads and threads associated with Sellers in their cooperative.

### SuperAdmin

- SuperAdmin is not offered as a public registration role. Accounts are created through the private seed/admin process.
- Can manage platform users/cooperatives, oversee all marketplace orders and conversations, and export platform-wide reports.
- Can use buyer and seller workspace modes.

Approval and cooperative checks are implemented through `requireOperationalRole`, `canUpdateCooperativeUser`, `canManageCooperativeResource`, `canAccessOrderForCooperative`, and `canUpdateOrderStatus` in `server/authz.ts`, with calls in `server/routers.ts`.

## 4. Authentication and profile mapping

The browser signs in with Supabase Auth using `supabase.auth.signInWithPassword` in `client/src/pages/Auth.tsx`. Password reset uses Supabase Auth’s reset-email and password-update methods in `Auth.tsx` and `ResetPassword.tsx`.

The server validates the bearer access token with `supabaseAdmin.auth.getUser(token)` in `server/_core/context.ts`. The returned Supabase Auth UUID is matched to `agricoop_app.users.openId`. Role, approval status, and cooperative assignment come from that application profile. If Auth succeeds but no profile row exists, protected application operations do not acquire an application role; the dashboard shows a contact-administrator message.

The browser uses only the Supabase public URL and anon key. The service-role key is used on the server for Auth administration and signed Storage uploads and must not be exposed to client code.

## 5. Buyer ordering and quotation journeys

### Direct order

1. Browse `/marketplace` or open `/products/:id`.
2. Choose quantity. Quantity must meet the listing’s minimum and stay within current stock.
3. Submit the order. A one-product order is `regular`; an order containing multiple distinct product lines is `bulk`.
4. Bulk cart lines must belong to one Seller. The server independently checks seller consistency, minimum quantities, listing visibility, seller approval, and stock.
5. The server locks the product rows in stable order, subtracts quantities held by open orders from available stock, then creates the order, item rows, initial F2F transaction record, stock-reservation event, and order conversation in one database transaction. On-hand stock is unchanged at placement.
6. Seller confirms and marks ready. The Buyer sees the updated status and can coordinate through the conversation.
7. An Admin Officer or SuperAdmin completes the order with final delivered quantities or cancels it. Cancellation releases the open-order stock reservation; completion deducts the actual delivered quantities. The server validates cooperative scope and legal status transitions.

Order rules are in `server/marketplaceRules.ts`; API behavior is in `orders.create` and `orders.updateStatus` in `server/routers.ts`.

### Quotation

1. Buyer requests a quote from an available listing. The server rejects self-quotations and checks seller approval, requested minimum, and stock.
2. The quotation and its product conversation are created atomically.
3. Seller responds with a PHP unit price and optional note, or declines. Response state and the Seller’s message are written in one transaction. Declined quotations do not keep a dummy price.
4. Buyer accepts or declines the response. That status and Buyer message are written together.
5. An accepted quotation can be turned into an order only for the same Buyer, product, and requested quantity; the accepted unit price is used.

API procedures are `quotations.request`, `quotations.respond`, and `quotations.decide`, plus `orders.create` for the accepted quote order.

## 6. Seller listings and images

Product records include seller/cooperative IDs, name, category, variety, description, unit, unit price in cents, stock, minimum order quantity, quality grade, publication status, verification status, visibility, rejection reason, and primary image URL. The canonical definitions are in `drizzle/schema.ts` (`products`).

New listings are submitted for review. Admin product review changes verification state and visibility; a product must be published, approved, visible, and owned by an approved Seller to appear in the public marketplace query (`getMarketplace` in `server/db.ts`). Sellers can edit their own products and archive their own listings.

Image upload path:

1. The authenticated Seller requests an upload ticket from `products.uploadImage`.
2. The server returns a signed upload token and public URL using `server/storage.ts`.
3. The browser uploads image bytes directly to the `product-images` Supabase Storage bucket.
4. The resulting URL is saved as `primaryImageUrl` with the listing.

Accepted types are JPEG, PNG, and WebP; maximum size is 5 MiB. The browser never receives the service-role key.

## 7. Orders, inventory, and transactions

Order statuses are `submitted → confirmed → ready → completed` or `cancelled`, with cancellation permitted only where the transition rules allow it. Seller confirmation/readiness are distinct from Admin completion.

Order placement and completion use Drizzle transactions in `orders.create` and `orders.updateStatus`:

- At placement, lock products in stable ID order, count quantities held by `submitted`, `confirmed`, and `ready` orders, reject quantities beyond the remaining availability, and persist the order plus its conversation and stock-reservation event atomically.
- At completion, lock the order, items, and products and verify the actor and transition;
- require one final delivered quantity for every order item;
- re-check current stock while holding product locks;
- deduct final delivered quantities with a guarded update (`stockQty >= quantity`);
- update order item quantities and recompute the order total from the final quantities;
- mark the order completed and upsert the transaction record;
- write the order event and post a completion message into its conversation.

Marketplace and product-detail stock display subtracts quantities held by open orders. Cancelled orders release that logical reservation without changing on-hand stock; legacy orders without a reservation remain subject to the completion-time physical stock check. Initial order placement records F2F coordination; completion updates the final amount and completion time. This is recordkeeping, not payment processing.

## 8. Conversations and live refresh

Conversation rows can reference Buyer, Seller, product, order, and/or quotation. The Admin is not stored as a third `conversation.participantId`; Admin/SuperAdmin access is granted by server-side rules. This allows an Admin to join an order or quotation thread while keeping the schema’s buyer/seller ownership fields.

`conversations.mine`, `conversations.messages`, `conversations.create`, and `conversations.send` are the tRPC procedures. Order/quotation state changes append system-readable messages using the actor’s application user ID. The Support page is `client/src/pages/Support.tsx`.

The deployed app uses short polling, not SSE or Supabase Realtime. Conversation list/messages refresh every 2.5 seconds; order, quotation, and admin overview views also poll so status changes show without a manual reload. Vercel serverless functions are not held open for long-lived event streams.

## 9. Admin tools and reports

The Admin workspace is `AdminDashboard` in `client/src/pages/Dashboard.tsx`. It uses `admin.overview`, `admin.updateUser`, and `admin.reviewProduct` to manage scoped users, listing reviews, order completion, and cooperative setup. The `cooperativeAdmin` router also exposes cooperative overview, order detail, and member status procedures.

`client/src/pages/Reports.tsx` reads the server-scoped `admin.overview` result and builds CSV files in the browser. Reports cover:

- orders;
- inventory/listings;
- quotations;
- transactions.

Admin report data is limited to the assigned cooperative; SuperAdmin data is platform-wide. CSV quoting/escaping is centralized in `shared/reportCsv.ts`.

## 10. Frontend, API, and hosting architecture

### Frontend

- React 19 + TypeScript + Vite.
- Wouter handles page routes.
- Tailwind CSS 4 and local shadcn-style components provide the visual system.
- tRPC React hooks connect screens to the API; TanStack Query caches and polls results.
- `client/src/main.tsx` initializes Supabase, tRPC, and query state. The Authorization header is read from the current Supabase session for each request.

### Backend

- Express 4 application created in `server/_core/app.ts`.
- tRPC 11 procedures defined in `server/routers.ts` and mounted at `/api/trpc`.
- On Vercel, `api/index.ts` exports the Express application as a serverless function. `vercel.json` routes `/api/*` to it and sends other paths to the SPA.
- Server-side validation uses Zod. Authorization is checked inside procedures; frontend role-specific screens are not the security boundary.

### Database and files

- Supabase Postgres, connected through the transaction pooler on port 6543.
- Drizzle ORM with `postgres-js` and `prepare: false` (`server/db.ts`).
- Application tables are in schema `agricoop_app`, defined by `drizzle/schema.ts` and `drizzle-postgres/0000_approved_schema.sql`.
- The schema contains 10 tables: `cooperatives`, `users`, `products`, `quotations`, `orders`, `orderEvents`, `orderItems`, `transactions`, `conversations`, and `conversationMessages`.
- RLS is enabled without browser policies on these application tables. Application SQL uses the server’s database connection; role/cooperative authorization is enforced in the server procedures.
- Product files use Supabase Storage.

## 11. Data model at a glance

| Table | Responsibility |
|---|---|
| `cooperatives` | Cooperative names, normalized names, locations, and active status |
| `users` | Application profile mapped from Supabase Auth UUID; role, approval, verification, and cooperative assignment |
| `products` | Seller listings, price/unit, stock/minimum, image, moderation, and visibility |
| `quotations` | Buyer request, quantity, Seller price/note, status, and response timestamps |
| `orders` | Buyer/Seller/cooperative, order type/status, total, F2F fields, and completion time |
| `orderItems` | Product quantities and locked-in per-unit prices for an order |
| `orderEvents` | Actor and status-change history |
| `transactions` | One traceable payment-coordination record per order |
| `conversations` | Thread ownership and links to product/order/quotation |
| `conversationMessages` | Thread messages and sender profile IDs |

Money amounts are stored as integer cents. UI/report formatting converts cents to PHP display strings.

## 12. Local development and validation

Use Node 22.x (the version declared in `package.json`) and the pinned pnpm package manager. Configure `.env.local` privately using `docs/ENVIRONMENT.md`; never paste database URLs, service-role keys, or seed passwords into the repository or browser variables.

```bash
corepack pnpm install
corepack pnpm dev
corepack pnpm check
corepack pnpm test
corepack pnpm build
```

The Vercel production build runs `corepack pnpm build`. Production server values are configured in Vercel Project Settings → Environment Variables. Keep `DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` server-only. The browser requires only the public Supabase URL and anon key.

### Seed script note

`scripts/seed-defaults.ts`, `scripts/seed-demo.ts`, and `scripts/seed-superadmins.ts` are privileged seed tools and are not part of normal app startup. Their target guards do not validate the database host, and the scripts can modify Auth identities and application data. Do not run any seed script against production; verify both the database and Supabase project target before any authorized local seed.

## 13. Current implementation limits

- Checkout supports cash handover and manual GCash QR/proof submission with Admin/SuperAdmin review. No automatic payment processor, card processing, Maya/GoTyme/QRPh integration, or payment webhook is active.
- Messaging uses bearer-authenticated SSE plus database polling fallback. The SSE broker is process-local and cannot guarantee cross-instance delivery on Vercel; persistent messages are fetched through database polling.
- The order basket is browser state and is not a persisted cart. Leaving/reloading the marketplace can clear an unsubmitted basket.
- Bulk classification is based on multiple distinct product lines from one Seller. Server rules enforce each product’s minimum quantity and available stock; there is no separate average-ground price calculation in the current `priceOrderItems` function.
- TypeScript, unit tests, production builds, and public live endpoints have been checked. A full production smoke test that signs in as each real seeded role and creates/cancels/completes live sample records must be run using authorized test accounts; this guide does not claim that every account-specific action has been exercised in production.

## 14. Source map

| Area | Main files |
|---|---|
| Frontend routes/layout | `client/src/App.tsx`, `client/src/components/AgriShell.tsx` |
| Auth/profile hook | `client/src/pages/Auth.tsx`, `client/src/pages/ResetPassword.tsx`, `client/src/_core/hooks/useAuth.ts` |
| Marketplace and product pages | `client/src/pages/Marketplace.tsx`, `client/src/pages/ProductDetails.tsx` |
| Role workspaces | `client/src/pages/Dashboard.tsx`, `client/src/pages/Activity.tsx`, `client/src/pages/Reports.tsx` |
| Conversations | `client/src/pages/Support.tsx`, `server/routers.ts`, `server/db.ts` |
| API and auth context | `server/_core/app.ts`, `server/_core/context.ts`, `server/routers.ts`, `server/authz.ts` |
| Business rules and persistence | `server/marketplaceRules.ts`, `server/db.ts`, `drizzle/schema.ts` |
| Storage | `server/storage.ts`, `client/src/lib/productImages.ts` |
| Tests | `server/*.test.ts`, `server/_core/*.test.ts` |
| Vercel deployment | `api/index.ts`, `vercel.json`, `DEPLOY.md` |
