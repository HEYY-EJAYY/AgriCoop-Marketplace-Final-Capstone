# AgriCoop Marketplace

**Live:** [agricoop-marketplace-final-capstone.vercel.app](https://agricoop-marketplace-final-capstone.vercel.app)

**Full platform documentation:** [docs/PLATFORM_GUIDE.md](./docs/PLATFORM_GUIDE.md)

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
corepack pnpm dev
```

The development server prints its URL when ready (normally `http://localhost:3000/`; it selects the next available port if that port is occupied). The approved application schema is applied separately as documented in [DEPLOY.md](./DEPLOY.md). Seed scripts are privileged operations, are not part of normal startup, and should only be run after checking their exact target and intended data changes; see [Seed scripts](#seed-scripts) below.

Useful validation commands:

```bash
corepack pnpm check
corepack pnpm test
corepack pnpm build
```

The package also contains legacy demo seed commands; inspect their target scripts before use. For a local production build, run `corepack pnpm build` followed by `corepack pnpm start`.

## Database changes

1. Edit `drizzle/schema.ts`.
2. Run `corepack pnpm exec drizzle-kit generate`.
3. Review the SQL migration, especially enum changes.
4. Apply it with `corepack pnpm exec drizzle-kit migrate`.
5. Run `corepack pnpm check`, `corepack pnpm test`, and `corepack pnpm build`.

The production app schema is PostgreSQL and lives in the `agricoop_app` schema. Review additive migration SQL before applying database changes.

## Conversations

Quotation and order submissions automatically create a thread linked to the product, quotation, or order. The Buyer and Seller exchange messages there; cooperative Admins and SuperAdmins can access threads according to server-side scope. The support page refreshes conversations and messages through short polling (about every 2.5 seconds), not SSE.

## F2F payment policy

Orders use `paymentMethod: f2f` and record F2F coordination in the order/transaction records. Completion records the final amount and optional payment-reference note. The application does not collect payment; there are no active online payment intents, QR flows, or payment webhooks.

## Seed scripts

`scripts/seed-approved-supabase.ts` is a local-only privileged seed tool. The package alias `seed:defaults` currently points to `scripts/seed-defaults.ts`; check the exact script target and configured database before running any seeder. Never run a seed script against production without reviewing its intended writes.
