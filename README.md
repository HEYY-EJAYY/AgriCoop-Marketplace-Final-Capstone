# AgriCoop Marketplace

AgriCoop is a cooperative-focused produce marketplace for Buyers, Sellers/Farmers, Cooperative Officers, and System Administrators. It supports approved product listings, quotations, orders, fulfillment records, and face-to-face payment coordination.

## Current runtime

- React, Vite, TypeScript, Tailwind CSS, and Wouter
- Express and tRPC API served locally and through the Vercel function in [`api/index.ts`](./api/index.ts)
- Supabase Auth and Supabase PostgreSQL tables for the active application runtime
- Supabase Storage signed uploads for the optional product-image integration
- Vitest for automated tests

The active runtime does not require MySQL. The historical Drizzle/MySQL schema, migrations, seed scripts, and [`server/db.ts`](./server/db.ts) remain in the repository as legacy tooling and are not imported by the active router. Do not run the legacy migration or seed commands against the Supabase project.

## Local development

1. Install Node.js 22.x and enable Corepack.
2. Copy `.env.example` to `.env.local` and set the Supabase public URL/key plus the server-only service-role key. Keep `.env.local` private.
3. Install dependencies and start the application:

   ```powershell
   corepack pnpm install
   corepack pnpm dev
   ```

The browser receives only the public Supabase configuration. The service-role key is read only by server code and must never use a `VITE_*` variable.

## Safe development data

The live project currently has no products or inventory rows. To add deliberately labeled development listings, set `SUPABASE_SEED_ALLOW_WRITE=true` and `SUPABASE_DEV_SELLER_ID` to an existing approved seller profile UUID in a non-production environment, then run:

```powershell
corepack pnpm seed:supabase-demo
```

The script refuses `NODE_ENV=production`, validates the seller role/status, writes only products and inventory, and never creates orders, quotations, transactions, or Auth users. It requires the server-only service-role key and does not print it.

## Verification

```powershell
corepack pnpm check
corepack pnpm test
corepack pnpm build
```

See [`docs/ENVIRONMENT.md`](./docs/ENVIRONMENT.md), [`DEPLOY.md`](./DEPLOY.md), and [`docs/IMPLEMENTATION_STATUS.md`](./docs/IMPLEMENTATION_STATUS.md) for configuration, deployment, and known schema boundaries.
