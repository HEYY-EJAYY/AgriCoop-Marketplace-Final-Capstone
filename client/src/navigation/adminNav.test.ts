import { describe, expect, it } from "vitest";
import {
  OFFICER_ADMIN_NAV,
  SUPERADMIN_NAV,
  adminNavForRole,
  adminNavItemForLocation,
  adminSectionFromSearch,
} from "./adminNav";

const officerSections = OFFICER_ADMIN_NAV.map(item => item.section).filter(Boolean);
const superadminSections = SUPERADMIN_NAV.map(item => item.section).filter(Boolean);

describe("admin sidebar navigation role separation", () => {
  it("gives OfficerAdmin cooperative-operations sections", () => {
    expect(officerSections).toEqual(
      expect.arrayContaining(["overview", "buyers", "sellers", "orders", "payments", "products"]),
    );
  });

  it("keeps daily marketplace ops out of the SuperAdmin sidebar", () => {
    // "products" is allowed: platform-wide product moderation is a SuperAdmin
    // ownership function, not day-to-day cooperative operations.
    for (const banned of ["buyers", "sellers", "orders", "payments"]) {
      expect(superadminSections).not.toContain(banned);
    }
  });

  it("keeps platform-ownership sections out of the OfficerAdmin sidebar", () => {
    for (const banned of ["users", "applications", "cooperatives", "settings", "health"]) {
      expect(officerSections).not.toContain(banned);
    }
  });

  it("requires SuperAdmin-only platform sections", () => {
    expect(superadminSections).toEqual(
      expect.arrayContaining(["users", "applications", "cooperatives", "settings", "health"]),
    );
  });

  it("returns no admin nav for buyer, seller, or anonymous roles", () => {
    expect(adminNavForRole("buyer")).toEqual([]);
    expect(adminNavForRole("seller")).toEqual([]);
    expect(adminNavForRole(null)).toEqual([]);
    expect(adminNavForRole(undefined)).toEqual([]);
  });

  it("resolves ?section= and legacy ?tab= params", () => {
    expect(adminSectionFromSearch("?section=orders", "admin")).toBe("orders");
    expect(adminSectionFromSearch("?tab=moderation", "admin")).toBe("products");
    expect(adminSectionFromSearch("?tab=payments", "superadmin")).toBe("payments");
    expect(adminSectionFromSearch("", "admin")).toBe("overview");
    // Officers never had a platform-wide users tab; legacy links land on buyers.
    expect(adminSectionFromSearch("?tab=users", "admin")).toBe("buyers");
    expect(adminSectionFromSearch("?tab=users", "superadmin")).toBe("users");
  });

  it("marks the active nav item for dashboard sections and route links", () => {
    const officer = adminNavForRole("admin");
    expect(adminNavItemForLocation(officer, "/dashboard", "?section=orders")?.id).toBe("orders");
    expect(adminNavItemForLocation(officer, "/admin/payment-options", "")?.id).toBe("payment-options");
    expect(adminNavItemForLocation(officer, "/dashboard", "?section=health")?.id).toBeUndefined();

    const superadmin = adminNavForRole("superadmin");
    expect(adminNavItemForLocation(superadmin, "/dashboard", "?section=health")?.id).toBe("health");
    expect(adminNavItemForLocation(superadmin, "/admin/audit-logs", "")?.id).toBe("audit");
  });
});
