-- BLOCK 19: registration users INSERT must not require seller payment columns
-- PURPOSE: Document that public registration upserts agricoop_app.users with an
-- explicit column list that omits onlinePayment* (BLOCK 17 REVOKEd INSERT/SELECT
-- on those columns). Drizzle's full-table insert listed every column as DEFAULT and
-- failed with 42501. No privilege restore of payment columns.
-- IDEMPOTENT notice-only guard.

DO $$
BEGIN
  IF has_column_privilege('authenticated', 'agricoop_app.users', 'onlinePaymentQrPath', 'INSERT')
     OR has_column_privilege('authenticated', 'agricoop_app.users', 'onlinePaymentQrPath', 'SELECT') THEN
    RAISE NOTICE 'BLOCK 19 note: onlinePaymentQrPath still privileged for authenticated; keep seller payment data closed.';
  ELSE
    RAISE NOTICE 'BLOCK 19 ok: onlinePaymentQrPath remains closed for authenticated INSERT/SELECT.';
  END IF;
END $$;
