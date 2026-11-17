import { sql } from "drizzle-orm";
import { getDb, withRequestDatabaseScope } from "./db";

export async function getHealthStatus() {
  try {
    await withRequestDatabaseScope(null, async () => {
      const db = await getDb();
      await db.execute(sql`select 1`);
    });
    return { status: "ok", database: "available" } as const;
  } catch (error) {
    console.error("[health] Database readiness check failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return { status: "degraded", database: "unavailable" } as const;
  }
}
