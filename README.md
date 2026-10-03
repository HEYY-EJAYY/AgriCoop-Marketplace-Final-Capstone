# AgriCoop Marketplace

AgriCoop is a cooperative-centered agricultural marketplace for Buyers, Sellers/Farmers, Admins, and SuperAdmins. It supports product discovery, quotation requests, regular/bulk F2F orders, inventory updates, product moderation, CSV reporting, and Buyer↔Seller support conversations.

## Current stack

- React 19 + Vite + Wouter
- Tailwind CSS 4 and shadcn-style UI components
- Express 4 + tRPC 11
- Drizzle ORM with MySQL/TiDB at runtime
- Supabase Auth bearer-token verification
- Authenticated Server-Sent Events for conversation updates
- Vitest, TypeScript, Vite/esbuild production build
- **Payments are intentionally F2F-only**; online gateway/webhook code is not active

> This repository is currently a Vite/Express + MySQL runtime, not yet a native Next.js + Supabase Postgres deployment. `supabase/rls.sql` is the target migration/security artifact and must be applied and verified only after the Postgres cutover.

## Roles

- **Buyer:** browse approved visible listings, request quotations, place regular/bulk orders, and message Sellers.
- **Seller/Farmer:** save and submit listings, manage inventory, respond to quotations, fulfill orders, and message Buyers.
- **Admin:** manage users/cooperatives and review Seller product submissions.
- **SuperAdmin:** platform-level administrative access; cannot be created through public registration.

Seller listings are hidden until submitted and approved. Rejected listings retain a reason for correction and resubmission.

## Local setup

```bash
pnpm install
# configure DATABASE_URL, Supabase Auth variables, and JWT_SECRET in a local .env
pnpm dev
```

Useful commands:

```bash
pnpm check
pnpm test
pnpm build
pnpm db:push
pnpm seed:demo
```

Use `pnpm seed:demo` only against a demo database. It creates one cooperative, three Sellers, one Buyer, an Admin, 12 approved listings, quotations, mixed orders, F2F transactions, and a linked support thread.

## Database changes

1. Edit `drizzle/schema.ts`.
2. Run `pnpm drizzle-kit generate`.
3. Review the SQL migration, especially enum changes.
4. Apply it with the project migration workflow.
5. Run `pnpm check`, `pnpm test`, and `pnpm build`.

The current role/product migration normalizes legacy `user` and `officer` records before narrowing the role enum.

## Conversations

Quotation and order submissions automatically create a Buyer↔Seller conversation. Signed-in participants can access only their own threads. Admin/SuperAdmin can oversee all threads. The support page uses tRPC for data and an authenticated SSE stream at `/api/conversations/:conversationId/stream` for immediate updates.

## F2F payment policy

Orders store `paymentMethod: f2f` and `F2F-pending-confirmation` until the Seller records handover/payment notes. There are no active online payment intents, QR flows, or webhooks.

## Deployment limitation

A true Vercel-independent Next.js + Supabase Postgres cutover remains outstanding. It requires migrating the MySQL schema, adding `auth_user_id` profile links, applying/testing the RLS artifact, replacing Express/Vite routes with Next.js routes/server actions, and using Supabase Realtime or an equivalent hosted stream.
