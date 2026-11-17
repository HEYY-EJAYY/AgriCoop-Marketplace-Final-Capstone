# Production Migration Runbook

**Local preparation only. You (owner) run all SQL in the Supabase SQL Editor.**  
Confirm a Supabase backup / PITR restore point exists before any migration.

## (a) PRE-RUN read-only queries

Run [`supabase/PRODUCTION_CATALOG_INSPECTION.sql`](../supabase/PRODUCTION_CATALOG_INSPECTION.sql) in the verified production project, plus:

```sql
-- Migration history
SELECT version, name, inserted_at
FROM supabase_migrations.schema_migrations
ORDER BY version;

-- Session / login capabilities
SELECT current_user, session_user,
       (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass_rls,
       (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super;

SELECT r.rolname, m.rolname AS member_of
FROM pg_auth_members am
JOIN pg_roles r ON r.oid = am.member
JOIN pg_roles m ON m.oid = am.roleid
WHERE r.rolname = current_user;

-- Existing agricoop_app tables + RLS
SELECT c.relname, c.relrowsecurity,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'agricoop_app' AND p.tablename = c.relname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'agricoop_app' AND c.relkind = 'r'
ORDER BY 1;

-- Enum labels of interest
SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder)
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'agricoop_app'
  AND t.typname IN ('order_status','order_payment_status','transaction_status','user_role')
GROUP BY 1;

-- paymentProofs.id default?
SELECT column_default FROM information_schema.columns
WHERE table_schema = 'agricoop_app' AND table_name = 'paymentProofs' AND column_name = 'id';

-- Row counts (no PII)
SELECT 'users' AS t, count(*) FROM agricoop_app.users
UNION ALL SELECT 'products', count(*) FROM agricoop_app.products
UNION ALL SELECT 'orders', count(*) FROM agricoop_app.orders
UNION ALL SELECT 'transactions', count(*) FROM agricoop_app.transactions
UNION ALL SELECT 'paymentProofs', count(*) FROM agricoop_app."paymentProofs";

-- get_my_role dependencies (B11) — do not change EXECUTE until reviewed
SELECT p.proname, p.prosecdef, p.proconfig,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'get_my_role';

SELECT pol.polname, c.relname
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
WHERE pg_get_expr(pol.polqual, pol.polrelid) ILIKE '%get_my_role%'
   OR pg_get_expr(pol.polwithcheck, pol.polrelid) ILIKE '%get_my_role%';

-- Storage buckets
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('product-images','payment-proofs','profile-verification-documents');
```

Expected baseline (from prior user-supplied reports — **re-verify**): history may show only `20261016115411` and `20261016120149`; 12 existing marketplace tables with RLS on and 0 policies; eight application tables + verification table absent; `profile-verification-documents` missing.

## (b) Run order (SQL Editor)

| Step | File | Action |
|---|---|---|
| 0 | Backup / PITR | Confirm |
| 1 | `20261117100000_auth_profile_access.sql` | RUN if not applied |
| 2 | `20261117105000_active_application_tables.sql` | RUN if tables absent |
| 3 | `20261117110000_transaction_payment_option.sql` | RUN if column absent |
| 4 | `20261117120000_profile_verification_submissions.sql` | RUN if table absent |
| 5 | `20261117130000_app_security_helpers.sql` | RUN |
| 6 | `20261117131000_marketplace_rls_grants.sql` | RUN |
| 7 | `20261117132000_secure_audit_notification_writes.sql` | RUN (supersedes mig-4 notification INSERT policy) |
| 8 | `20261117133000_payment_proofs_id_default.sql` | RUN if id has no default |
| 9 | `supabase/storage/profile_verification_bucket.sql` | RUN if bucket missing (refuses mismatch) |

### SKIP / do not run

| Artifact | Reason |
|---|---|
| `supabase/rls.sql` | DEPRECATED obsolete model |
| `drizzle/0000–0011_*.sql` | LEGACY MySQL |
| `scripts/migration-templates/postgresql/payment_option_link.sql` | **SUPERSEDED (B5)** — use transactions.paymentOptionId |
| `scripts/migration-templates/postgresql/payment_proof_storage.sql` | **DEPRECATED** — UPSERT-overwrite unsafe |
| `order_cancel_payment.sql` / `refund_order_payment_status.sql` | REVIEW ONLY — isolate `ALTER TYPE ... ADD VALUE` if ever needed; current cancel path does not require `cancelled` on payment enum |
| Other templates (`product_images`, `cooperative_association_requests`, `support_ticket_messages`) | Covered by `20261117105000` |

**Do not** run `pnpm db:push`, `drizzle-kit migrate/push`, or `supabase db push` against production from this repo.

## (c) POST-RUN verification

```sql
-- New tables exist + RLS on
SELECT relname, relrowsecurity FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'agricoop_app'
  AND relname IN ('cooperativeAssociationRequests','productImages','payments','paymentEvents',
                  'notifications','supportTickets','supportTicketMessages','auditLogs',
                  'profileVerificationSubmissions');

-- Policy counts non-zero for marketplace tables
SELECT tablename, count(*) FROM pg_policies WHERE schemaname = 'agricoop_app' GROUP BY 1 ORDER BY 1;

-- authenticated cannot INSERT audit/notifications directly
SELECT has_any_column_privilege('authenticated', 'agricoop_app."auditLogs"', 'INSERT') AS audit_insert, -- false
       has_any_column_privilege('authenticated', 'agricoop_app.notifications', 'INSERT') AS notif_insert; -- false

-- Definer writers exist
SELECT proname FROM pg_proc
WHERE pronamespace = 'agricoop_app'::regnamespace
  AND proname IN ('write_audit_log','create_notification','current_app_user_id');

-- transactions.paymentOptionId
SELECT attname, attnotnull FROM pg_attribute
WHERE attrelid = 'agricoop_app.transactions'::regclass AND attname = 'paymentOptionId';

-- Bucket
SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'profile-verification-documents';
```

## (d) Rollback

Each migration file ends with commented ROLLBACK steps. Prefer restoring from PITR if mid-sequence failure leaves partial grants. Order of undo (last applied first): 33000 → 32000 → 31000 → 30000 → 120000 → 110000 → 105000 → 100000.

## (e) Backup reminder

Confirm Dashboard backup / PITR before step 1.

## (f) Post-run smoke tests (manual)

1. Sign in as Buyer, Seller, Admin, SuperAdmin — `auth.me` resolves.
2. Anon/buyer marketplace list shows only approved+visible products.
3. Buyer places order; transaction row has optional `paymentOptionId`.
4. Buyer uploads GCash proof; Admin (same coop, not participant) reviews.
5. Seller cannot verify own order payment.
6. Admin cannot see other coop payment proofs.
7. Support ticket + notification appear for recipient.
8. Audit log readable by Admin (coop) / SuperAdmin (all) after Phase 4 UI ships.
9. No duplicate active paymentProof per order.
10. Stock: two concurrent checkouts on last unit — one fails (harness proves locally).
