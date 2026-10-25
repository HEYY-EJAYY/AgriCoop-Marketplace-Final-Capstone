# Vercel deployment

This repository builds a Vite client and serves its tRPC API from an Express Vercel Function. Production static assets are served by Vercel; the function does not start an Express listener or Vite middleware.

## 1. Prepare hosted services

1. Create a hosted MySQL database with a provider you choose. The provider is intentionally not prescribed here.
2. Enable TLS and keep the provider's CA certificate available if it requires a custom CA. Use a provider connection limit that can accommodate multiple serverless instances; each warm function process pools up to three MySQL connections.
3. Create or select a Supabase project. The `product-images` bucket is created/configured by the server as public, with a 5 MiB file limit and JPEG/PNG/WebP MIME restrictions.
4. Choose a Vercel region close to the database after selecting the provider and database region. No region is hard-coded because those choices are not known yet.

## 2. Import and configure Vercel

1. Import `HEYY-EJAYY/AgriCoop-Marketplace-Final-Capstone` into Vercel.
2. Use the repository root as the Root Directory and the **Other** framework preset.
3. Use the repository's `vercel.json` settings: build command `corepack pnpm build`, output directory `dist/public`. The config rewrites `/api/*` to the Express function and other paths to the SPA entry point.
4. Set the project Node.js version to 22.x if Vercel does not infer it from `package.json`. The package manager is pinned to pnpm 10.4.1.
5. Add the following variables to the Vercel **Production** environment:

| Variable | Required | Notes |
|---|---:|---|
| `DATABASE_URL` | Yes | MySQL URL using `mysql://`; server-only |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL; public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon/publishable key; public |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service-role key; server-only, never use a `VITE_*` name |
| `DATABASE_SSL` | Recommended | Set to `true` when the provider supports TLS |
| `DATABASE_SSL_CA` | As needed | Provider CA certificate if required |
| `SUPABASE_STORAGE_BUCKET` | No | Defaults to `product-images` |
| `OWNER_OPEN_ID` | No | Optional Supabase user ID for owner-role upsert behavior |
| `BUILT_IN_FORGE_API_URL` | Feature-dependent | Optional upstream integrations; server-only |
| `BUILT_IN_FORGE_API_KEY` | Feature-dependent | Optional upstream credential; server-only |
| `VITE_FRONTEND_FORGE_API_URL` | Feature-dependent | Optional public map integration |
| `VITE_FRONTEND_FORGE_API_KEY` | Feature-dependent | Public browser key; restrict by origin at its provider |

The four core values (`DATABASE_URL`, both public Supabase values, and the service-role key) are validated when the production server starts. Do not add `JWT_SECRET`, `VITE_APP_ID`, or `OAUTH_SERVER_URL`; those template values are not used by the current runtime.

The client and API are same-origin, so no permissive CORS middleware is enabled. If the client is later hosted on a separate origin, allow only that exact production origin. The app sets `trust proxy` for Vercel, uses `httpOnly`/`SameSite=Lax` cookies with `Secure` on HTTPS, disables Express's `X-Powered-By` header, and applies basic security headers.

## 3. Configure Supabase Auth

In Supabase **Authentication → URL Configuration**:

1. Set **Site URL** to the canonical production origin, for example `https://your-domain.example`.
2. Add the production origin and Vercel deployment origin to **Redirect URLs**, including the callback paths required by the app. Also include `http://localhost:3000/**` for local development if needed.
3. If using a custom domain, update Site URL and Redirect URLs to that domain after DNS is configured.

Keep the service-role key server-side. The browser uses only the anon key. Product image bytes upload directly from the browser with a short-lived signed upload token; the service-role key is never sent to it.

## 4. Apply database migrations

Never run `drizzle-kit push`. Before changing a database, make a backup. For a local MySQL installation, the project’s backup command is:

```powershell
mysqldump -u root -p agricoop --result-file=backup.sql
```

For hosted MySQL, use the provider's equivalent export/backup command and a protected destination. Then, from a trusted machine with `DATABASE_URL` configured in its private `.env.local`, run:

```powershell
corepack pnpm db:migrate
```

This invokes `drizzle-kit migrate` and applies the committed migration chain. The 7-column user migration is guarded so it tolerates columns already added manually. Do not run it against production until the backup is confirmed and the target database is verified.

## 5. Deploy and verify

Deploy from the Vercel dashboard or with the Vercel CLI. Check the deployment logs for build success and confirm:

- the SPA loads on the Vercel URL;
- `GET /api/trpc/auth.me` returns a successful tRPC response (an unauthenticated user has `null` data);
- sign-up/sign-in works and the authenticated `auth.me` response contains the current user;
- marketplace listing and product image upload work;
- quotation/order workflows and conversation polling work.

Conversation updates use tRPC polling (messages every 5 seconds, conversation list every 10 seconds) rather than in-memory SSE/pub-sub, which cannot reliably connect separate serverless invocations.

## Rollback

Use Vercel's deployment rollback to restore the previous application build. The user-profile migration is additive; rolling back application code does not require dropping columns. If a database rollback is ever necessary, stop writes and restore the verified backup using the provider's procedure. Do not drop, truncate, rename, or manually reverse schema objects as part of a routine app rollback.

## Remaining manual choices

- Select a hosted MySQL provider and region, then choose the nearest supported Vercel region.
- Configure production Vercel environment variables and run migrations after taking a backup.
- Configure Supabase Site URL and redirect URLs.
- Add and validate a custom domain, if desired.
