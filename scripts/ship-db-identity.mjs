import fs from "node:fs";
import postgres from "postgres";

const text = fs.readFileSync(".env.local", "utf8");
const map = {};
for (const line of text.split(/\r?\n/)) {
  if (!line || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i < 0) continue;
  let v = line.slice(i + 1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  map[line.slice(0, i).trim()] = v;
}

const url = map.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");
const normalized = url.replace(/^postgresql:/, "postgres:");
const u = new URL(normalized);
const refFromHost = u.hostname.split(".")[0];
let supabaseRef = null;
try {
  supabaseRef = new URL(map.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
} catch {
  supabaseRef = null;
}

console.log(
  JSON.stringify(
    {
      db: u.pathname.replace(/^\//, ""),
      port: u.port || "5432",
      hostSuffix: u.hostname.split(".").slice(-3).join("."),
      hostLooksLikePooler: u.hostname.includes("pooler"),
      dbRefGuess: refFromHost,
      supabaseProjectRef: supabaseRef,
      refsMatch: refFromHost === supabaseRef || u.hostname.includes(supabaseRef || "___"),
      userKind: u.username.includes(".") ? "pooler_user" : "direct_user",
    },
    null,
    2,
  ),
);

const sql = postgres(url, { max: 1, prepare: false });
try {
  const rows = await sql`
    select current_database() as db,
           current_user as usr,
           to_regclass('agricoop_app.users')::text as users,
           to_regclass('agricoop_app.paymentOptions')::text as payment_options,
           to_regclass('agricoop_app."paymentOptions"')::text as payment_options_quoted,
           (select count(*)::int from information_schema.tables where table_schema='agricoop_app') as table_count,
           (select array_agg(table_name order by table_name)
              from information_schema.tables
             where table_schema='agricoop_app' and table_type='BASE TABLE') as tables
  `;
  console.log(JSON.stringify(rows[0], null, 2));
} finally {
  await sql.end({ timeout: 5 });
}
