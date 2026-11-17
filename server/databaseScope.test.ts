import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { applyRequestDatabaseSettings, buildRequestDatabaseClaims } from "./db";

function createScopeExecutor() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new PgDialect();
  return {
    queries,
    execute: async (query: SQL) => {
      const { sql, params } = dialect.sqlToQuery(query);
      queries.push({ sql, params });
      return undefined;
    },
  };
}

describe("request-scoped PostgreSQL identity", () => {
  it("sets the authenticated role and verified UUID claims for one request", () => {
    const authUserId = "36100037-c7fe-4152-b7b6-1f9d91ebf35c";
    const scope = buildRequestDatabaseClaims(authUserId);

    expect(scope.role).toBe("authenticated");
    expect(scope.subject).toBe(authUserId);
    expect(JSON.parse(scope.claims)).toEqual({
      aud: "authenticated",
      role: "authenticated",
      sub: authUserId,
    });
  });

  it("uses the anon role without retaining an authenticated subject", () => {
    const scope = buildRequestDatabaseClaims(null);

    expect(scope.role).toBe("anon");
    expect(scope.subject).toBe("");
    expect(JSON.parse(scope.claims)).toEqual({ role: "anon" });
  });

  it("applies authenticated role and verified UUID claims as transaction-local PostgreSQL settings", async () => {
    const authUserId = "36100037-c7fe-4152-b7b6-1f9d91ebf35c";
    const tx = createScopeExecutor();

    await applyRequestDatabaseSettings(tx, authUserId);

    expect(tx.queries).toEqual([
      { sql: "select set_config('role', $1, true)", params: ["authenticated"] },
      { sql: "select set_config('search_path', 'public, agricoop_app', true)", params: [] },
      {
        sql: "select set_config('request.jwt.claims', $1, true)",
        params: [JSON.stringify({ aud: "authenticated", role: "authenticated", sub: authUserId })],
      },
      { sql: "select set_config('request.jwt.claim.sub', $1, true)", params: [authUserId] },
    ]);
  });

  it("tags a failed transaction role switch without losing its PostgreSQL error code", async () => {
    const tx = {
      execute: async () => {
        throw Object.assign(new Error("permission denied"), { code: "42501" });
      },
    };

    await expect(applyRequestDatabaseSettings(tx, "36100037-c7fe-4152-b7b6-1f9d91ebf35c"))
      .rejects.toMatchObject({
        databasePhase: "request_role_switch",
        cause: { code: "42501" },
      });
  });

  it("overwrites every request-local identity setting for the next pooled transaction", async () => {
    const tx = createScopeExecutor();
    const firstIdentity = "36100037-c7fe-4152-b7b6-1f9d91ebf35c";
    await applyRequestDatabaseSettings(tx, firstIdentity);
    await applyRequestDatabaseSettings(tx, null);

    expect(tx.queries.slice(4)).toEqual([
      { sql: "select set_config('role', $1, true)", params: ["anon"] },
      { sql: "select set_config('search_path', 'public, agricoop_app', true)", params: [] },
      { sql: "select set_config('request.jwt.claims', $1, true)", params: [JSON.stringify({ role: "anon" })] },
      { sql: "select set_config('request.jwt.claim.sub', $1, true)", params: [""] },
    ]);
    expect(tx.queries.slice(4).some(query => query.params.includes(firstIdentity))).toBe(false);
  });
});
