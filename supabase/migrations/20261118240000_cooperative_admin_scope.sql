-- BLOCK 34: Scope cooperative staff visibility and mutations by cooperative.
-- Additive and idempotent. Do not execute against production without approval.

-- Read-only preflight preview:
SELECT policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'agricoop_app'
  AND tablename = 'cooperatives'
  AND policyname IN (
    'agricoop_mkt_cooperatives_anon_read',
    'agricoop_mkt_cooperatives_staff_write'
  )
ORDER BY policyname;

SELECT to_regprocedure('agricoop_app.shares_cooperative(integer)') AS cooperative_scope_helper;

DO $preflight$
BEGIN
  IF to_regprocedure('agricoop_app.shares_cooperative(integer)') IS NULL THEN
    RAISE EXCEPTION
      'BLOCK 34 stopped: agricoop_app.shares_cooperative(integer) is missing; reconcile the security helper migration before changing cooperative policies';
  END IF;
END
$preflight$;

BEGIN;

DROP POLICY IF EXISTS agricoop_mkt_cooperatives_anon_read ON agricoop_app.cooperatives;
CREATE POLICY agricoop_mkt_cooperatives_anon_read
  ON agricoop_app.cooperatives FOR SELECT TO anon, authenticated
  USING ("deletedAt" IS NULL AND status = 'active');

DROP POLICY IF EXISTS agricoop_mkt_cooperatives_staff_write ON agricoop_app.cooperatives;
CREATE POLICY agricoop_mkt_cooperatives_staff_write
  ON agricoop_app.cooperatives FOR ALL TO authenticated
  USING (agricoop_app.shares_cooperative(id))
  WITH CHECK (agricoop_app.shares_cooperative(id));

COMMIT;
