import { describe, expect, it } from "vitest";
import { resolvePublicRegistrationIdentity, resolveRegistrationIntent } from "./authIdentity";
import { canCreateManagedAccountRole } from "./authz";
import { publicRegistrationInputSchema } from "./routers";

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

  it("maps public coop_admin registration identity to buyer without admin privileges", () => {
    const identity = resolvePublicRegistrationIdentity("coop_admin");
    expect(identity).toMatchObject({
      publicRoleName: "buyer",
      applicationRole: "buyer",
      approvalStatus: "approved",
      registrationChoice: "coop_admin",
    });
  });

  it("rejects signup payloads that try to set status or approval fields", () => {
    const base = {
      email: "applicant@example.test",
      password: "secret12",
      name: "Applicant",
      role: "coop_admin" as const,
      cooperativeId: 1,
    };
    expect(publicRegistrationInputSchema.safeParse(base).success).toBe(true);
    expect(publicRegistrationInputSchema.safeParse({ ...base, status: "approved" }).success).toBe(false);
    expect(publicRegistrationInputSchema.safeParse({ ...base, approvalStatus: "approved" }).success).toBe(false);
    expect(publicRegistrationInputSchema.safeParse({ ...base, role: "admin" }).success).toBe(false);
    expect(publicRegistrationInputSchema.safeParse({ ...base, role: "superadmin" }).success).toBe(false);
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
