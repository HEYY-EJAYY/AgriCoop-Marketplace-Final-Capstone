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
});
