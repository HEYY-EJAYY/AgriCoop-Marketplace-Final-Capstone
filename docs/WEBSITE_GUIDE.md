# AgriCoop Marketplace: detailed website guide

**Audience:** project stakeholders, testers, evaluators, and developers who need to understand what the current website is for and how its main flows work.
**Reviewed:** 25 October 2026.

## 1. What the website is

AgriCoop is a community/cooperative-focused marketplace for agricultural products. It connects people who buy produce with farmers who list harvests, while cooperative Admin Officers help moderate products and coordinate member activity. SuperAdmins provide platform-level administration.

The website brings discovery, quotation requests, order tracking, and support conversations together. It is designed to document and coordinate trade—not to handle payments. Buyers and Sellers arrange payment and handover face-to-face; the application records the relevant order and optional payment-reference notes.

### Key principles in the current implementation

1. **Public product discovery:** anyone can browse the marketplace and view eligible listings.
2. **Role-gated operations:** protected API procedures check the authenticated local account and its role/approval status.
3. **Cooperative moderation:** Seller listings are not buyer-visible until approved.
4. **Traceable order fulfillment:** order status, final delivered quantities, inventory deductions, and status events are stored.
5. **Human payment coordination:** payment/handover is F2F; there is no payment gateway.
6. **Serverless-friendly conversation updates:** messages are stored in MySQL and the browser polls for updates.

## 2. Roles and what each can do

| Role | Registration/assignment | Main website actions |
|---|---|---|
| Buyer | Public self-registration; approval starts as approved | Browse products; request quotations; accept/decline Seller quotations; place regular or same-Seller multi-product orders; view outgoing orders and quotations; use support conversations. |
| Seller / Farmer | Public self-registration; starts pending until approved. May choose individual or cooperative membership. | Create and manage own listings; upload product images; submit listings for moderation; maintain stock/details; respond to quotations; confirm submitted orders and mark them ready; use conversations. |
| Cooperative Admin Officer (`admin` in the database) | Public role request; starts pending. Must be assigned to a cooperative by an authorized administrator. | Review products and manage members, operational summaries, and order fulfillment for the assigned cooperative. Can complete/cancel orders in that cooperative. |
| SuperAdmin | Provisioned outside public registration | Platform-wide user/cooperative/product/report oversight; can complete/cancel orders across cooperatives. |

An account can authenticate with Supabase and still be unable to use operational tools until its local application role is approved. SuperAdmin is not a selectable self-registration role.

## 3. Public site pages

Routes are defined in `client/src/App.tsx`.

### `/` — Home

The home page introduces AgriCoop and routes visitors toward marketplace browsing and the “How it works” page. Its hero pairs the “Local harvest. Fairer value. Stronger communities.” message with marketplace/about actions.

The hero image was changed to stay inside a centered, rounded, bounded panel rather than extend beyond the right edge. At narrow widths, the copy and image stack vertically; on wide screens, they sit side-by-side. Below the hero, the page explains cooperative coordination and the roles served.

### `/about` — How it works

Explains the intended sequence: join with an appropriate role, publish/approve produce, request a quote or place an order, then coordinate payment and handover. The public text is an overview, not a guarantee that every described validation workflow is active; consult the status section below for incomplete features.

### `/marketplace` — Public product catalog

The listing page offers:

- search across product name, category, Seller name, and cooperative name;
- category filtering;
- price sorting low-to-high or high-to-low;
- listing cards with product photo, category, variety, quantity, minimum order, and unit price;
- links to product detail;
- add-to-order and quotation-request actions for signed-in eligible accounts.

The marketplace API is intended to show products that are published, approved, visible, and owned by an approved Seller. UI checks also prevent a Seller from ordering their own item and require a bulk basket to contain only one Seller's products.

### `/products/:id` — Product detail

Shows a selected listing's picture, category, name, variety, description, unit price, stock, minimum order, Seller name, and cooperative. If the listing ID is invalid or the listing is no longer public, the page offers a return link to the marketplace.

### `/auth` — Sign-in and registration

The same page switches between sign-in and registration.

Registration collects name, email, password, and role. Seller registration also asks whether the person is an individual Seller or a cooperative member. A cooperative member may choose an existing active cooperative or enter a new name. Admin Officer is available as a role request but remains pending until approved.

The app uses Supabase Auth for password-based sign-in, while application permissions and cooperative assignment are stored in MySQL. Current registration auto-confirms the Supabase email, so there is no separate email-confirmation link flow.

### `/support` — Support and inquiries

Authenticated users can open a support inquiry with a subject and message, browse accessible conversation threads, and send replies. Order and quotation requests may open a related conversation automatically.

Messages are refreshed by tRPC polling every five seconds; the thread list refreshes every ten seconds. This replaces the old process-local SSE approach. The interface states that administrators can view/reply to inquiries, while authorization limits cooperative Admin Officers to threads related to their cooperative and SuperAdmins have platform access.

## 4. Authenticated workspaces

### `/dashboard` — Role-dependent workspace

The dashboard selects a workspace based on the signed-in local role.

#### Buyer workspace

- Summarizes orders, open quotation requests, and completed orders.
- Lists outgoing orders, items, totals, and status.
- Lists quotations and Seller responses.
- Allows a Buyer to accept or decline a responded quote.
- For an accepted quote, offers an action to place the order at the quoted unit price and requested quantity.
- Links back to the marketplace.

#### Seller/Farmer workspace

- Summarizes active listings, incoming submitted orders, and waiting quotations.
- Creates a listing with name/category/variety, price/unit, stock/minimum, quality grade, description, and optional product image.
- Uploads images directly to Supabase Storage through a short-lived signed token. Allowed file types are JPEG/PNG/WebP and maximum file size is 5 MiB.
- Displays listing state, permits edits and stock changes, allows archival, and offers resubmission for verification when appropriate.
- Shows incoming order lines. Seller actions include confirming an order and marking it ready. The final complete/cancel action is reserved for the assigned Admin Officer or SuperAdmin.
- Provides incoming quotation requests and response/decline controls.

New listings are hidden pending review. Approval makes a listing buyer-visible; rejection leaves it hidden with a reason. Manual stock changes are separate from the automatic stock decrement at order completion.

#### Cooperative Admin Officer workspace

- Shows cooperative-specific member, product, order, quotation, and transaction summaries.
- Offers controls to approve or suspend cooperative members.
- Supports cooperative-level report downloads.
- Provides order fulfillment controls including final delivered quantities, completion, or cancellation.
- Product reviews approve or reject Seller submissions associated with that cooperative.

If the officer has no cooperative assignment, cooperative-level operations cannot proceed until an authorized user assigns one.

#### SuperAdmin workspace

- Shows platform-wide activity and role/cooperative management.
- Can create cooperatives and manage account roles, approval state, and cooperative assignment.
- Reviews product submissions across cooperatives.
- Has platform-wide report/fulfillment controls.
- Includes an “Act as seller” workspace mode for Seller operations in the interface; this does not turn the user into another account.

### `/activity` — Buyer/Seller outgoing activity

Provides an additional view of orders and quotations submitted by a Buyer or Seller acting as a marketplace participant. Other roles see an access-required message.

### `/reports` — CSV reports

Admin Officers and SuperAdmins can download CSV files for:

- completed sales/transaction totals and F2F reference notes;
- current inventory listing fields;
- quotation request statuses and prices;
- transaction/order references and statuses.

Officer data is intended to be limited to the assigned cooperative; SuperAdmin reports are platform-wide. These are exported snapshots, not scheduled reports or an accounting ledger.

### Unknown paths

Unrecognized routes display the Not Found page.

## 5. Main end-to-end flows

### A. Seller publishes a product

1. Seller signs in and must have an approved Seller role.
2. Seller creates a listing and can optionally upload a product image.
3. Listing starts hidden and awaiting verification.
4. A cooperative Admin Officer assigned to the Seller's cooperative or a SuperAdmin reviews the product.
5. Approval makes it visible in marketplace queries. Rejection stores a reason, keeps it hidden, and allows the Seller to correct and resubmit.

Product approval is a listing-moderation process. It is not the same as verifying a person's identity.

### B. Buyer requests and places an order

1. Buyer browses and filters eligible listings.
2. Buyer may request a quotation or add eligible items to an order.
3. A multi-item order must contain products from one Seller.
4. The server checks listing state, Seller approval, minimum quantities, current stock, and self-order restrictions.
5. It creates an order, its item rows, and an F2F coordination/transaction record; it also opens or associates a support conversation.
6. The Seller confirms the order and marks it ready.
7. The Seller's cooperative Admin Officer or a SuperAdmin records final delivered quantities and completes the order, or cancels it.
8. Completion rechecks and deducts current inventory transactionally, adjusts final item quantities/total, and records fulfillment events. Cancellation does not deduct stock.

Inventory is not reserved at order submission. A submitted order may become impossible to complete if other orders consume the same stock first; completion validates actual available stock.

### C. Buyer obtains a quotation

1. Buyer requests a quote for an available product, quantity, and optional note.
2. The Seller responds with a quoted unit price and optional note, or declines.
3. Buyer accepts or declines a response.
4. An accepted quote can be placed as an order only for its quoted product and requested quantity; the quoted unit price is used.

### D. Face-to-face payment/handover

The app records order and transaction state, and can store an optional payment-reference note. The parties arrange actual payment and handover themselves. A displayed “paid”, “recorded”, or coordination value must not be interpreted as an independently verified bank transfer; there is no payment processor integration.

### E. Support conversation

Users open a general inquiry or arrive at a conversation associated with quotation/order activity. Messages are persisted. Clients poll for new messages and thread updates, so updates may take several seconds to appear.

## 6. Information stored

The active Drizzle/MySQL schema includes these main tables:

| Table | Purpose |
|---|---|
| `users` | Supabase identity reference, local name/email, role, approval and verification fields, profile/contact fields, cooperative assignment, and timestamps. |
| `cooperatives` | Cooperative name, normalized name, location, description, and active state. |
| `products` | Seller/cooperative listing, description, category/variety, unit price, stock/minimum, quality, moderation/visibility state, image URL, and timestamps. |
| `quotations` | Buyer/Seller quotation request, quantity, response price/note, status, and timestamps. |
| `orders` | Buyer/Seller/cooperative, order type/status, F2F/payment coordination fields, total, notes, and timestamps. |
| `orderItems` | Product, order quantity, unit price, and timestamps per order line. |
| `orderEvents` | Order status/action history and actor. |
| `transactions` | Order-linked amount, payment method/status, optional F2F reference note, and timestamps. |
| `conversations` | Support thread with buyer, optional seller/product/order/quotation associations, status, and timestamps. |
| `conversationMessages` | Message body, sender, conversation, and timestamps. |

MySQL is the application database. Supabase is used for Auth and Storage; the current application does not use Supabase Postgres as its Drizzle database.

## 7. What is not included or not complete

- No online payment, card, QR, escrow, automatic refund, or payment webhook.
- No complete user-facing identity-verification form, ID/selfie upload, or identity review dashboard. Some profile-verification fields and API procedures exist, but there is no full user flow.
- No required email-confirmation step in the current account-creation flow.
- No private KYC/chat attachment storage feature; marketplace product images are public.
- No instant hosted realtime messaging; conversation updates poll.
- No stock reservation when an order is submitted.
- No automated email/SMS notification workflow for marketplace events.
- No claim that Vercel is currently publicly reachable: the supplied Vercel link redirected to SSO protection when last checked.
- No verified clean-database migration run or complete remote production acceptance test yet.

## 8. Technical overview

### Browser

- React + TypeScript + Vite build.
- Wouter routes the single-page application.
- Supabase browser client signs users in and obtains an access token.
- tRPC client sends the bearer token to the same-origin `/api/trpc` API.
- TanStack Query provides request caching, mutation state, invalidation, and conversation polling.

### Server and identity

- Express hosts the tRPC adapter.
- The local dev entry also runs Vite middleware; the Vercel function exports the Express app without `listen`.
- The API validates Supabase bearer tokens and maps the Supabase user ID to the local MySQL `users` profile.
- Authorization rules use the local role, approval status, and cooperative ID.

### Data, migrations, and images

- Drizzle ORM uses MySQL via mysql2.
- A small per-process pool is reused by warm function instances, with optional TLS settings.
- `corepack pnpm db:migrate` applies committed migrations. `drizzle-kit push` is unsafe for this schema and must not be used.
- Supabase Storage holds product images. Signed upload authorization is created server-side; the browser uploads image bytes directly to the bucket.

### Production deployment

- `vercel.json` routes `/api/*` to the function and other routes to the SPA entry.
- Vercel serves static files from `dist/public`.
- Production environment validation requires a MySQL URL, Supabase URL, anon key, and service-role key.
- The service-role key must remain server-only. Public Supabase URL/anon key are designed to be exposed to the client.
- Region selection remains a deployment decision based on the chosen MySQL provider/location.

## 9. Run and test locally

Use Node.js 22.x and Corepack/pnpm. Copy `.env.example` to a private `.env.local` and set development values. Create the MySQL database before migration. Back it up before applying migrations.

```powershell
corepack pnpm install
corepack pnpm db:migrate
corepack pnpm dev
```

Validation commands:

```powershell
corepack pnpm check
corepack pnpm test
corepack pnpm build
```

Do not commit `.env.local`, backup files, service-role keys, database URLs, or seed passwords. For the Vercel runbook and backup instructions, see [DEPLOY.md](../DEPLOY.md).

## 10. Quick orientation for testers

Before testing a scenario, confirm there is a working database, Supabase Auth configuration, the necessary approved test account, and eligible data.

| Scenario | Suggested check |
|---|---|
| Public browsing | Open `/`, navigate to `/marketplace`, search/filter/sort, and open a product detail. |
| Registration | Register a Buyer; separately register a Seller and verify its role stays pending until approved. |
| Product moderation | Approve a Seller, create a listing, confirm it is hidden before review, then approve/reject it as the correct Officer/SuperAdmin. |
| Quotation | Request a quote as Buyer; respond as Seller; accept it as Buyer; place the quoted order. |
| Order fulfillment | Submit an order, confirm/mark ready as Seller, complete with final quantities as cooperative Officer/SuperAdmin, and check stock/events. |
| Image upload | Try a supported JPEG/PNG/WebP within 5 MiB; confirm the listing uses the resulting public image URL. |
| Conversations | Send messages from authorized accounts and observe the polling refresh (up to about 5 seconds for messages). |
| Reports | Export CSVs with authorized Officer and SuperAdmin accounts; compare each report's cooperative scope. |
