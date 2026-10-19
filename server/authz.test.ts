import { describe, expect, it } from "vitest";
import { adminOverviewCooperativeScope, canAccessConversation, canAccessOrderForCooperative, canManageCooperativeResource, canManageSellerOrder, canSubmitProfileVerification, canUpdateCooperativeUser, hasRole, isSellerApproved, requireOperationalRole } from "./authz";

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

  it("keeps public Admin Officer registrations pending until approval and blocks suspended accounts", () => {
    const pendingAdmin = { id: 7, role: "admin" as const, approvalStatus: "pending" as const, cooperativeId: 2 };
    expect(() => requireOperationalRole(pendingAdmin, ["admin"])).toThrow("pending cooperative approval");
    expect(() => requireOperationalRole({ ...pendingAdmin, approvalStatus: "suspended" }, ["admin"])).toThrow("suspended");
    expect(requireOperationalRole({ ...pendingAdmin, approvalStatus: "approved" }, ["admin"]).role).toBe("admin");
    expect(requireOperationalRole({ ...pendingAdmin, role: "superadmin" as const }, ["superadmin"]).role).toBe("superadmin");
  });

  it("limits officer order access to their own cooperative while letting SuperAdmin see everything", () => {
    expect(canAccessOrderForCooperative({ role: "admin", cooperativeId: 2 }, 2)).toBe(true);
    expect(canAccessOrderForCooperative({ role: "admin", cooperativeId: 2 }, 3)).toBe(false);
    expect(canAccessOrderForCooperative({ role: "superadmin", cooperativeId: null }, 3)).toBe(true);
  });

  it("limits Officer product, user, and order operations to their cooperative", () => {
    const officer = { id: 4, role: "admin" as const, cooperativeId: 2 };
    const superAdmin = { id: 1, role: "superadmin" as const, cooperativeId: null };
    expect(canManageCooperativeResource(officer, 2)).toBe(true);
    expect(canManageCooperativeResource(officer, 3)).toBe(false);
    expect(canAccessOrderForCooperative(officer, 3)).toBe(false);
    expect(canManageCooperativeResource(superAdmin, 3)).toBe(true);
    expect(canAccessOrderForCooperative(superAdmin, 3)).toBe(true);
    expect(adminOverviewCooperativeScope(officer)).toBe(2);
    expect(adminOverviewCooperativeScope(superAdmin)).toBeUndefined();
  });

  it("prevents Officers from moving users or assigning SuperAdmin", () => {
    const officer = { role: "admin" as const, cooperativeId: 2 };
    expect(canUpdateCooperativeUser(officer, 2, 2, "seller")).toBe(true);
    expect(canUpdateCooperativeUser(officer, 3, 2, "seller")).toBe(false);
    expect(canUpdateCooperativeUser(officer, 2, 3, "seller")).toBe(false);
    expect(canUpdateCooperativeUser(officer, 2, 2, "superadmin")).toBe(false);
    expect(canUpdateCooperativeUser({ role: "superadmin", cooperativeId: null }, 3, 2, "superadmin")).toBe(true);
  });

  it("requires the Seller's current approval to be approved for sales", () => {
    expect(isSellerApproved("approved")).toBe(true);
    expect(isSellerApproved("pending")).toBe(false);
    expect(isSellerApproved("suspended")).toBe(false);
    expect(isSellerApproved(undefined)).toBe(false);
  });

  it("limits conversation access to participants and the seller's cooperative officer", () => {
    const thread = { buyerId: 10, sellerId: 20 };
    expect(canAccessConversation({ id: 10, role: "buyer", cooperativeId: null }, thread, 2)).toBe(true);
    expect(canAccessConversation({ id: 20, role: "seller", cooperativeId: 2 }, thread, 2)).toBe(true);
    expect(canAccessConversation({ id: 30, role: "admin", cooperativeId: 2 }, thread, 2)).toBe(true);
    expect(canAccessConversation({ id: 40, role: "superadmin", cooperativeId: null }, thread, 2)).toBe(true);
    expect(canAccessConversation({ id: 50, role: "buyer", cooperativeId: null }, thread, 2)).toBe(false);
    expect(canAccessConversation({ id: 60, role: "admin", cooperativeId: 3 }, thread, 2)).toBe(false);
  });

  it("allows profile verification to be submitted until it is approved", () => {
    expect(canSubmitProfileVerification({ role: "buyer", verificationStatus: "unverified" })).toBe(true);
    expect(canSubmitProfileVerification({ role: "seller", verificationStatus: "pending" })).toBe(true);
    expect(canSubmitProfileVerification({ role: "seller", verificationStatus: "approved" })).toBe(false);
    expect(canSubmitProfileVerification({ role: "superadmin", verificationStatus: "unverified" })).toBe(false);
  });
});
