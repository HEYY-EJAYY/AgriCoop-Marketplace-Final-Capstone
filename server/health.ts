import { pingDatabase } from "./db";

export async function getHealthStatus() {
  try {
    // Connectivity-only check: skip per-request RLS GUC setup (4 extra round-trips).
    await pingDatabase();
    return { status: "ok", database: "available" } as const;
  } catch (error) {
    console.error("[health] Database readiness check failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return { status: "degraded", database: "unavailable" } as const;
  }
}
