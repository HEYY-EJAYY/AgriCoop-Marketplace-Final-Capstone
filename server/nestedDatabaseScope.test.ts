import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("nested withRequestDatabaseScope deadlock contract", () => {
  it("excludes procedures that open their own authenticated DB scope", () => {
    const trpc = readFileSync(join(process.cwd(), "server/_core/trpc.ts"), "utf8");
    expect(trpc).toMatch(/"auth\.register"/);
    expect(trpc).toMatch(/"auth\.resendVerification"/);
    expect(trpc).toMatch(/"admin\.createAccount"/);
    expect(trpc).toMatch(/Nesting withRequestDatabaseScope/);
  });

  it("lists remaining withRequestDatabaseScope call sites and marks nested-risk status", () => {
    const inventory = [
      {
        file: "server/_core/trpc.ts",
        note: "Outer middleware for most procedures; skipped for register/resend/createAccount",
        nestedRisk: "mitigated",
      },
      {
        file: "server/_core/context.ts",
        note: "Runs before procedure middleware; sequential, not nested",
        nestedRisk: "safe",
      },
      {
        file: "server/routers.ts",
        note: "auth.register provision + pre-Auth preview use own scopes only (path excluded)",
        nestedRisk: "mitigated",
      },
      {
        file: "server/part2Routers.ts",
        note: "admin.createAccount provision scope only (path excluded)",
        nestedRisk: "mitigated",
      },
      {
        file: "server/_core/conversationStream.ts",
        note: "Express route; single scope, not under tRPC middleware",
        nestedRisk: "safe",
      },
      {
        file: "server/_core/storageProxy.ts",
        note: "Express route; single scope, not under tRPC middleware",
        nestedRisk: "safe",
      },
    ] as const;

    for (const row of inventory) {
      const source = readFileSync(join(process.cwd(), row.file), "utf8");
      expect(source, row.file).toMatch(/withRequestDatabaseScope/);
      expect(["safe", "mitigated"]).toContain(row.nestedRisk);
    }

    // No other app server files should open a second scope without being inventoried.
    const routersFixed = readFileSync(join(process.cwd(), "server/routers.fixed.ts"), "utf8");
    expect(routersFixed).toMatch(/withRequestDatabaseScope/);
  });
});
