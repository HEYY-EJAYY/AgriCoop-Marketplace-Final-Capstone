-- BLOCK 18: login lookup must not depend on revoked seller payment columns
-- PURPOSE: Document the production login outage after BLOCK 17.
-- BLOCK 17 correctly REVOKE'd authenticated/anon SELECT on
--   users.onlinePaymentQrPath / onlinePaymentAccountName /
--   onlinePaymentAccountNumber / onlinePaymentLabel.
-- The application login path (getUserByVerifiedAuthId → loadAuthIdentityRecords)
-- still SELECTed onlinePaymentQrPath under set_config(role=authenticated),
-- which raised Postgres 42501 and surfaced as application_database_access_denied.
-- FIX: code-only — remove those columns from the login SELECT. This migration is
-- intentionally a no-op DDL so deploy history records the decision without
-- restoring seller payment column grants.
-- IDEMPOTENT / ADDITIVE ONLY. No DROP / TRUNCATE / unscoped DELETE.

DO $$
BEGIN
  -- Guard: seller payment columns must remain unreadable to authenticated/anon.
  IF has_column_privilege('authenticated', 'agricoop_app.users', 'onlinePaymentQrPath', 'SELECT')
     OR has_column_privilege('anon', 'agricoop_app.users', 'onlinePaymentQrPath', 'SELECT') THEN
    RAISE NOTICE 'BLOCK 18 note: onlinePaymentQrPath is still SELECT-able by authenticated/anon; keep seller payment data closed.';
  ELSE
    RAISE NOTICE 'BLOCK 18 ok: onlinePaymentQrPath remains revoked for authenticated/anon.';
  END IF;
END $$;
