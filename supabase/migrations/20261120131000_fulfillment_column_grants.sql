-- products uses column-level INSERT/UPDATE grants for authenticated; grant the
-- new fulfillment classification columns the same privileges so sellers can
-- propose values and officers can verify them.

BEGIN;

GRANT INSERT ("fulfillmentType", "prepTimeDays", "capacityNote")
  ON agricoop_app.products TO authenticated;
GRANT UPDATE ("fulfillmentType", "prepTimeDays", "capacityNote")
  ON agricoop_app.products TO authenticated;

COMMIT;
