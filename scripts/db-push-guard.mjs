#!/usr/bin/env node
/**
 * Neutralizes accidental production migrations via `pnpm db:push` (B12).
 * Drizzle generate remains available as `pnpm db:generate`.
 * Explicit local migrate requires AGRICOOP_ALLOW_LOCAL_MIGRATE=1 and a localhost MIGRATION_DATABASE_URL.
 */
import { spawnSync } from "node:child_process";

const url = process.env.MIGRATION_DATABASE_URL ?? "";
const allow = process.env.AGRICOOP_ALLOW_LOCAL_MIGRATE === "1";

function isLocalhost(raw) {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "::1"].includes(host);
  } catch {
    return false;
  }
}

if (!allow || !url || !isLocalhost(url)) {
  console.error([
    "`pnpm db:push` is disabled to protect production.",
    "Use `pnpm db:generate` to create SQL only.",
    "Owner-applied production SQL lives in supabase/migrations/ (run in SQL Editor).",
    "For a disposable local migrate: set AGRICOOP_ALLOW_LOCAL_MIGRATE=1 and MIGRATION_DATABASE_URL to localhost, then re-run.",
  ].join("\n"));
  process.exit(1);
}

const generate = spawnSync("pnpm", ["exec", "drizzle-kit", "generate"], { stdio: "inherit", shell: true });
if (generate.status !== 0) process.exit(generate.status ?? 1);
const migrate = spawnSync("pnpm", ["exec", "drizzle-kit", "migrate"], { stdio: "inherit", shell: true });
process.exit(migrate.status ?? 1);
