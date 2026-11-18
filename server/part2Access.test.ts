import { describe, expect, it } from "vitest";
import { resolveRegistrationIntent } from "./authIdentity";
import { canCreateManagedAccountRole } from "./authz";

describe("Part 2 registration and access contracts", () => {
  it("maps Cooperative Admin signup to buyer access with requestedRole admin only", () => {
    const resolved = resolveRegistrationIntent("cooperative_admin");
    expect(resolved.applicationRole).toBe("buyer");
    expect(resolved.approvalStatus).toBe("approved");
    expect(resolved.requestedRole).toBe("admin");
    expect(resolved.publicRoleNameForProfile).toBe("buyer");
  });

  it("does not grant admin or superadmin from buyer/seller registration intents", () => {
    expect(resolveRegistrationIntent("buyer").applicationRole).toBe("buyer");
    expect(resolveRegistrationIntent("seller").applicationRole).toBe("seller");
    expect(resolveRegistrationIntent("buyer").requestedRole).toBeUndefined();
    expect(resolveRegistrationIntent("seller").requestedRole).toBeUndefined();
  });

  it("restricts Admin from creating Officer Admin or SuperAdmin accounts", () => {
    expect(canCreateManagedAccountRole("admin", "buyer")).toBe(true);
    expect(canCreateManagedAccountRole("admin", "seller")).toBe(true);
    expect(canCreateManagedAccountRole("admin", "admin")).toBe(false);
    expect(canCreateManagedAccountRole("admin", "superadmin")).toBe(false);
    expect(canCreateManagedAccountRole("superadmin", "admin")).toBe(true);
    expect(canCreateManagedAccountRole("superadmin", "superadmin")).toBe(false);
  });
});
