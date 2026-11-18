import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("login application-user lookup contract", () => {
  it("does not SELECT revoked seller onlinePayment* columns during auth identity load", () => {
    const dbSource = readFileSync(join(process.cwd(), "server/db.ts"), "utf8");
    const start = dbSource.indexOf("async function loadAuthIdentityRecords");
    const end = dbSource.indexOf("export async function syncProfileRoleToApplicationRole", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const lookup = dbSource.slice(start, end);
    expect(lookup).toContain("profileImageUrl: users.profileImageUrl");
    expect(lookup).not.toMatch(/onlinePaymentQrPath\s*:/);
    expect(lookup).not.toMatch(/onlinePaymentAccountName\s*:/);
    expect(lookup).not.toMatch(/onlinePaymentAccountNumber\s*:/);
    expect(lookup).not.toMatch(/onlinePaymentLabel\s*:/);
  });

  it("registers users with an explicit column list that omits seller payment columns", () => {
    const dbSource = readFileSync(join(process.cwd(), "server/db.ts"), "utf8");
    const start = dbSource.indexOf("export async function upsertUser");
    const end = dbSource.indexOf("export function legacyPaymentStatusFromOrder", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const upsert = dbSource.slice(start, end);
    expect(upsert).toContain("insert into agricoop_app.users");
    expect(upsert).toContain('"openId", name, email, "loginMethod", role, "requestedRole", "approvalStatus", "cooperativeId", "lastSignedIn"');
    const sqlOnly = upsert.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(sqlOnly).not.toMatch(/onlinePayment/);
  });

  it("rejects a soft-deleted identity before any role-mapping self-heal", () => {
    const dbSource = readFileSync(join(process.cwd(), "server/db.ts"), "utf8");
    const start = dbSource.indexOf("export async function getUserByVerifiedAuthId");
    const end = dbSource.indexOf("\nexport async function", start + 1);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const resolution = dbSource.slice(start, end);
    const deletedGuard = resolution.indexOf("first.applicationUsers.some(applicationUser => applicationUser.deletedAt)");
    const selfHeal = resolution.indexOf("// Safe self-heal:");
    expect(deletedGuard).toBeGreaterThanOrEqual(0);
    expect(deletedGuard).toBeLessThan(selfHeal);
    expect(resolution).not.toContain("Fall through to normal self-heal");
  });
});
