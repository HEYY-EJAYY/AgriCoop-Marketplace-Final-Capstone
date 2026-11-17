# Environment variables

Copy `.env.example` to `.env.local`, replace the placeholders, and never commit `.env.local`.

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
MIGRATION_DATABASE_URL=postgresql://MIGRATION_USER:PASSWORD@HOST:5432/DATABASE
SEED_DATABASE_URL=postgresql://SEED_USER:PASSWORD@HOST:5432/DATABASE
PORT=3000
APP_URL=http://localhost:3000
NODE_ENV=development
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
# Add the five-account SEED_* email and password variables in .env.local.
# Set AGRICOOP_SEED_TARGET=local before running any seed script.
# Never commit real credentials or put passwords in source code.
```

Optional template compatibility variables are `VITE_APP_ID`, `OAUTH_SERVER_URL`, `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY`, `VITE_FRONTEND_FORGE_API_URL`, and `VITE_FRONTEND_FORGE_API_KEY`.

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are browser-safe. Keep all database URLs and `SUPABASE_SERVICE_ROLE_KEY` server-only. `DATABASE_URL` is used by the PostgreSQL runtime and must be restricted to the minimum connection privileges; each authenticated database request runs in a transaction with the JWT identity and `authenticated` role applied. `MIGRATION_DATABASE_URL` is only for explicit Drizzle migration commands, and `SEED_DATABASE_URL` is only for explicit seed scripts. Never point either credential at a production database without a separate approved change window. `JWT_SECRET` is read into a legacy environment object but has no confirmed active consumer and is not required by the current Vercel runtime. The application uses manual cash and GCash QR/proof workflows; it does not currently require a payment-processor API key.

`APP_URL` must be the application's origin. Production requires HTTPS and uses this value to construct the Supabase email-confirmation callback; it must never be derived from an untrusted request host. In the Supabase Dashboard, enable email signup and require email confirmation, set the Site URL, and allow the exact callback `APP_URL/auth?verification=success` in Authentication → URL Configuration → Redirect URLs. Configure suitable email delivery/custom SMTP and Auth signup/resend rate limits before enabling public registration. These settings were not changed or verified in production.

The Drizzle migration config is scoped to `agricoop_app`; `public.profiles` and `public.roles` are runtime read mappings, not migration targets. The PostgreSQL migration directory does not yet have a validated baseline for the existing tables. Do not run `pnpm db:push` or `drizzle-kit migrate` until an initial snapshot and reviewed migration set are prepared and the target is proven disposable staging.

Temporary authentication diagnostics are enabled automatically in local development. For a production-like diagnostic build, set the non-secret flag `VITE_AUTH_DIAGNOSTICS=true` for the frontend and `AGRICOOP_AUTH_DIAGNOSTICS=true` for the server, then remove both after investigation. Diagnostics report session/token presence, auth resolution outcomes, operation paths, and role names only; they never log token values or personal identifiers.

Public registration supports Buyer and Seller / Farmer only. Seller accounts require an authorized cooperative assignment and approval before operational use. Admin and SuperAdmin accounts require authorized provisioning; neither role is a public registration option.

An authenticated Supabase identity without an application profile is not automatically provisioned on first request. Public Buyer/Seller registration sends Supabase's email-confirmation message and creates the application user/profile with the exact Auth UUID and server-assigned canonical role ID. The backend rejects Auth identities without `email_confirmed_at` before application mapping or operational access. Buyer approval and Seller cooperative-association/approval workflows remain unchanged. User metadata and environment values do not grant an administrative role. The production database must contain the expected public role records and approved grants/RLS for profile provisioning and application-user access before registration is enabled.

For local seed scripts, set `AGRICOOP_SEED_TARGET=local`; all scripts reject `NODE_ENV=production`, require `SEED_DATABASE_URL` to use a loopback host (`localhost`, `127.0.0.1`, or `::1`), and refuse to run without the explicit target. Auth-account seed scripts also require `NEXT_PUBLIC_SUPABASE_URL` to use a loopback host so a local database cannot be paired accidentally with production Supabase Auth. This is a defense-in-depth check, not proof that a local port-forward or proxy cannot reach a remote service; inspect the target through approved local configuration before seeding. No seed script was run as part of this assessment.

For the five local default accounts, provide `SEED_SUPERADMIN_1_EMAIL`, `SEED_SUPERADMIN_1_PASSWORD`, `SEED_SUPERADMIN_2_EMAIL`, `SEED_SUPERADMIN_2_PASSWORD`, `SEED_OFFICER_EMAIL`, `SEED_OFFICER_PASSWORD`, `SEED_BUYER_EMAIL`, `SEED_BUYER_PASSWORD`, `SEED_SELLER_EMAIL`, and `SEED_SELLER_PASSWORD` in `.env.local`. Run `corepack pnpm seed:defaults` to create or update those Supabase Auth and application accounts and seed the ten approved crop listings. The seed command never prints or stores passwords in source. Do not place passwords in browser-exposed `VITE_*` or `NEXT_PUBLIC_*` variables.
