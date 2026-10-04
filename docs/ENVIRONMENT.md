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
```

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are browser-safe. Keep `DATABASE_URL`, `JWT_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` server-only. Do not add payment keys for the current F2F-only scope.
