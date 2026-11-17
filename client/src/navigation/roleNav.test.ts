import { describe, expect, it } from "vitest";
import { ROLE_CENTER_NAV, LOGGED_OUT_CENTER } from "./roleNav";

const banned = ["Moderation", "Orders", "Users", "Users & Roles"];

describe("roleNav admin surfaces", () => {
  it("keeps Moderation, Orders, and Users out of Admin and SuperAdmin main nav", () => {
    for (const role of ["admin", "superadmin"] as const) {
      const labels = ROLE_CENTER_NAV[role].map(item => item.label);
      for (const label of banned) {
        expect(labels).not.toContain(label);
      }
    }
  });

  it("does not change logged-out or buyer/seller nav labels for those three items as admin destinations", () => {
    expect(LOGGED_OUT_CENTER.map(item => item.label)).toEqual(["Marketplace", "How It Works", "Support"]);
    expect(ROLE_CENTER_NAV.buyer.some(item => item.label === "My Orders")).toBe(true);
    expect(ROLE_CENTER_NAV.seller.some(item => item.label === "Seller Center")).toBe(true);
  });
});
