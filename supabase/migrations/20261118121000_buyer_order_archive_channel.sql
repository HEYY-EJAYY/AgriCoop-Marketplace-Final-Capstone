-- PURPOSE: Allow per-buyer order archive state via threadStates.channel = 'order'.
-- ADDITIVE ONLY. Does not alter orders rows or seller/admin views.

BEGIN;

ALTER TABLE agricoop_app."threadStates"
  DROP CONSTRAINT IF EXISTS thread_states_channel_check;

ALTER TABLE agricoop_app."threadStates"
  ADD CONSTRAINT thread_states_channel_check
  CHECK (channel IN ('conversation', 'ticket', 'support', 'order'));

COMMIT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'thread_states_channel_check'
      AND conrelid = 'agricoop_app."threadStates"'::regclass
  ) THEN
    RAISE EXCEPTION 'thread_states_channel_check missing after buyer order archive migration';
  END IF;
END $$;
