import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getDb: vi.fn(),
  withRequestDatabaseScope: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: mocks.getDb,
  withRequestDatabaseScope: mocks.withRequestDatabaseScope,
}));

import { getHealthStatus } from "./health";

describe("database health check", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.getDb.mockReset();
    mocks.withRequestDatabaseScope.mockReset();
    mocks.getDb.mockResolvedValue({ execute: mocks.execute });
    mocks.withRequestDatabaseScope.mockImplementation((_authUserId, callback) => callback());
  });

  it("reports database availability after a read-only query under the anonymous role", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ "?column?": 1 }] });

    await expect(getHealthStatus()).resolves.toEqual({ status: "ok", database: "available" });
    expect(mocks.withRequestDatabaseScope).toHaveBeenCalledWith(null, expect.any(Function));
  });

  it("returns a sanitized degraded status when the database is unavailable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.withRequestDatabaseScope.mockRejectedValue(new Error("details must not be exposed"));

    await expect(getHealthStatus()).resolves.toEqual({ status: "degraded", database: "unavailable" });
    expect(errorSpy).toHaveBeenCalledWith("[health] Database readiness check failed", { errorType: "Error" });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("details must not be exposed");
    errorSpy.mockRestore();
  });
});
