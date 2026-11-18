import { describe, expect, it } from "vitest";
import {
  applicationRoleToPublicRoleName,
  matchesPublicRegistrationIdentity,
  publicRoleNameToApplicationRole,
  resolveAuthIdentityMapping,
  resolvePublicRegistrationIdentity,
} from "./authIdentity";

const authUserId = "36100037-c7fe-4152-b7b6-1f9d91ebf35c";
const appUser = (role: "buyer" | "seller" | "admin" | "superadmin", openId = authUserId) => ({ openId, role });

describe("verified Auth identity mapping", () => {
  it.each([
    ["buyer", { publicRoleName: "buyer", applicationRole: "buyer", approvalStatus: "approved", registrationChoice: "buyer" }],
    ["seller", { publicRoleName: "seller", applicationRole: "seller", approvalStatus: "pending", registrationChoice: "seller" }],
    ["coop_admin", { publicRoleName: "buyer", applicationRole: "buyer", approvalStatus: "approved", registrationChoice: "coop_admin" }],
  ] as const)("resolves only the permitted public %s registration identity", (roleName, identity) => {
    expect(resolvePublicRegistrationIdentity(roleName)).toEqual(identity);
  });

  it.each(["admin", "superadmin", "coop_officer", "system_admin", null, undefined])(
    "rejects %s as a public registration role",
    roleName => {
      expect(resolvePublicRegistrationIdentity(roleName)).toBeNull();
    },
  );

  it("matches the canonical public role without resetting existing approval or cooperative assignments", () => {
    const sellerIdentity = resolvePublicRegistrationIdentity("seller")!;
    expect(matchesPublicRegistrationIdentity({
      role: "seller",
      approvalStatus: "pending",
      cooperativeId: null,
    }, sellerIdentity)).toBe(true);
    expect(matchesPublicRegistrationIdentity({
      role: "buyer",
      approvalStatus: "approved",
      cooperativeId: null,
    }, sellerIdentity)).toBe(false);
    expect(matchesPublicRegistrationIdentity({
      role: "seller",
      approvalStatus: "approved",
      cooperativeId: 12,
    }, sellerIdentity)).toBe(true);
  });

  it("resolves an existing application user by the exact Auth UUID in openId", () => {
    const user = appUser("buyer");
    expect(resolveAuthIdentityMapping(authUserId, [user], [{ roleName: "buyer" }]))
      .toEqual({ status: "application_user_resolved", user });
  });

  it("reports an explicitly missing application identity", () => {
    expect(resolveAuthIdentityMapping(authUserId, [], []))
      .toEqual({ status: "application_user_missing", user: null });
  });

  it("reports a public profile without a matching agricoop_app user", () => {
    expect(resolveAuthIdentityMapping(authUserId, [], [{ roleName: "buyer" }]))
      .toEqual({ status: "application_user_mapping_unavailable", user: null });
  });

  it("fails closed when the canonical public profile is missing or hidden by RLS", () => {
    expect(resolveAuthIdentityMapping(authUserId, [appUser("buyer")], []))
      .toEqual({ status: "application_profile_missing", user: null });
  });

  it("detects duplicate application users and public profiles", () => {
    expect(resolveAuthIdentityMapping(authUserId, [appUser("buyer"), appUser("buyer")], [{ roleName: "buyer" }]).status)
      .toBe("application_identity_conflict");
    expect(resolveAuthIdentityMapping(authUserId, [appUser("buyer")], [{ roleName: "buyer" }, { roleName: "buyer" }]).status)
      .toBe("application_identity_conflict");
  });

  it("does not match an application account with a different openId", () => {
    expect(resolveAuthIdentityMapping(authUserId, [appUser("buyer", "different-auth-id")], []))
      .toEqual({ status: "application_user_missing", user: null });
  });

  it("fails closed when a public role row is missing", () => {
    expect(resolveAuthIdentityMapping(authUserId, [appUser("buyer")], [{ roleName: null }]))
      .toEqual({ status: "application_role_mapping_unavailable", user: null });
  });

  it.each([
    ["buyer", "buyer"],
    ["seller", "seller"],
    ["coop_officer", "admin"],
    ["system_admin", "superadmin"],
  ] as const)("preserves the canonical %s to application %s role mapping", (roleName, applicationRole) => {
    const user = appUser(applicationRole);
    expect(resolveAuthIdentityMapping(authUserId, [user], [{ roleName }]))
      .toEqual({ status: "application_user_resolved", user });
  });

  it("rejects a conflicting canonical role rather than changing the application role", () => {
    const user = appUser("buyer");
    expect(resolveAuthIdentityMapping(authUserId, [user], [{ roleName: "system_admin" }]))
      .toEqual({ status: "application_role_mapping_conflict", user: null });
    expect(user.role).toBe("buyer");
  });

  it.each([
    ["buyer", "seller"],
    ["seller", "buyer"],
    ["admin", "system_admin"],
    ["superadmin", "coop_officer"],
  ] as const)("flags login conflict when application %s disagrees with profile %s", (applicationRole, profileRole) => {
    expect(resolveAuthIdentityMapping(authUserId, [appUser(applicationRole)], [{ roleName: profileRole }]).status)
      .toBe("application_role_mapping_conflict");
  });

  it("maps every application role to a canonical public role and back", () => {
    expect(applicationRoleToPublicRoleName("buyer")).toBe("buyer");
    expect(applicationRoleToPublicRoleName("seller")).toBe("seller");
    expect(applicationRoleToPublicRoleName("admin")).toBe("coop_officer");
    expect(applicationRoleToPublicRoleName("superadmin")).toBe("system_admin");
    expect(publicRoleNameToApplicationRole("coop_officer")).toBe("admin");
    expect(publicRoleNameToApplicationRole("system_admin")).toBe("superadmin");
  });
});
