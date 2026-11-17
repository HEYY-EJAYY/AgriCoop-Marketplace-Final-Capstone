import { describe, expect, it } from "vitest";
import { parseMigrationCrosswalk, summarizeMigrationCrosswalk } from "./identityCrosswalk";

const authId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const cooperativeId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

const approvedUser = {
  legacyUserId: "12",
  legacyRole: "seller",
  targetAuthUserId: authId,
  mappingStatus: "approved" as const,
  verificationSource: "Owner-approved identity reconciliation",
  approvedBy: "Migration reviewer",
};

const approvedCooperative = {
  legacyCooperativeId: "3",
  targetCooperativeId: cooperativeId,
  mappingStatus: "approved" as const,
  verificationSource: "Owner-approved cooperative reconciliation",
  approvedBy: "Migration reviewer",
};

describe("identity migration crosswalk", () => {
  it("accepts an explicitly approved exact Auth UUID mapping", () => {
    const crosswalk = parseMigrationCrosswalk({
      version: 1,
      users: [approvedUser],
      cooperatives: [],
    });

    expect(crosswalk.users[0]).toEqual(approvedUser);
    expect(summarizeMigrationCrosswalk(crosswalk).users).toEqual({
      total: 1,
      approved: 1,
      unresolved: 0,
    });
  });

  it("keeps an absent or unresolved identity unassigned", () => {
    const crosswalk = parseMigrationCrosswalk({
      version: 1,
      users: [{
        ...approvedUser,
        targetAuthUserId: null,
        mappingStatus: "unresolved",
        verificationSource: null,
        approvedBy: null,
      }],
      cooperatives: [],
    });

    expect(crosswalk.users[0].targetAuthUserId).toBeNull();
    expect(summarizeMigrationCrosswalk(crosswalk).users.unresolved).toBe(1);
  });

  it("rejects incomplete approval evidence and unresolved guessed identities", () => {
    expect(() => parseMigrationCrosswalk({
      version: 1,
      users: [{ ...approvedUser, verificationSource: null }],
      cooperatives: [],
    })).toThrow("Approved user mappings require an Auth UUID, verification source, and approver.");

    expect(() => parseMigrationCrosswalk({
      version: 1,
      users: [{
        ...approvedUser,
        mappingStatus: "unresolved",
      }],
      cooperatives: [],
    })).toThrow("Unresolved user mappings must not contain a target Auth UUID.");
  });

  it("rejects malformed Auth UUIDs and duplicate or ambiguous identities", () => {
    expect(() => parseMigrationCrosswalk({
      version: 1,
      users: [{ ...approvedUser, targetAuthUserId: "not-a-uuid" }],
      cooperatives: [],
    })).toThrow();

    expect(() => parseMigrationCrosswalk({
      version: 1,
      users: [approvedUser, { ...approvedUser, legacyUserId: "13" }],
      cooperatives: [],
    })).toThrow("An Auth UUID cannot be assigned to multiple legacy users.");

    expect(() => parseMigrationCrosswalk({
      version: 1,
      users: [approvedUser, { ...approvedUser, legacyUserId: "12" }],
      cooperatives: [],
    })).toThrow("Legacy user IDs must be unique.");
  });

  it("preserves role data without granting or inferring an application role", () => {
    const crosswalk = parseMigrationCrosswalk({
      version: 1,
      users: [{ ...approvedUser, legacyRole: "unexpected_role" }],
      cooperatives: [],
    });

    expect(crosswalk.users[0].legacyRole).toBe("unexpected_role");
    expect(crosswalk.users[0]).not.toHaveProperty("applicationRole");
  });

  it("requires a one-to-one, evidence-backed cooperative mapping", () => {
    const crosswalk = parseMigrationCrosswalk({
      version: 1,
      users: [],
      cooperatives: [approvedCooperative],
    });
    expect(crosswalk.cooperatives[0].targetCooperativeId).toBe(cooperativeId);

    expect(() => parseMigrationCrosswalk({
      version: 1,
      users: [],
      cooperatives: [
        approvedCooperative,
        { ...approvedCooperative, legacyCooperativeId: "4" },
      ],
    })).toThrow("A target cooperative UUID cannot be assigned to multiple legacy cooperatives.");

    expect(() => parseMigrationCrosswalk({
      version: 1,
      users: [],
      cooperatives: [{
        ...approvedCooperative,
        mappingStatus: "unresolved",
        targetCooperativeId: null,
        verificationSource: null,
        approvedBy: null,
      }],
    })).not.toThrow();
  });
});