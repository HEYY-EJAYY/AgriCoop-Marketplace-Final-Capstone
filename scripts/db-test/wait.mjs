#!/usr/bin/env node
/**
 * Wait until TEST_DATABASE_URL (localhost only) accepts connections.
 */
import postgres from "postgres";
import { assertLocalTestDatabaseUrl } from "./safety.mjs";

const url = assertLocalTestDatabaseUrl(process.env.TEST_DATABASE_URL).toString();

for (let attempt = 1; attempt <= 30; attempt++) {
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 3 });
  try {
    await sql`select 1`;
    console.log("Postgres is ready.");
    await sql.end({ timeout: 2 });
    process.exit(0);
  } catch (error) {
    console.log(`Waiting for Postgres (${attempt}/30)…`, error?.code ?? "connecting");
    try {
      await sql.end({ timeout: 1 });
    } catch {
      // ignore close races while the service is still starting
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

console.error("Postgres did not become ready in time.");
process.exit(1);
