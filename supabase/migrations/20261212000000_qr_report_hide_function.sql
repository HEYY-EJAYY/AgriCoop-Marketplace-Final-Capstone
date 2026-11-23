-- QR issue reports: buyers/sellers cannot UPDATE paymentOptions under RLS
-- (write policy requires staff/superadmin), so the reportIssue transaction's
-- deactivation silently affected 0 rows. This SECURITY DEFINER function lets a
-- valid reporter hide the reported option atomically with the report insert.
-- Guarded: only deactivates when the caller has a pending report for that
-- option, and only ever sets isActive = false (never re-activates).

CREATE OR REPLACE FUNCTION agricoop_app.deactivate_reported_payment_option(p_option_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM agricoop_app."qrIssueReports" r
    WHERE r."paymentOptionId" = p_option_id
      AND r."reportedBy" = agricoop_app.current_app_user_id()
      AND r."status" = 'pending'
  ) THEN
    RAISE EXCEPTION 'No pending QR issue report exists for this payment option.';
  END IF;

  UPDATE agricoop_app."paymentOptions"
  SET "isActive" = false, "updatedAt" = now()
  WHERE id = p_option_id AND "isActive" = true;
END;
$fn$;

REVOKE ALL ON FUNCTION agricoop_app.deactivate_reported_payment_option(integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION agricoop_app.deactivate_reported_payment_option(integer) TO authenticated;
