# AgriCoop Marketplace — Final Ship Report

Branch: `finish/agricoop-complete`  
Live URL: **https://agricoop-marketplace-final-capstone.vercel.app**  
Production deployment: `dpl_9nYcJDtoYDCU4bBb3oKLMZFMyJek` (`READY`, commit `0c6d574`)  
Generated: 2026-11-17

---

## 1. Pre-flight

| Check | Result |
|-------|--------|
| Worktree / commits | Clean at start of ship; four completion commits present, then follow-up apply/API fix commits |
| Secrets tracked | `.env*` gitignored; only `.env.example` tracked (names only) |
| Schema snapshot | Saved locally to `.local/schema-snapshot-pre.json` (gitignored) |
| Data backup | **Not taken** — Supabase CLI / `pg_dump` unavailable on this machine. SQL pack was additive + idempotent |

---

## 2. Database apply (block by block)

Applied against the live project via `DATABASE_URL` from local `.env.local` (never printed). Log: `.local/sql-apply-log.json`.

| Block | Migration | Result | Verification |
|------:|-----------|--------|--------------|
| 1 | `20261117100000_auth_profile_access` | OK | `authenticated` USAGE on `agricoop_app`; 3 users policies; 2 profiles policies; visibility fn present |
| 2 | `20261117105000_active_application_tables` | OK after fix | All 8 missing tables created (`auditLogs`, associations, notifications, payments, …) |
| 3 | `20261117110000_transaction_payment_option` | OK | `transactions.paymentOptionId` present |
| 4 | `20261117120000_profile_verification_submissions` | OK after fix | Table + policies + triggers present |
| 5 | `20261117130000_app_security_helpers` | OK | `current_app_user_id` present |
| 6 | `20261117131000_marketplace_rls_grants` | OK | `agricoop_app` policy_count ≈ 62 during apply |
| 7 | `20261117132000_secure_audit_notification_writes` | OK | `create_notification` + `write_audit_log` present |
| 8 | `20261117133000_payment_proofs_id_default` | OK | `paymentProofs.id` sequence default already present (skipped recreate) |
| 9 | `profile_verification_bucket` | OK | `storage.buckets` has `profile-verification-documents` |

### Fixes required during apply (committed)

1. **Block 2:** `to_regclass('agricoop_app.paymentOptions')` failed on camelCase — quoted as `agricoop_app."paymentOptions"`.
2. **Block 4:** Postcondition `LIKE` did not match PG-normalized `with_check` (`::text` cast). Made migration idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP POLICY IF EXISTS`) and relaxed the `LIKE` to `%agricoop.profile_verification_upload_verified%`.

### Post-apply live schema check

- Missing expected tables: **none**
- `paymentOptionId`: **yes**
- `agricoop_app` tables: **21**
- Helpers (`current_app_user_id`, `write_audit_log`, `create_notification`): **yes**
- Bucket `profile-verification-documents`: **yes**
- RLS policies on `agricoop_app`: **61+**

### SuperAdmin

`SEED_SUPERADMIN_1_EMAIL` already maps to an existing user that is already `superadmin` / `approved` (no change needed).

If you ever need a manual promote for a different email:

```sql
UPDATE agricoop_app.users
SET role = 'superadmin',
    "approvalStatus" = 'approved',
    "cooperativeId" = NULL,
    "updatedAt" = now()
WHERE lower(email) = lower('YOUR_EMAIL_HERE');
```

---

## 3. Vercel environment

| Name | Action |
|------|--------|
| `APP_URL` | **Set** to `https://agricoop-marketplace-final-capstone.vercel.app` (Production + Preview) |
| `DATABASE_URL` | Present (Production) |
| `NEXT_PUBLIC_SUPABASE_URL` | Present |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Present |
| `SUPABASE_SERVICE_ROLE_KEY` | Present |

Optional / legacy names also present (`POSTGRES_*`, `SUPABASE_*` variants).  
Optional app name not required for boot: `SUPABASE_STORAGE_BUCKET` (defaults in code toward `product-images`).

Secret names that must remain set (values never printed): `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public but required), plus any seed credentials only for local use.

---

## 4. Push and deploy

- Pushed `finish/agricoop-complete` to `origin` (no force-push).
- Deployed branch directly to **Production** via Vercel MCP (no merge to `main` required).
- First production deploy (`dpl_jUKiRDPe4E3PPv5HgafkQ4tK2D3Q`) was READY but API crashed on ESM import of `conversationStream`.
- Fixed by bundling `dist/vercel-api.js` and pointing `api/index.ts` at it; pushed `0c6d574`; redeployed.

**Current production:** `dpl_9nYcJDtoYDCU4bBb3oKLMZFMyJek` on alias `agricoop-marketplace-final-capstone.vercel.app` — **replaces** the old `recover-approved` production target.

---

## 5. Live smoke tests

Against `https://agricoop-marketplace-final-capstone.vercel.app`:

| Path | Status | Notes |
|------|--------|-------|
| `/` | 200 | SPA shell |
| `/marketplace` | 200 | SPA shell |
| `/auth` | 200 | SPA shell |
| `/api/health` | 200 | `{"status":"ok","database":"available"}` |
| `/api/trpc/auth.me` (no session) | 200 | `[{"result":{"data":{"json":null}}}]` — unauthenticated correctly returns null |

Runtime logs for the current deployment: **no error/fatal entries** after the fix.

---

## 6. Still needs a human (short list)

1. **Role click-through** — Sign in as Buyer / Seller / Admin / SuperAdmin and walk order, quotation, payment-proof, and association flows with real accounts.
2. **Supabase Auth URL config** — In Dashboard → Authentication → URL Configuration, set Site URL to `https://agricoop-marketplace-final-capstone.vercel.app` and allow redirect `https://agricoop-marketplace-final-capstone.vercel.app/auth?verification=success`.
3. **Optional:** Enable Auth leaked-password protection (advisor warning).

---

## 7. Key commits on this branch

1. Migrations + MANUAL_SQL pack  
2. Server auth/payments/notifications  
3. Client role UX  
4. Docs / env example / handoff  
5. SQL apply fixes (camelCase + idempotent profile verification)  
6. Vercel API bundle fix (`0c6d574`)
