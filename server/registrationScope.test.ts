import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("registration database scope contract", () => {
  it("keeps auth.register outside the publicProcedure anon DB middleware", () => {
    const source = readFileSync(join(process.cwd(), "server/_core/trpc.ts"), "utf8");
    expect(source).toMatch(/"auth\.register"/);
    expect(source).toMatch(/"auth\.resendVerification"/);
    expect(source).toMatch(/Nesting withRequestDatabaseScope/);
  });
});
