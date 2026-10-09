# Environment variables

Create a local `.env` file; never commit it.

```dotenv
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/agricoop
PORT=3000
NODE_ENV=development
JWT_SECRET=replace-with-a-long-random-secret
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
# Only for the one-time server-side SuperAdmin provisioning command; never commit these.
SUPERADMIN_JOAN_PASSWORD=temporary-password-from-secure-secret-store
SUPERADMIN_EROL_PASSWORD=temporary-password-from-secure-secret-store
```

Optional template compatibility variables are `VITE_APP_ID`, `OAUTH_SERVER_URL`, `OWNER_OPEN_ID`, `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY`, `VITE_FRONTEND_FORGE_API_URL`, and `VITE_FRONTEND_FORGE_API_KEY`.

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are browser-safe. Keep `DATABASE_URL`, `JWT_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` server-only. Do not add payment keys for the current F2F-only scope.

Public registration supports Buyer, Seller / Farmer, and Cooperative Admin Officer. Admin Officer registrations are stored as `pending` and cannot use operational admin procedures until approved. SuperAdmin is intentionally not a public registration option.

To provision the two initial SuperAdmin accounts, set the two `SUPERADMIN_*_PASSWORD` variables in a secure server-only environment and run `pnpm seed:superadmins`. The script creates or updates the Supabase Auth users, synchronizes approved `superadmin` records into the application database, and never prints or stores password values. Do not place these variables in browser-exposed `VITE_*` or `NEXT_PUBLIC_*` variables.
