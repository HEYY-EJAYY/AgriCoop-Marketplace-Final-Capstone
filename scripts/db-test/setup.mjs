#!/usr/bin/env node
/**
 * Apply bootstrap + ordered migrations to TEST_DATABASE_URL (localhost only).
 * Usage: TEST_DATABASE_URL=postgresql://agricoop_login:agricoop_test_password@127.0.0.1:55432/agricoop_test node scripts/db-test/setup.mjs
 *
 * supabase/migrations/*.sql is the executable form of docs/MANUAL_SQL.md BLOCKs
 * (anon / authenticated / service_role grants + RLS). Do not point at production.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { assertLocalTestDatabaseUrl } from "./safety.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const url = assertLocalTestDatabaseUrl(process.env.TEST_DATABASE_URL).toString();
const sql = postgres(url, { max: 1, prepare: false });

const bootstrapDir = join(dirname(fileURLToPath(import.meta.url)), "bootstrap");
const migrationDir = join(root, "supabase", "migrations");

const bootstrapFiles = readdirSync(bootstrapDir).filter(f => f.endsWith(".sql")).sort();
const migrationFiles = readdirSync(migrationDir).filter(f => f.endsWith(".sql")).sort();

async function runFile(path) {
  const body = readFileSync(path, "utf8");
  console.log(`Applying ${path}…`);
  await sql.unsafe(body);
}

try {
  for (const file of bootstrapFiles) {
    await runFile(join(bootstrapDir, file));
  }
  for (const file of migrationFiles) {
    await runFile(join(migrationDir, file));
  }
  await runFile(join(root, "supabase", "storage", "profile_verification_bucket.sql"));
  console.log("Harness setup complete.");
} catch (error) {
  console.error("Harness setup failed:", error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
