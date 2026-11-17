import { describe, expect, it } from "vitest";
import { assertDatabaseEnvironment } from "./databaseConfig";

describe("database startup configuration", () => {
  it("requires a PostgreSQL URL outside tests", () => {
    expect(() => assertDatabaseEnvironment({ NODE_ENV: "development" }))
      .toThrow("DATABASE_URL is required");
    expect(() => assertDatabaseEnvironment({ NODE_ENV: "production", DATABASE_URL: " " }))
      .toThrow("DATABASE_URL is required");
  });

  it("allows test runs without an external database URL", () => {
    expect(() => assertDatabaseEnvironment({ NODE_ENV: "test" })).not.toThrow();
  });
});
