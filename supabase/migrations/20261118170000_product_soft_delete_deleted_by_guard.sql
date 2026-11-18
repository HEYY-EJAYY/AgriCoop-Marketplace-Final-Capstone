-- BLOCK 27: Prevent forged products.deletedBy on soft-delete.
-- Additive / idempotent. Sellers soft-delete only own rows (RLS). deletedBy must
-- equal the acting application user; never another user's id.

CREATE OR REPLACE FUNCTION agricoop_app.guard_products_deleted_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = agricoop_app, public
AS $$
DECLARE
  actor_id integer := agricoop_app.current_app_user_id();
BEGIN
  IF NEW."deletedBy" IS NOT DISTINCT FROM OLD."deletedBy" THEN
    RETURN NEW;
  END IF;

  IF NEW."deletedBy" IS NULL THEN
    RETURN NEW;
  END IF;

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Products deletedBy requires an authenticated application user'
      USING ERRCODE = '42501';
  END IF;

  IF NEW."deletedBy" = actor_id THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Products deletedBy must equal the acting application user'
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_products_deleted_by ON agricoop_app.products;
CREATE TRIGGER trg_guard_products_deleted_by
  BEFORE UPDATE OF "deletedBy" ON agricoop_app.products
  FOR EACH ROW
  EXECUTE FUNCTION agricoop_app.guard_products_deleted_by();

REVOKE ALL ON FUNCTION agricoop_app.guard_products_deleted_by() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agricoop_app.guard_products_deleted_by() TO authenticated;
