# Environment variables

Copy `.env.example` to `.env.local` for local development. Never commit `.env.local`, credentials, access tokens, or database backups.

## Active runtime

| Variable                        | Use                                                                    | Exposure           |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase Auth and server/browser client URL                            | Public             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser Auth and public Supabase access                                | Public             |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server-side Auth account creation, protected reads/writes, and Storage | Server-only secret |
| `SUPABASE_STORAGE_BUCKET`       | Product image bucket; defaults to `product-images`                     | Server-only        |
| `VITE_SUPABASE_URL`             | Optional Vite alias for the public Supabase URL                        | Public             |
| `VITE_SUPABASE_ANON_KEY`        | Optional Vite alias for the public anon key                            | Public             |
| `VITE_FRONTEND_FORGE_API_URL`   | Optional browser map/helper integration                                | Public             |
| `VITE_FRONTEND_FORGE_API_KEY`   | Optional browser integration key; restrict by origin                   | Public             |
| `BUILT_IN_FORGE_API_URL`        | Optional server integration                                            | Server             |
| `BUILT_IN_FORGE_API_KEY`        | Optional server integration credential                                 | Server-only secret |

The server resolves the authenticated Supabase user from the bearer token, then maps `profiles.user_id → profiles.role_id → roles.role_name`. A missing profile is handled as an unauthenticated application account.

## Development-only seed variables

`SUPABASE_SEED_ALLOW_WRITE=true` and `SUPABASE_DEV_SELLER_ID` are accepted only by `corepack pnpm seed:supabase-demo`. The script refuses `NODE_ENV=production`, validates that the seller profile is approved, and writes only labeled development products and inventory.

## Legacy tooling

`DATABASE_URL`, `DATABASE_SSL`, `DATABASE_SSL_CA`, `JWT_SECRET`, and the old seed-password variables belong to the historical Drizzle/MySQL tooling. They are not required by the active Supabase/Vercel runtime and must not be used to configure the production application database.
