# AgriCoop Marketplace

AgriCoop is a cooperative-focused produce marketplace for Buyers, Sellers/Farmers, Cooperative Admin Officers, and SuperAdmins. It supports approved product listings, quotations, orders, fulfillment records, and support conversations. Payments are arranged face-to-face; the app does not process money online.

## Project documentation

- [What is implemented and what remains](./docs/IMPLEMENTATION_STATUS.md)
- [Detailed website and user guide](./docs/WEBSITE_GUIDE.md)
- [Vercel deployment guide](./DEPLOY.md)
- [Environment variable reference](./docs/ENVIRONMENT.md)
- [Evidence-based technical project summary](./docs/PROJECT_SUMMARY.md)

## Current stack

- React, Vite, TypeScript, Tailwind CSS, and Wouter
- Express and tRPC API
- Drizzle ORM and MySQL
- Supabase Auth for identity; Supabase Storage for product images
- Vercel Function adapter for serverless API requests
- Vitest for automated tests

This is not a Next.js or Supabase Postgres application. The app database is MySQL.

## Run locally (Windows PowerShell)

1. Install Node.js 22.x and enable Corepack.
2. Copy `.env.example` to `.env.local`; fill in private local MySQL and Supabase values without committing the file.
3. Create/select the MySQL database, then back it up before applying migrations.
4. Install dependencies and apply the committed migrations:

   ```powershell
   corepack pnpm install
   corepack pnpm db:migrate
   ```

5. Start the development server:

   ```powershell
   corepack pnpm dev
   ```

Do not use `drizzle-kit push`. For production setup and database backup guidance, see [DEPLOY.md](./DEPLOY.md).

## Check the project

```powershell
corepack pnpm check
corepack pnpm test
corepack pnpm build
```
