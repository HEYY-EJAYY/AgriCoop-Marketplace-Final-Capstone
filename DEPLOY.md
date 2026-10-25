# Vercel deployment

The active deployment is a Vite SPA plus an Express/tRPC Vercel Function. Vercel serves the built client from `dist/public` and routes `/api/*` to [`api/index.ts`](./api/index.ts).

## Vercel configuration

1. Import the repository with the repository root as the Root Directory and the **Other** framework preset.
2. Keep the checked-in `vercel.json` settings: build command `corepack pnpm build`, output directory `dist/public`, and the `/api/*` rewrite.
3. Use Node.js 22.x and the pinned Corepack pnpm version from `package.json`.
4. Add the following variables to the Vercel environment. Values are intentionally omitted from this document.

| Variable                        |                                                              Required | Exposure                                  |
| ------------------------------- | --------------------------------------------------------------------: | ----------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      |                                                                   Yes | Browser-safe public configuration         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` |                                                                   Yes | Browser-safe public configuration         |
| `SUPABASE_SERVICE_ROLE_KEY`     | Yes for registration, server profile/commerce operations, and Storage | Server-only secret                        |
| `SUPABASE_STORAGE_BUCKET`       |                                                                    No | Server-only; defaults to `product-images` |
| `VITE_SUPABASE_URL`             |                                                                    No | Public alias for the Supabase URL         |
| `VITE_SUPABASE_ANON_KEY`        |                                                                    No | Public alias for the anon key             |
| `VITE_FRONTEND_FORGE_API_URL`   |                                                     Feature-dependent | Public browser integration                |
| `VITE_FRONTEND_FORGE_API_KEY`   |                                                     Feature-dependent | Public browser key; restrict it by origin |
| `BUILT_IN_FORGE_API_URL`        |                                                     Feature-dependent | Server-only integration                   |
| `BUILT_IN_FORGE_API_KEY`        |                                                     Feature-dependent | Server-only secret                        |

`DATABASE_URL`, `DATABASE_SSL`, `DATABASE_SSL_CA`, `JWT_SECRET`, `VITE_APP_ID`, and `OAUTH_SERVER_URL` are not runtime requirements for the active Supabase application. The old Drizzle/MySQL files and seed commands are retained only as legacy tooling; do not configure them as the production data path.

## Supabase Auth

In Supabase **Authentication → URL Configuration**:

1. Set the Site URL to the canonical frontend origin.
2. Add the Vercel preview and production origins to Redirect URLs as needed.
3. Keep email/password account creation enabled if public registration is intended.

The browser sends only the public anon key. The server validates the bearer token with Supabase Auth, resolves `public.profiles.user_id`, then resolves `public.roles.role_id`. A token without a matching profile returns `auth.me = null`; it is never converted into a legacy user or administrative account.

## Database boundary

The active code matches the current tables: `profiles`, `roles`, `cooperatives`, `products`, `inventory`, `quotations`, `quotation_items`, `orders`, `order_items`, and `transactions`. No production SQL is included or applied by this repository.

The checked-in [`supabase/rls.sql`](./supabase/rls.sql) is an older target artifact for a different `users` schema. Do not apply it to the current `profiles` schema without a reviewed migration and policy test. The server performs role/cooperative authorization explicitly and uses the service-role client only on the server.

The live schema has no conversation/message or activity-log tables, so support messaging is shown as an explicit unavailable state and admin activity counts remain empty. Add and review those tables/RLS policies before re-enabling the inbox or claiming activity history.

## Development test data

Do not run a seed command against production. For a non-production Supabase project only, set `SUPABASE_SEED_ALLOW_WRITE=true` and `SUPABASE_DEV_SELLER_ID` to an existing approved seller UUID, then run:

```powershell
corepack pnpm seed:supabase-demo
```

This writes only two development product/inventory examples and does not create orders, transactions, or Auth users.

## Preview verification

After a preview deployment, verify manually:

- the SPA loads and `/api/trpc/auth.me` returns a successful tRPC envelope with `null` for an anonymous request;
- sign-in followed by `/dashboard` keeps the Supabase bearer token on the first `auth.me` request;
- a profile with no `profiles` row is treated as unauthenticated/unsupported, not as a fake buyer;
- empty `products` and `inventory` tables render marketplace and seller empty states;
- approved seller products use the separate inventory quantity;
- quotation, order, officer, and system-admin requests enforce server-side role/account status;
- no browser bundle or response contains the service-role key.

Do not deploy automatically from this repository. Review the Git diff and verification results, commit the feature branch, push it, and create the Vercel preview only after explicit approval.
