-- BLOCK 24: Fix fallthrough in registration cooperative-assign guard.
-- PL/pgSQL `NULL;` is a no-op; the prior BLOCK 23 body still raised P0001
-- after a matching GUC allow. Additive CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION agricoop_app.guard_users_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  actor_id integer := agricoop_app.current_app_user_id();
  actor_role text := agricoop_app.current_app_role();
  allow_reg_coop text := nullif(current_setting('agricoop.allow_registration_coop_assign', true), '');
BEGIN
  IF NEW."role" IS DISTINCT FROM OLD."role"
     OR NEW."approvalStatus" IS DISTINCT FROM OLD."approvalStatus"
     OR NEW."cooperativeId" IS DISTINCT FROM OLD."cooperativeId"
     OR NEW."verificationStatus" IS DISTINCT FROM OLD."verificationStatus"
     OR NEW."verifiedBy" IS DISTINCT FROM OLD."verifiedBy"
     OR NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt" THEN
    IF actor_id IS NULL THEN
      RAISE EXCEPTION 'Protected user fields require an authenticated application user';
    END IF;

    IF actor_id = OLD.id THEN
      IF NEW."role" IS DISTINCT FROM OLD."role"
         OR NEW."approvalStatus" IS DISTINCT FROM OLD."approvalStatus" THEN
        RAISE EXCEPTION 'Users cannot change their own role, approval status, or cooperative';
      END IF;
      IF NEW."cooperativeId" IS DISTINCT FROM OLD."cooperativeId" THEN
        IF NOT (
          allow_reg_coop = '1'
          AND OLD."cooperativeId" IS NULL
          AND NEW."cooperativeId" IS NOT NULL
          AND NEW."role" IS NOT DISTINCT FROM OLD."role"
          AND NEW."approvalStatus" IS NOT DISTINCT FROM OLD."approvalStatus"
        ) THEN
          RAISE EXCEPTION 'Users cannot change their own role, approval status, or cooperative';
        END IF;
      END IF;
    ELSIF actor_role NOT IN ('admin', 'superadmin') THEN
      RAISE EXCEPTION 'Only Admin or SuperAdmin can change protected user fields';
    ELSIF actor_role = 'admin'
          AND (
            OLD."cooperativeId" IS DISTINCT FROM agricoop_app.current_app_cooperative_id()
            OR NEW."cooperativeId" IS DISTINCT FROM agricoop_app.current_app_cooperative_id()
            OR NEW."role" = 'superadmin'
            OR OLD."role" = 'superadmin'
          ) THEN
      RAISE EXCEPTION 'Admin cannot change users outside their cooperative or promote SuperAdmin';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
