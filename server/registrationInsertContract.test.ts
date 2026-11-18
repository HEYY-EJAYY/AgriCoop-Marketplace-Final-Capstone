import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("registration and listing INSERT contracts", () => {
  it("uses explicit SQL for cooperativeAdminApplications registration inserts", () => {
    const routers = readFileSync(join(process.cwd(), "server/routers.ts"), "utf8");
    // Cooperative chosen at Cooperative Admin registration is stored on the application row.
    const insertMarker = 'insert into agricoop_app."cooperativeAdminApplications"';
    const insertAt = routers.indexOf(insertMarker);
    expect(insertAt).toBeGreaterThan(-1);
    const insertBlock = routers.slice(insertAt, insertAt + 450);
    expect(insertBlock).toMatch(/"cooperativeId"/);
    expect(insertBlock).toMatch(/\$\{cooperativeId\}/);
    expect(insertBlock).toMatch(/\$\{appUser\.id\}/);
    expect(routers).not.toMatch(/insert\(cooperativeAdminApplications\)/);
  });

  it("uses explicit SQL insert for products.create", () => {
    const routers = readFileSync(join(process.cwd(), "server/routers.ts"), "utf8");
    expect(routers).toMatch(/insert into agricoop_app\.products \(/);
    expect(routers).toMatch(/42501/);
  });

  it("ships migration grants for applications INSERT columns and products.updatedAt", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20261118130000_part2_insert_grants_apps_and_products.sql"),
      "utf8",
    );
    expect(migration).toMatch(/cooperativeAdminApplications/);
    expect(migration).toContain('GRANT INSERT ("updatedAt") ON TABLE agricoop_app.products TO authenticated;');
    expect(migration).toContain("has_column_privilege('authenticated', 'agricoop_app.products', 'updatedAt', 'INSERT')");
  });
});