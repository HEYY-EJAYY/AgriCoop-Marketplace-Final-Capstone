import { describe, expect, it } from "vitest";
import { canManageSellerOrder, hasRole, requireOperationalRole } from "./authz";

describe("AgriCoop role authorization", () => {
  it("admits only explicitly allowed marketplace roles", () => {
    expect(hasRole("buyer", ["buyer"])).toBe(true);
    expect(hasRole("buyer", ["seller", "admin"])).toBe(false);
    expect(hasRole("seller", ["buyer", "seller"])).toBe(true);
    expect(hasRole("superadmin", ["buyer", "seller"])).toBe(false);
    expect(hasRole("admin", ["admin"])).toBe(true);
  });

  it("allows a seller only to manage their own orders, while admins retain oversight", () => {
    expect(canManageSellerOrder({ id: 9, role: "seller" }, 9)).toBe(true);
    expect(canManageSellerOrder({ id: 9, role: "seller" }, 10)).toBe(false);
    expect(canManageSellerOrder({ id: 1, role: "admin" }, 10)).toBe(true);
    expect(canManageSellerOrder({ id: 1, role: "superadmin" }, 10)).toBe(true);
  });

  it("keeps public Admin Officer registrations pending until approval", () => {
    const pendingAdmin = { id: 7, role: "admin" as const, approvalStatus: "pending" as const, cooperativeId: 2 };
    expect(() => requireOperationalRole(pendingAdmin, ["admin"])).toThrow("pending cooperative approval");
    expect(requireOperationalRole({ ...pendingAdmin, approvalStatus: "approved" }, ["admin"]).role).toBe("admin");
    expect(requireOperationalRole({ ...pendingAdmin, role: "superadmin" as const }, ["superadmin"]).role).toBe("superadmin");
  });
});
