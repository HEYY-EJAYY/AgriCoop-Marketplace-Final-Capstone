# Environment variables

Create a local `.env.local` file; never commit it.

```dotenv
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/agricoop
PORT=3000
NODE_ENV=development
JWT_SECRET=replace-with-a-long-random-secret
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
# Add the five-account SEED_* email and password variables in .env.local.
# Never commit real credentials or put passwords in source code.
```

Optional template compatibility variables are `VITE_APP_ID`, `OAUTH_SERVER_URL`, `OWNER_OPEN_ID`, `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY`, `VITE_FRONTEND_FORGE_API_URL`, and `VITE_FRONTEND_FORGE_API_KEY`.

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are browser-safe. Keep `DATABASE_URL`, `JWT_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` server-only. Do not add payment keys for the current F2F-only scope.

Public registration supports Buyer, Seller / Farmer, and Cooperative Admin Officer. Admin Officer registrations are stored as `pending` and cannot use operational admin procedures until approved. SuperAdmin is intentionally not a public registration option.

For the five local default accounts, provide `SEED_SUPERADMIN_1_EMAIL`, `SEED_SUPERADMIN_1_PASSWORD`, `SEED_SUPERADMIN_2_EMAIL`, `SEED_SUPERADMIN_2_PASSWORD`, `SEED_OFFICER_EMAIL`, `SEED_OFFICER_PASSWORD`, `SEED_BUYER_EMAIL`, `SEED_BUYER_PASSWORD`, `SEED_SELLER_EMAIL`, and `SEED_SELLER_PASSWORD` in `.env.local`. Run `corepack pnpm seed:defaults` to create or update those Supabase Auth and application accounts and seed the ten approved crop listings. The seed command never prints or stores passwords in source. Do not place passwords in browser-exposed `VITE_*` or `NEXT_PUBLIC_*` variables.
