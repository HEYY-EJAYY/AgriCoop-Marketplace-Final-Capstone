import { describe, expect, it } from "vitest";
import { canSoftDeleteTargetUser } from "./userSoftDelete";

describe("canSoftDeleteTargetUser", () => {
  it("lets SuperAdmin delete buyers, sellers, and admins but not self or SuperAdmin", () => {
    const sa = { id: 1, role: "superadmin" as const };
    expect(canSoftDeleteTargetUser(sa, { id: 2, role: "buyer" })).toBe(true);
    expect(canSoftDeleteTargetUser(sa, { id: 3, role: "seller" })).toBe(true);
    expect(canSoftDeleteTargetUser(sa, { id: 4, role: "admin" })).toBe(true);
    expect(canSoftDeleteTargetUser(sa, { id: 5, role: "superadmin" })).toBe(false);
    expect(canSoftDeleteTargetUser(sa, { id: 1, role: "buyer" })).toBe(false);
  });

  it("lets Admin delete buyers and sellers only, never self or admin/superadmin", () => {
    const admin = { id: 10, role: "admin" as const };
    expect(canSoftDeleteTargetUser(admin, { id: 11, role: "buyer" })).toBe(true);
    expect(canSoftDeleteTargetUser(admin, { id: 12, role: "seller" })).toBe(true);
    expect(canSoftDeleteTargetUser(admin, { id: 13, role: "admin" })).toBe(false);
    expect(canSoftDeleteTargetUser(admin, { id: 14, role: "superadmin" })).toBe(false);
    expect(canSoftDeleteTargetUser(admin, { id: 10, role: "buyer" })).toBe(false);
  });

  it("denies buyer/seller/anon-style actors", () => {
    expect(canSoftDeleteTargetUser({ id: 20, role: "buyer" }, { id: 21, role: "buyer" })).toBe(false);
    expect(canSoftDeleteTargetUser({ id: 20, role: "seller" }, { id: 21, role: "seller" })).toBe(false);
  });
});
