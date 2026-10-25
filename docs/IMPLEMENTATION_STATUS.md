# AgriCoop: implementation status

**Status reviewed:** 25 October 2026
**Purpose:** A practical inventory of what the checked-in application currently does, what is only partly present, and what still needs implementation or a deployment decision. This document describes the code in this repository; a feature is not considered production-tested just because the UI or API exists.

## At a glance

| Area | Status | Current state |
|---|---|---|
| Public website and boxed home hero | Implemented | Home, About, marketplace, product detail, sign-in/registration, and support pages are routed in the React app. The home hero now keeps its image inside a rounded, centered panel. |
| Identity and application accounts | Implemented with limits | Supabase Auth handles sign-in. The app keeps role, approval, and cooperative records in MySQL. Public registration offers Buyer, Seller/Farmer, and Admin Officer; SuperAdmin is provisioned separately. |
| Product discovery | Implemented | Public listings can be searched, category-filtered, and price-sorted. Only published, approved, visible listings owned by approved Sellers should be returned by the main marketplace query. |
| Seller catalog and images | Implemented | Approved Sellers manage listings and stock; product images upload directly to Supabase Storage using short-lived signed upload tokens. |
| Product moderation | Implemented | A cooperative Admin Officer can review products in their cooperative; SuperAdmins can act across the platform. |
| Quotations | Implemented | Buyers request a quote; Sellers respond or decline; Buyers accept/decline a response and can order at the accepted quoted price and quantity. |
| Orders and fulfillment | Implemented | Regular and same-Seller multi-product orders, status transitions, final delivered quantities, transactional stock deduction, and order events are supported. |
| Payment | Deliberately not an online feature | The app records face-to-face payment/handover coordination and optional notes. It does not charge cards, transfer funds, or integrate a payment gateway. |
| Conversations | Implemented with polling | Support threads and messages are stored in MySQL and refreshed through tRPC polling (messages every 5 seconds; thread list every 10 seconds). |
| CSV reports | Implemented | Admin Officer and SuperAdmin reporting screens export sales, inventory, quotation, and transaction CSVs. |
| User identity verification | Partial | MySQL fields and server procedures exist to submit/review profile verification data, but the current client has no verification submission/review workflow. This is not a working ID/selfie verification product. |
| Vercel integration | Implemented in repository; deployment access not verified | `api/index.ts`, `vercel.json`, and `DEPLOY.md` provide the function adapter and deployment setup. The supplied Vercel URL redirected to Vercel SSO when checked, so a public deployment was not confirmed. |
| Production database readiness | Not fully verified | A guarded user-profile migration and migration command exist. The full migration chain has not been tested against an isolated empty MySQL database from this environment, and no production migration was applied. |
| Full end-to-end workflow tests | Incomplete | Typecheck, unit tests, build, and limited local production smoke checks passed. Auth registration, upload, quotation, order, and completion have not all been exercised end-to-end against a disposable deployment/database. |

## Implemented features

### Website and navigation

- A responsive public website with Home and About pages.
- Public marketplace browsing, product details, search, category filters, and price sort.
- Account registration/sign-in page backed by Supabase Auth.
- Buyer, Seller/Farmer, and administrative workspaces selected by local MySQL role.
- Support inbox, activity screens, and CSV report page.
- A centered, bounded home hero image intended to prevent the previous right-edge overflow/overlap.

### Accounts and role handling

- Supabase validates the user's bearer token for API requests.
- MySQL stores the local account profile, role, approval state, and cooperative assignment.
- Buyers register as approved. Seller and Cooperative Admin Officer registrations are pending approval; public registration does not offer SuperAdmin.
- Sellers can register as an individual or cooperative member. A cooperative can be selected or entered by name.
- Operational procedures reject unauthenticated users, disallowed roles, and non-SuperAdmin users who are pending or suspended.
- Admin Officers manage within their assigned cooperative in the scoped procedures; SuperAdmins can operate platform-wide.

**Important limitation:** account creation currently marks the Supabase email as confirmed. The app does not provide a separate email ownership-confirmation workflow. Identity/profile verification is separate from role approval and is not exposed as a complete user-facing feature.

### Product and image management

- Sellers create product entries with category, variety, description, unit, price, stock, minimum order quantity, quality grade, and optional image.
- New or resubmitted products are hidden while awaiting cooperative review.
- Admin Officers review products for their cooperative; SuperAdmins can review platform-wide. Approval makes the listing visible; rejection keeps it hidden and records a reason.
- Sellers can edit their own products, update stock/details, resubmit rejected products, and archive listings.
- Image types are JPEG, PNG, and WebP, limited to 5 MiB. Browser uploads use short-lived Supabase signed upload tokens; the service-role key remains server-side.
- Product image bucket is public because approved marketplace images are public content.

### Quotations and orders

- Buyers (and operational Seller accounts acting as marketplace participants) can request a quotation for an available listing.
- A Seller can respond with a unit price and optional note or decline the request.
- The requester can accept or decline a response. An accepted quote can be converted to an order for the quoted product and requested quantity at the quoted unit price.
- Orders can contain one or more products from the same Seller. The app rejects mixed-Seller baskets, quantities below the listing minimum, and quantities above current stock.
- Orders progress through submitted, confirmed, ready, and completed, or can be cancelled before terminal completion.
- Sellers can confirm and mark their orders ready. Completing or cancelling is reserved for the Seller's cooperative Admin Officer or a SuperAdmin.
- At completion, an Officer enters final delivered quantities. The server validates them and deducts inventory within a database transaction; zero delivered quantity is allowed for an individual line, but at least one line must be greater than zero.
- Order status changes are recorded in order events.
- Payment is F2F. A transaction record/optional reference note records coordination; this is not payment processing or proof that funds were transferred.

### Conversations, reports, and storage

- The support page allows signed-in users to create inquiries and read/reply to accessible threads.
- Order and quotation activity creates related support threads.
- Messages and threads are persisted in MySQL, with client polling suitable for Vercel's serverless request model.
- Officer reports are scoped by cooperative; SuperAdmin reports are platform-wide.
- CSV exports cover transaction/sales, inventory, quotations, and transactions.
- The legacy Manus storage proxy and debug collector have been removed.

## Partial, missing, or not verified

### Features not implemented as complete workflows

- **User ID/profile verification:** schema fields and `submitVerification`/`reviewVerification` server procedures exist, but no profile verification UI or end-user review queue is connected. There is no implemented document/selfie upload and review workflow. Do not advertise identity verification as an active feature.
- **Email confirmation:** registration does not require the user to click a confirmation email before the Supabase account is considered confirmed.
- **Online payment:** no payment-provider checkout, card/QR payment, webhook, or automated settlement exists.
- **Real-time chat:** no hosted push service is configured. New messages appear through polling, not instant server push.
- **Private file workflows:** no private KYC-document or chat-attachment workflow is implemented. Product images are public.
- **Dedicated notification delivery:** no complete end-user email/SMS notification service is set up for order/quotation changes.
- **Stock reservation at order placement:** stock is deducted on successful completion, not when a buyer initially submits the order. Multiple submitted orders can therefore depend on the same unreserved inventory; completion rechecks stock.
- **Automated E2E coverage:** the test suite covers helpers, authorization rules, config, CSVs, logout, and a Vercel route smoke test. It does not replace browser-and-database tests for all business workflows.

### Deployment and operational verification still needed

- Vercel deployment was not confirmed publicly. The provided deployment returned an SSO-protection redirect; adjust Vercel Deployment Protection or use the intended public deployment URL before asking others to browse it.
- Select and configure a hosted MySQL provider and database region; set the closest practical Vercel function region after that choice.
- Set production Vercel environment variables and configure Supabase site/redirect URLs.
- Back up the intended database and apply migrations with `corepack pnpm db:migrate`. Do not run `drizzle-kit push`.
- Verify the complete committed migration chain against a disposable, empty MySQL database before relying on a fresh production database.
- Run a production-like browser test for registration/sign-in, `auth.me`, public listings, image upload, quotation acceptance/order creation, order completion/cancellation, messaging polling, and report export.
- The last verified local build was run with Node 24 although `package.json` pins Node 22.x; validate the final deployment using Node 22.x.

## Automated verification performed

The latest reported local checks for the deployment work were:

- `corepack pnpm check` — passed.
- `corepack pnpm test` — 47 tests passed across 10 files.
- `corepack pnpm build` — passed. Vite emitted a warning that the main JavaScript chunk exceeds 500 kB.
- `corepack pnpm exec drizzle-kit check` — passed (checks migration metadata; does not apply migrations or prove the chain works on a clean database).
- Local production smoke test — SPA, anonymous `auth.me`, and marketplace listing endpoints returned HTTP 200 against the configured local environment.
- The Vercel rewrite adapter was exercised locally. This does not prove a remote deployment is accessible or configured correctly.
- Built browser assets were scanned for the configured Supabase service-role key; it was not present.

These results do not constitute a live Vercel deployment test or end-to-end functional acceptance.

## Repository reference

- [Website walkthrough](./WEBSITE_GUIDE.md)
- [Vercel deployment and migration steps](../DEPLOY.md)
- [Environment variable names and exposure](./ENVIRONMENT.md)
- [Technical project summary](./PROJECT_SUMMARY.md)
