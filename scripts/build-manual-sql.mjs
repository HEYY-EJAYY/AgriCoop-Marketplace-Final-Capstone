import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "supabase", "migrations");
const files = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
const bucket = join(root, "supabase", "storage", "profile_verification_bucket.sql");

const lines = [
  "# MANUAL SQL — paste into Supabase SQL Editor",
  "",
  "**Agent does not execute this against production.** Run after backup/PITR confirmation.",
  "",
  "Project: AgriCoop Marketplace (`adxprwseqawqrwuijata`)",
  "",
  "Live baseline (read-only, 2026-11-17):",
  "- Migration history: `20261016115411`, `20261016120149` only",
  "- 12 `agricoop_app` tables, RLS enabled, **0 policies**",
  "- Missing: cooperativeAssociationRequests, productImages, payments, paymentEvents, notifications, supportTickets, supportTicketMessages, auditLogs, profileVerificationSubmissions",
  "- Missing column: `transactions.paymentOptionId`",
  "- `paymentProofs.id` already has a sequence default (block 8 skips recreate)",
  "- Buckets: product-images (public), payment-proofs (private); profile-verification-documents **missing**",
  "- `authenticated` lacks USAGE on `agricoop_app` and SELECT on users (blocks app after SET ROLE)",
  "",
  "Run **one block at a time**. Stop on any RAISE EXCEPTION and reconcile before continuing.",
  "",
  "---",
  "",
];

let n = 1;
for (const file of files) {
  const body = readFileSync(join(dir, file), "utf8").trim();
  lines.push(`## BLOCK ${n}: \`${file}\``);
  lines.push("");
  lines.push("```sql");
  lines.push(body);
  lines.push("```");
  lines.push("");
  lines.push("---");
  lines.push("");
  n += 1;
}

if (existsSync(bucket)) {
  lines.push(`## BLOCK ${n}: \`supabase/storage/profile_verification_bucket.sql\` (Storage)`);
  lines.push("");
  lines.push("```sql");
  lines.push(readFileSync(bucket, "utf8").trim());
  lines.push("```");
  lines.push("");
}

writeFileSync(join(root, "docs", "MANUAL_SQL.md"), lines.join("\n"));
console.log(`Wrote docs/MANUAL_SQL.md (${files.length} migrations + bucket)`);
