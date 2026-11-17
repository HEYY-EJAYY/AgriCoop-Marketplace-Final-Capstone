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
const patched = sqlText.replace(
  /DO \$postflight\$[\s\S]*?\$postflight\$;/,
  `
DO $postflight$
BEGIN
  -- keep objects for inspection inside this aborted transaction via temp copy
  CREATE TEMP TABLE block4_policy AS
  SELECT policyname, with_check
  FROM pg_policies
  WHERE schemaname = 'agricoop_app'
    AND tablename = 'profileVerificationSubmissions'
    AND policyname = 'agricoop_profile_verification_self_insert';
END
$postflight$;
`,
);

const sql = postgres(loadUrl(), { max: 1, prepare: false });
try {
  await sql.begin(async (tx) => {
    await tx.unsafe(patched);
    const rows = await tx`select policyname, with_check from block4_policy`;
    console.log(JSON.stringify(rows, null, 2));
    throw new Error("DIAGNOSTIC_ROLLBACK");
  });
} catch (error) {
  if (!(error instanceof Error && error.message === "DIAGNOSTIC_ROLLBACK")) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
} finally {
  await sql.end({ timeout: 5 });
}
