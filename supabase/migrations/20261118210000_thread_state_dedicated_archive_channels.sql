-- PURPOSE: Give seller orders and quotations collision-free per-user archive channels.
-- ADDITIVE ONLY. Preserves the existing CHECK expression and adds two values.
--
-- Read-only preview to run before applying this migration:
-- SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
-- FROM pg_constraint c
-- WHERE c.conrelid = to_regclass('agricoop_app."threadStates"')
--   AND c.conname = 'thread_states_channel_check';
--
-- The repository's current definition includes conversation, ticket, support, order.
-- This migration preserves the live predicate, including any additional current values.

BEGIN;

DO $expand$
DECLARE
  constraint_oid oid;
  constraint_expression text;
  constraint_definition text;
BEGIN
  IF to_regclass('agricoop_app."threadStates"') IS NULL THEN
    RAISE EXCEPTION 'threadStates missing before dedicated archive channel migration';
  END IF;
  SELECT oid, pg_get_expr(conbin, conrelid), pg_get_constraintdef(oid)
    INTO constraint_oid, constraint_expression, constraint_definition
  FROM pg_constraint
  WHERE conrelid = 'agricoop_app."threadStates"'::regclass
    AND conname = 'thread_states_channel_check'
    AND contype = 'c';
  IF constraint_oid IS NULL OR constraint_expression IS NULL THEN
    RAISE EXCEPTION 'thread_states_channel_check missing before dedicated archive channel migration';
  END IF;

  IF constraint_definition NOT LIKE '%seller_order%'
     OR constraint_definition NOT LIKE '%quotation%' THEN
    ALTER TABLE agricoop_app."threadStates"
      DROP CONSTRAINT thread_states_channel_check;
    EXECUTE format(
      'ALTER TABLE agricoop_app."threadStates" ADD CONSTRAINT thread_states_channel_check CHECK ((%s) OR channel IN (%L, %L))',
      constraint_expression,
      'seller_order',
      'quotation'
    );
  END IF;
END;
$expand$;

DO $verify$
DECLARE
  constraint_definition text;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO constraint_definition
  FROM pg_constraint
  WHERE conrelid = 'agricoop_app."threadStates"'::regclass
    AND conname = 'thread_states_channel_check';

  IF constraint_definition IS NULL
     OR constraint_definition NOT LIKE '%seller_order%'
     OR constraint_definition NOT LIKE '%quotation%' THEN
    RAISE EXCEPTION 'thread_states_channel_check missing expected archive channel values';
  END IF;
END;
$verify$;

COMMIT;
