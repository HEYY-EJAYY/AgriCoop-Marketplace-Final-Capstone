/**
 * Promote SEED_SUPERADMIN_1_EMAIL to superadmin if the user row exists.
 * Never prints email or secrets.
 */
import fs from "node:fs";
import postgres from "postgres";

function loadEnv() {
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
    )
      v = v.slice(1, -1);
    map[line.slice(0, i).trim()] = v;
  }
  return map;
}

const env = loadEnv();
const email = env.SEED_SUPERADMIN_1_EMAIL?.trim().toLowerCase();
if (!email) {
  console.log("NO_SEED_SUPERADMIN_EMAIL");
  process.exit(0);
}

const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false });
try {
  const before = await sql`
    select count(*)::int as n
    from agricoop_app.users
    where lower(email) = ${email}
  `;
  if (before[0].n === 0) {
    console.log("SUPERADMIN_EMAIL_NOT_IN_USERS");
    process.exit(0);
  }
  const updated = await sql`
    update agricoop_app.users
    set role = 'superadmin',
        "approvalStatus" = 'approved',
        "cooperativeId" = null,
        "updatedAt" = now()
    where lower(email) = ${email}
      and (role is distinct from 'superadmin' or "approvalStatus" is distinct from 'approved')
    returning id
  `;
  console.log(
    JSON.stringify({
      matched: before[0].n,
      updated: updated.length,
      status: updated.length ? "promoted" : "already_superadmin",
    }),
  );
} finally {
  await sql.end({ timeout: 5 });
}
