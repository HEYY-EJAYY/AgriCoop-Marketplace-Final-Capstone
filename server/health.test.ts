import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pingDatabase: vi.fn(),
}));

vi.mock("./db", () => ({
  pingDatabase: mocks.pingDatabase,
}));

import { getHealthStatus } from "./health";

describe("database health check", () => {
  beforeEach(() => {
    mocks.pingDatabase.mockReset();
  });

  it("reports database availability after a lightweight connectivity probe", async () => {
    mocks.pingDatabase.mockResolvedValue(undefined);

    await expect(getHealthStatus()).resolves.toEqual({ status: "ok", database: "available" });
    expect(mocks.pingDatabase).toHaveBeenCalledOnce();
  });

  it("returns a sanitized degraded status when the database is unavailable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.pingDatabase.mockRejectedValue(new Error("details must not be exposed"));

    await expect(getHealthStatus()).resolves.toEqual({ status: "degraded", database: "unavailable" });
    expect(errorSpy).toHaveBeenCalledWith("[health] Database readiness check failed", { errorType: "Error" });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("details must not be exposed");
    errorSpy.mockRestore();
  });
});
