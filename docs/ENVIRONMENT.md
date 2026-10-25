# Environment variables

Copy `.env.example` to `.env.local` for local development. Keep `.env.local` private and never commit it. Vercel production values belong in the project's Environment Variables settings.

## Required for production

| Variable | Use | Exposure |
|---|---|---|
| `DATABASE_URL` | MySQL connection URL (`mysql://...`) for the app and Drizzle migrations | Server-only secret |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Auth and Storage project URL | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase browser Auth client | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side account management and signed image uploads | Server-only secret |

The server validates these values at startup in production and rejects malformed or non-MySQL database URLs. Never put the Supabase service-role key in a `VITE_*` or other browser-exposed variable.

## Optional runtime variables

| Variable | Use | Exposure |
|---|---|---|
| `PORT` | Local Express port; defaults to `3000` | Server |
| `SUPABASE_STORAGE_BUCKET` | Product image bucket; defaults to `product-images` | Server |
| `DATABASE_SSL` | Set to `true` to enable verified TLS for MySQL | Server |
| `DATABASE_SSL_CA` | Optional certificate authority, with newlines represented as `\n` | Server-only secret/config |
| `OWNER_OPEN_ID` | Supabase user ID granted the owner role during account upsert | Server-only |
| `BUILT_IN_FORGE_API_URL` | Optional upstream URL for template integrations such as LLM, image generation, voice, notifications, and map helpers | Server |
| `BUILT_IN_FORGE_API_KEY` | Credential for those optional upstream integrations | Server-only secret |
| `VITE_FRONTEND_FORGE_API_URL` | Optional browser map helper URL | Public configuration |
| `VITE_FRONTEND_FORGE_API_KEY` | Optional browser map key; restrict it to the production and development origins with the provider | Public credential |
| `VITE_SUPABASE_URL` | Optional Vite alias for `NEXT_PUBLIC_SUPABASE_URL` | Public |
| `VITE_SUPABASE_ANON_KEY` | Optional Vite alias for `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public |

The optional Forge integrations are not required for core marketplace, Auth, or product-image flows. Any browser map key is visible to users and must be origin-restricted. The `/manus-storage` proxy and Manus debug/runtime integrations have been removed.

## Seed-only variables

`corepack pnpm seed:defaults` needs `SEED_SUPERADMIN_1_EMAIL`, `SEED_SUPERADMIN_1_PASSWORD`, `SEED_SUPERADMIN_2_EMAIL`, `SEED_SUPERADMIN_2_PASSWORD`, `SEED_OFFICER_EMAIL`, `SEED_OFFICER_PASSWORD`, `SEED_BUYER_EMAIL`, `SEED_BUYER_PASSWORD`, `SEED_SELLER_EMAIL`, and `SEED_SELLER_PASSWORD`. These are not needed by normal app startup and must remain server-side.

`SUPERADMIN_JOAN_PASSWORD` and `SUPERADMIN_EROL_PASSWORD` are read only by the legacy `seed:superadmins` script. Prefer `seed:defaults`; do not put seed passwords in source code or browser-exposed variables.

## Local development

The `dev` script loads `.env.local` and sets `NODE_ENV=development`. For production-like local checks, use the required production values in a private environment file and run the built server with `NODE_ENV=production`; do not put production secrets in shell history or logs.

Public registration supports Buyer, Seller / Farmer, and Cooperative Admin Officer. Admin Officer registrations remain pending until approved, and SuperAdmin is not a public registration option. The current order flow is face-to-face; no payment-provider credentials are needed.
