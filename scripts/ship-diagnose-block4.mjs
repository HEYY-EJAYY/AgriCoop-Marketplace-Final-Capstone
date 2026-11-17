import fs from "node:fs";
import postgres from "postgres";

function loadUrl() {
  const text = fs.readFileSync(".env.local", "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("DATABASE_URL=")) continue;
    let v = line.slice("DATABASE_URL=".length).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    return v;
  }
  throw new Error("DATABASE_URL missing");
}

const sqlText = fs.readFileSync(
  "supabase/migrations/20261117120000_profile_verification_submissions.sql",
  "utf8",
);
// Run migration without the failing postflight raise: comment out RAISE and replace with SELECT diagnostics.
const patched = sqlText
  .replace(
    /DO \$postflight\$[\s\S]*?\$postflight\$;/,
    `
DO $postflight$
DECLARE
  r record;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS block4_checks (
    check_name text PRIMARY KEY,
    ok boolean NOT NULL
  );
  TRUNCATE block4_checks;
  INSERT INTO block4_checks VALUES
    ('schema_usage', has_schema_privilege('authenticated', 'agricoop_app', 'USAGE')),
    ('submissions_select', has_table_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'SELECT')),
    ('userId_insert', has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'userId', 'INSERT')),
    ('storagePath_insert', has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'storagePath', 'INSERT')),
    ('mimeType_insert', has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'mimeType', 'INSERT')),
    ('fileSizeBytes_insert', has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'fileSizeBytes', 'INSERT')),
    ('status_insert_denied', NOT has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'status', 'INSERT')),
    ('reviewedBy_insert_denied', NOT has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'reviewedBy', 'INSERT')),
    ('reviewedAt_insert_denied', NOT has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'reviewedAt', 'INSERT')),
    ('reviewNote_insert_denied', NOT has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'reviewNote', 'INSERT')),
    ('table_insert_denied', NOT has_table_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'INSERT')),
    ('table_update_denied', NOT has_table_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'UPDATE')),
    ('table_delete_denied', NOT has_table_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'DELETE')),
    ('self_insert_policy', EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'agricoop_app'
         AND tablename = 'profileVerificationSubmissions'
         AND policyname = 'agricoop_profile_verification_self_insert'
         AND with_check LIKE '%current_setting(''agricoop.profile_verification_upload_verified'', true)%'
     )),
    ('status_update', has_column_privilege('authenticated', 'agricoop_app."profileVerificationSubmissions"', 'status', 'UPDATE')),
    ('users_verificationStatus_update', has_column_privilege('authenticated', 'agricoop_app.users', 'verificationStatus', 'UPDATE')),
    ('users_verifiedBy_update', has_column_privilege('authenticated', 'agricoop_app.users', 'verifiedBy', 'UPDATE')),
    ('audit_insert_denied', NOT has_any_column_privilege('authenticated', 'agricoop_app."auditLogs"', 'INSERT')),
    ('notifications_insert', has_any_column_privilege('authenticated', 'agricoop_app.notifications', 'INSERT')),
    ('notifications_select', has_table_privilege('authenticated', 'agricoop_app.notifications', 'SELECT')),
    ('notifications_isRead_update', has_column_privilege('authenticated', 'agricoop_app.notifications', 'isRead', 'UPDATE')),
    ('submissions_rls', (SELECT relrowsecurity FROM pg_class WHERE oid = 'agricoop_app."profileVerificationSubmissions"'::regclass)),
    ('review_fn_execute', has_function_privilege('authenticated', 'agricoop_app.can_review_profile_verification_user(integer)', 'EXECUTE')),
    ('audit_trigger', EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'agricoop_app."profileVerificationSubmissions"'::regclass
         AND tgname = 'agricoop_profile_verification_audit_event'
         AND tgenabled = 'O'
         AND NOT tgisinternal
     ));
END
$postflight$;
`,
  );

const sql = postgres(loadUrl(), { max: 1, prepare: false });
try {
  await sql.begin(async (tx) => {
    await tx.unsafe(patched);
    const rows = await tx`select check_name, ok from block4_checks order by check_name`;
    const failed = rows.filter((r) => !r.ok);
    console.log(JSON.stringify({ failed: failed.map((f) => f.check_name), all: rows }, null, 2));
    // Force rollback of diagnostic transaction
    throw new Error("DIAGNOSTIC_ROLLBACK");
  });
} catch (error) {
  if (error instanceof Error && error.message === "DIAGNOSTIC_ROLLBACK") {
    process.exit(0);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
