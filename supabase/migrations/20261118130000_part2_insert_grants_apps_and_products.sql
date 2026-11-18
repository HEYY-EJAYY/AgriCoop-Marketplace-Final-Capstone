-- BLOCK 22: tighten INSERT grants for Part 2 registration applications and product defaults.
-- Drizzle expanded INSERT lists were hitting 42501 on ungranted DEFAULT columns.

GRANT INSERT (
  "userId", "fullName", "cooperativeId", "positionTitle",
  "idDocumentPath", "proofDocumentPath", status
) ON TABLE agricoop_app."cooperativeAdminApplications" TO authenticated;

GRANT INSERT ("updatedAt") ON TABLE agricoop_app.products TO authenticated;

DO $postflight$
BEGIN
  IF NOT has_column_privilege(
        'authenticated',
        'agricoop_app."cooperativeAdminApplications"',
        'userId',
        'INSERT'
     )
     OR NOT has_column_privilege('authenticated', 'agricoop_app.products', 'updatedAt', 'INSERT')
  THEN
    RAISE EXCEPTION 'part2_insert_grants_apps_and_products postflight failed';
  END IF;
END
$postflight$;