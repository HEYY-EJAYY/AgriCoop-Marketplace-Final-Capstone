import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("Vercel API ESM entry point", () => {
  it("keeps local server imports explicit so Node can resolve the function graph", () => {
    const apiEntry = read("api/index.ts");
    const appEntry = read("server/_core/app.ts");

    expect(apiEntry).toMatch(/from\s+["']\.\.\/server\/_core\/app\.js["']/);
    expect(apiEntry).not.toMatch(/from\s+["']\.\.\/server\/_core\/app["']/);
    expect(appEntry).toMatch(/from\s+["']\.\.\/routers\.js["']/);
    expect(appEntry).toMatch(/from\s+["']\.\/context\.js["']/);
    expect(appEntry).not.toMatch(/from\s+["']\.\.\/routers["']/);
    expect(appEntry).not.toMatch(/from\s+["']\.\/context["']/);
  });
});
