/**
 * Apply MANUAL_SQL / supabase migration blocks one at a time.
 * Never logs connection strings or secrets.
 *
 * Usage: node scripts/ship-apply-sql.mjs [blockNumber]
 *   no args  -> apply next pending block
 *   N        -> apply only block N (1-based)
 *   status   -> print apply log
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const ROOT = process.cwd();
const LOG_PATH = path.join(ROOT, ".local", "sql-apply-log.json");
const ENV_PATH = path.join(ROOT, ".env.local");

const BLOCKS = [
  {
    n: 1,
    name: "auth_profile_access",
    file: "supabase/migrations/20261117100000_auth_profile_access.sql",
    verify: `
      SELECT
        has_schema_privilege('authenticated', 'agricoop_app', 'USAGE') AS auth_usage,
        (SELECT count(*)::int FROM pg_policies WHERE schemaname='agricoop_app' AND tablename='users') AS users_policies,
        (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename='profiles') AS profiles_policies,
        to_regprocedure('public.agricoop_profile_visible(uuid)') IS NOT NULL AS visibility_fn
    `,
    expect: (row) =>
      row.auth_usage === true &&
      row.users_policies === 3 &&
      row.profiles_policies === 2 &&
      row.visibility_fn === true,
  },
  {
    n: 2,
    name: "active_application_tables",
    file: "supabase/migrations/20261117105000_active_application_tables.sql",
    verify: `
      SELECT array_agg(c.relname ORDER BY c.relname) AS tables
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'agricoop_app'
        AND c.relkind = 'r'
        AND c.relname = ANY (ARRAY[
          'cooperativeAssociationRequests','productImages','payments','paymentEvents',
          'notifications','supportTickets','supportTicketMessages','auditLogs'
        ])
    `,
    expect: (row) =>
      Array.isArray(row.tables) &&
      row.tables.length === 8,
  },
  {
    n: 3,
    name: "transaction_payment_option",
    file: "supabase/migrations/20261117110000_transaction_payment_option.sql",
    verify: `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='agricoop_app' AND table_name='transactions' AND column_name='paymentOptionId'
      ) AS has_payment_option_id
    `,
    expect: (row) => row.has_payment_option_id === true,
  },
  {
    n: 4,
    name: "profile_verification_submissions",
    file: "supabase/migrations/20261117120000_profile_verification_submissions.sql",
    verify: `
      SELECT to_regclass('agricoop_app."profileVerificationSubmissions"') IS NOT NULL AS has_table
    `,
    expect: (row) => row.has_table === true,
  },
  {
    n: 5,
    name: "app_security_helpers",
    file: "supabase/migrations/20261117130000_app_security_helpers.sql",
    verify: `
      SELECT
        to_regprocedure('agricoop_app.current_app_user_id()') IS NOT NULL AS has_current_user,
        to_regprocedure('agricoop_app.write_audit_log(integer,text,text,integer,integer,jsonb)') IS NOT NULL
          OR to_regprocedure('agricoop_app.write_audit_log(integer, text, text, integer, integer, jsonb)') IS NOT NULL AS has_audit
    `,
    expect: (row) => row.has_current_user === true,
  },
  {
    n: 6,
    name: "marketplace_rls_grants",
    file: "supabase/migrations/20261117131000_marketplace_rls_grants.sql",
    verify: `
      SELECT count(*)::int AS policy_count
      FROM pg_policies
      WHERE schemaname = 'agricoop_app'
    `,
    expect: (row) => row.policy_count > 0,
  },
  {
    n: 7,
    name: "secure_audit_notification_writes",
    file: "supabase/migrations/20261117132000_secure_audit_notification_writes.sql",
    verify: `
      SELECT
        to_regprocedure('agricoop_app.create_notification(integer,text,text,text,text,integer,text)') IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'agricoop_app' AND p.proname = 'create_notification'
          ) AS has_create_notification,
        to_regprocedure('agricoop_app.write_audit_log(integer,text,text,integer,integer,jsonb)') IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'agricoop_app' AND p.proname = 'write_audit_log'
          ) AS has_write_audit
    `,
    expect: (row) => row.has_create_notification === true && row.has_write_audit === true,
  },
  {
    n: 8,
    name: "payment_proofs_id_default",
    file: "supabase/migrations/20261117133000_payment_proofs_id_default.sql",
    verify: `
      SELECT column_default IS NOT NULL AS has_default
      FROM information_schema.columns
      WHERE table_schema='agricoop_app' AND table_name='paymentProofs' AND column_name='id'
    `,
    expect: (row) => row.has_default === true,
  },
  {
    n: 9,
    name: "profile_verification_bucket",
    file: "supabase/storage/profile_verification_bucket.sql",
    verify: `
      SELECT EXISTS (
        SELECT 1 FROM storage.buckets WHERE id = 'profile-verification-documents'
      ) AS has_bucket
    `,
    expect: (row) => row.has_bucket === true,
  },
];

function loadEnvLocal() {
  if (!fs.existsSync(ENV_PATH)) throw new Error(".env.local missing");
  const text = fs.readFileSync(ENV_PATH, "utf8");
  const map = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    map[key] = val;
  }
  return map;
}

function readLog() {
  if (!fs.existsSync(LOG_PATH)) return { blocks: [] };
  return JSON.parse(fs.readFileSync(LOG_PATH, "utf8"));
}

function writeLog(log) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

function stripExplicitTransaction(sql) {
  // Avoid nested BEGIN/COMMIT interacting badly with drivers/poolers.
  return sql
    .replace(/^\s*BEGIN\s*;/im, "")
    .replace(/\bCOMMIT\s*;\s*$/im, "");
}

async function applyBlock(sql, block) {
  const env = loadEnvLocal();
  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing from .env.local");
  const sqlClient = postgres(url, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 30,
    prepare: false,
  });
  try {
    await sqlClient.unsafe(stripExplicitTransaction(sql));
    const rows = await sqlClient.unsafe(block.verify);
    const row = rows[0] ?? {};
    const ok = block.expect(row);
    return { ok, row };
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
}

async function main() {
  const arg = process.argv[2] ?? "next";
  const log = readLog();

  if (arg === "status") {
    console.log(JSON.stringify(log, null, 2));
    return;
  }

  let target;
  if (arg === "next") {
    const done = new Set(log.blocks.filter((b) => b.status === "ok").map((b) => b.n));
    target = BLOCKS.find((b) => !done.has(b.n));
    if (!target) {
      console.log("ALL_BLOCKS_DONE");
      return;
    }
  } else {
    const n = Number(arg);
    target = BLOCKS.find((b) => b.n === n);
    if (!target) throw new Error(`Unknown block ${arg}`);
  }

  const fullPath = path.join(ROOT, target.file);
  const sql = fs.readFileSync(fullPath, "utf8");
  console.log(`APPLYING_BLOCK_${target.n}_${target.name}`);
  try {
    const result = await applyBlock(sql, target);
    const entry = {
      n: target.n,
      name: target.name,
      file: target.file,
      status: result.ok ? "ok" : "verify_failed",
      verifiedAt: new Date().toISOString(),
      verifyRow: result.row,
    };
    log.blocks = [...log.blocks.filter((b) => b.n !== target.n), entry];
    writeLog(log);
    if (!result.ok) {
      console.error(`VERIFY_FAILED_BLOCK_${target.n}`);
      console.error(JSON.stringify(result.row));
      process.exit(2);
    }
    console.log(`OK_BLOCK_${target.n}`);
    console.log(JSON.stringify(result.row));
  } catch (error) {
    const entry = {
      n: target.n,
      name: target.name,
      file: target.file,
      status: "error",
      failedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    };
    log.blocks = [...log.blocks.filter((b) => b.n !== target.n), entry];
    writeLog(log);
    console.error(`ERROR_BLOCK_${target.n}`);
    console.error(entry.message);
    process.exit(1);
  }
}

main();
