# AgriCoop Marketplace

AgriCoop is a cooperative-centered agricultural marketplace for Buyers, Sellers/Farmers, Admins, and SuperAdmins. It supports product discovery, quotation requests, regular/bulk F2F orders, inventory updates, product moderation, CSV reporting, and Buyer↔Seller support conversations.

## Current stack

- React 19 + Vite + Wouter
- Tailwind CSS 4 and shadcn-style UI components
- Express 4 + tRPC 11
- Drizzle ORM with PostgreSQL via the Supabase transaction pooler (port 6543)
- Supabase Auth bearer-token verification
- Short-polling conversation updates (2.5-second interval)
- Vitest, TypeScript, Vite/esbuild production build
- **Payments are intentionally F2F-only**; online gateway/webhook code is not active

> The approved application data model is isolated in the `agricoop_app` schema. The reduced legacy Supabase modules remain in the repository until Stage 4 verification.

## Roles

- **Buyer:** browse approved visible listings, request quotations, place regular/bulk orders, and message Sellers.
- **Seller/Farmer:** save and submit listings, manage inventory, respond to quotations, fulfill orders, and message Buyers.
- **Admin:** manage users/cooperatives and review Seller product submissions.
- **SuperAdmin:** platform-level administrative access; cannot be created through public registration.

Seller listings are hidden until submitted and approved. Rejected listings retain a reason for correction and resubmission.

## Local setup

Configure `DATABASE_URL` with the Supabase PostgreSQL transaction pooler URL on port 6543. Copy the required local configuration into `.env.local` (see [docs/ENVIRONMENT.md](./docs/ENVIRONMENT.md)); keep database and Supabase service-role credentials private.

```powershell
corepack pnpm install
if (-not (Test-Path .env.local)) { New-Item -ItemType File .env.local }
notepad .env.local
corepack pnpm db:migrate
corepack pnpm seed:defaults
corepack pnpm dev
```

The development server prints its URL when ready (normally `http://localhost:3000/`; it selects the next available port if that port is occupied). `seed:defaults` creates or updates only the five configured default accounts and the ten requested visible crop listings. It requires valid Supabase Auth admin settings and all `SEED_*` values in `.env.local`.

Useful validation commands:

```bash
corepack pnpm check
corepack pnpm test
corepack pnpm build
```

`pnpm seed:demo` is a separate legacy demo-data seeder that creates additional users and marketplace activity; do not run it when using the five-account default dataset. For a production server, run `corepack pnpm build` followed by `corepack pnpm start`.

## Database changes

1. Edit `drizzle/schema.ts`.
2. Run `corepack pnpm exec drizzle-kit generate`.
3. Review the SQL migration, especially enum changes.
4. Apply it with `corepack pnpm exec drizzle-kit migrate`.
5. Run `corepack pnpm check`, `corepack pnpm test`, and `corepack pnpm build`.

The current role/product migration normalizes legacy `user` and `officer` records before narrowing the role enum.

## Conversations

Quotation and order submissions automatically create a Buyer↔Seller conversation. Signed-in participants can access only their own threads. Admin/SuperAdmin can oversee all threads. The support page uses tRPC for data and an authenticated SSE stream at `/api/conversations/:conversationId/stream` for immediate updates.

## F2F payment policy

Orders store `paymentMethod: f2f` and `F2F-pending-confirmation` until the Seller records handover/payment notes. There are no active online payment intents, QR flows, or webhooks.

## Deployment limitation

A true Vercel-independent Next.js + Supabase Postgres cutover remains outstanding. It requires migrating the MySQL schema, adding `auth_user_id` profile links, applying/testing the RLS artifact, replacing Express/Vite routes with Next.js routes/server actions, and using Supabase Realtime or an equivalent hosted stream.
