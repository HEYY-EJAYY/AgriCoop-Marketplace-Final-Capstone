import { describe, expect, it } from "vitest";
import { canRequestCooperativeAssociation, canReviewCooperativeAssociation } from "./cooperativeAssociations";

describe("cooperative association request authorization", () => {
  it("allows only unassigned, non-suspended sellers to request association", () => {
    expect(canRequestCooperativeAssociation({ role: "seller", approvalStatus: "pending", cooperativeId: null })).toBe(true);
    expect(canRequestCooperativeAssociation({ role: "seller", approvalStatus: "approved", cooperativeId: null })).toBe(true);
    expect(canRequestCooperativeAssociation({ role: "seller", approvalStatus: "suspended", cooperativeId: null })).toBe(false);
    expect(canRequestCooperativeAssociation({ role: "seller", approvalStatus: "pending", cooperativeId: 3 })).toBe(false);
    expect(canRequestCooperativeAssociation({ role: "buyer", approvalStatus: "approved", cooperativeId: null })).toBe(false);
  });

  it("limits Admin review to their cooperative while allowing SuperAdmins", () => {
    expect(canReviewCooperativeAssociation({ role: "admin", cooperativeId: 3 }, 3)).toBe(true);
    expect(canReviewCooperativeAssociation({ role: "admin", cooperativeId: 3 }, 4)).toBe(false);
    expect(canReviewCooperativeAssociation({ role: "admin", cooperativeId: null }, 3)).toBe(false);
    expect(canReviewCooperativeAssociation({ role: "superadmin", cooperativeId: null }, 3)).toBe(true);
  });
});
