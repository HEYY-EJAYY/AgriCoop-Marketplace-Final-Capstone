import { describe, expect, it } from "vitest";
import { canRequestCooperativeAssociation, canReviewCooperativeAssociation, cooperativeAssociationRequestBlock } from "./cooperativeAssociations";

describe("cooperative association request authorization", () => {
  it("allows assigned or unassigned non-suspended sellers to request a change", () => {
    expect(canRequestCooperativeAssociation({ role: "seller", approvalStatus: "pending", cooperativeId: null })).toBe(true);
    expect(canRequestCooperativeAssociation({ role: "seller", approvalStatus: "approved", cooperativeId: null })).toBe(true);
    expect(canRequestCooperativeAssociation({ role: "seller", approvalStatus: "approved", cooperativeId: 3 })).toBe(true);
    expect(canRequestCooperativeAssociation({ role: "seller", approvalStatus: "suspended", cooperativeId: null })).toBe(false);
    expect(canRequestCooperativeAssociation({ role: "buyer", approvalStatus: "approved", cooperativeId: null })).toBe(false);
  });

  it("provides distinct ineligibility messages for suspension, pending request, and the same cooperative", () => {
    expect(cooperativeAssociationRequestBlock(
      { role: "seller", approvalStatus: "suspended", cooperativeId: 3 },
      4,
    )?.message).toContain("Suspended Sellers");
    expect(cooperativeAssociationRequestBlock(
      { role: "seller", approvalStatus: "approved", cooperativeId: 3 },
      4,
      true,
    )?.message).toContain("pending cooperative request");
    expect(cooperativeAssociationRequestBlock(
      { role: "seller", approvalStatus: "approved", cooperativeId: 3 },
      3,
    )?.message).toContain("already assigned");
  });

  it("limits Admin review to their cooperative while allowing SuperAdmins", () => {
    expect(canReviewCooperativeAssociation({ role: "admin", cooperativeId: 3 }, 3)).toBe(true);
    expect(canReviewCooperativeAssociation({ role: "admin", cooperativeId: 3 }, 4)).toBe(false);
    expect(canReviewCooperativeAssociation({ role: "admin", cooperativeId: null }, 3)).toBe(false);
    expect(canReviewCooperativeAssociation({ role: "superadmin", cooperativeId: null }, 3)).toBe(true);
  });
});
