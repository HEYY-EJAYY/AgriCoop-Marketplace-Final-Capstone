-- BLOCK 35: Prevent direct request-state edits and route rejection through a scoped function.
-- Adds no data rows and preserves SELECT/INSERT permissions for authenticated users.
--
-- Read-only preview:
SELECT
  to_regclass('agricoop_app."cooperativeAssociationRequests"') AS requests_table,
  has_table_privilege(
    'authenticated',
    'agricoop_app."cooperativeAssociationRequests"',
    'UPDATE'
  ) AS authenticated_can_update_requests,
  to_regprocedure('agricoop_app.approve_cooperative_association_request(integer,text,boolean)')
    AS approval_function,
  to_regprocedure('agricoop_app.current_app_user_id()') AS actor_id_helper,
  to_regprocedure('agricoop_app.current_app_role()') AS actor_role_helper,
  to_regprocedure('agricoop_app.current_app_cooperative_id()') AS actor_cooperative_helper;

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('agricoop_app."cooperativeAssociationRequests"') IS NULL
     OR to_regprocedure('agricoop_app.approve_cooperative_association_request(integer,text,boolean)') IS NULL
     OR to_regprocedure('agricoop_app.current_app_user_id()') IS NULL
     OR to_regprocedure('agricoop_app.current_app_role()') IS NULL
     OR to_regprocedure('agricoop_app.current_app_cooperative_id()') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'agricoop_app'
         AND table_name = 'cooperativeAssociationRequests'
         AND column_name IN ('status', 'reviewedBy', 'reviewNote', 'reviewedAt', 'moveExistingListings')
       GROUP BY table_schema, table_name
       HAVING count(*) = 5
     ) THEN
    RAISE EXCEPTION
      'Association review security migration stopped: expected request columns, approval function, and actor helpers';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION agricoop_app.reject_cooperative_association_request(
  p_request_id integer,
  p_review_note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id integer;
  actor_role text;
  actor_cooperative_id integer;
  target_cooperative_id integer;
  request_status text;
  changed_count integer;
BEGIN
  actor_id := agricoop_app.current_app_user_id();
  actor_role := agricoop_app.current_app_role();
  actor_cooperative_id := agricoop_app.current_app_cooperative_id();

  IF actor_id IS NULL OR actor_role IS NULL OR actor_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Only Admin or SuperAdmin can reject an association request'
      USING ERRCODE = '42501';
  END IF;
  IF p_review_note IS NULL OR length(btrim(p_review_note)) = 0 OR length(btrim(p_review_note)) > 600 THEN
    RAISE EXCEPTION 'A review note of 1 to 600 characters is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT request."cooperativeId", request.status::text
  INTO target_cooperative_id, request_status
  FROM agricoop_app."cooperativeAssociationRequests" AS request
  WHERE request.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR request_status <> 'pending' THEN
    RAISE EXCEPTION 'This association request is no longer pending'
      USING ERRCODE = '23514';
  END IF;
  IF actor_role = 'admin'
     AND (actor_cooperative_id IS NULL OR actor_cooperative_id <> target_cooperative_id) THEN
    RAISE EXCEPTION 'Admin cannot reject requests for another cooperative'
      USING ERRCODE = '42501';
  END IF;

  UPDATE agricoop_app."cooperativeAssociationRequests"
  SET status = 'rejected',
      "reviewedBy" = actor_id,
      "reviewNote" = btrim(p_review_note),
      "moveExistingListings" = false,
      "reviewedAt" = transaction_timestamp()
  WHERE id = p_request_id AND status = 'pending';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 1 THEN
    RAISE EXCEPTION 'This association request changed while being reviewed'
      USING ERRCODE = '23514';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION agricoop_app.reject_cooperative_association_request(integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION agricoop_app.reject_cooperative_association_request(integer, text)
  TO authenticated;

REVOKE UPDATE ON TABLE agricoop_app."cooperativeAssociationRequests" FROM authenticated;

DO $postflight$
BEGIN
  IF has_table_privilege(
       'authenticated',
       'agricoop_app."cooperativeAssociationRequests"',
       'UPDATE'
     )
     OR has_column_privilege(
       'authenticated',
       'agricoop_app."cooperativeAssociationRequests"',
       'status',
       'UPDATE'
     )
     OR has_column_privilege(
       'authenticated',
       'agricoop_app."cooperativeAssociationRequests"',
       'reviewedBy',
       'UPDATE'
     )
     OR has_column_privilege(
       'authenticated',
       'agricoop_app."cooperativeAssociationRequests"',
       'reviewedAt',
       'UPDATE'
     )
     OR has_column_privilege(
       'authenticated',
       'agricoop_app."cooperativeAssociationRequests"',
       'reviewNote',
       'UPDATE'
     )
     OR has_column_privilege(
       'authenticated',
       'agricoop_app."cooperativeAssociationRequests"',
       'moveExistingListings',
       'UPDATE'
     )
     OR has_column_privilege(
       'authenticated',
       'agricoop_app."cooperativeAssociationRequests"',
       'sellerId',
       'UPDATE'
     )
     OR has_column_privilege(
       'authenticated',
       'agricoop_app."cooperativeAssociationRequests"',
       'cooperativeId',
       'UPDATE'
     )
     OR has_column_privilege(
       'authenticated',
       'agricoop_app."cooperativeAssociationRequests"',
       'message',
       'UPDATE'
     )
     OR to_regprocedure('agricoop_app.reject_cooperative_association_request(integer,text)') IS NULL
     OR NOT has_function_privilege(
       'authenticated',
       'agricoop_app.reject_cooperative_association_request(integer,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Association review security migration verification failed';
  END IF;
END;
$postflight$;

COMMIT;
