import { describe, expect, it } from "vitest";
import { parseMigrationCrosswalk, summarizeMigrationCrosswalk } from "../scripts/migration/identityCrosswalk";

const validUser = {
  legacyUserId: "12",
  legacyRole: "seller",
  targetAuthUserId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  mappingStatus: "approved" as const,
  verificationSource: "Approved identity reconciliation",
  approvedBy: "Migration reviewer",
};

const validCooperative = {
  legacyCooperativeId: "3",
  targetCooperativeId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  mappingStatus: "approved" as const,
  verificationSource: "Approved cooperative crosswalk",
  approvedBy: "Migration reviewer",
};

describe("migration crosswalk validation", () => {
  it("allows explicit unresolved records without assigning a target identity", () => {
    const crosswalk = parseMigrationCrosswalk({
      version: 1,
      users: [{
        ...validUser,
        targetAuthUserId: null,
        mappingStatus: "unresolved",
        verificationSource: null,
        approvedBy: null,
      }],
      cooperatives: [],
    });

    expect(summarizeMigrationCrosswalk(crosswalk).users).toEqual({
      total: 1,
      approved: 0,
      unresolved: 1,
    });
  });

  it("requires evidence and approval for approved identity mappings", () => {
    expect(() => parseMigrationCrosswalk({
      version: 1,
      users: [{ ...validUser, verificationSource: null }],
      cooperatives: [],
    })).toThrow("Approved user mappings require an Auth UUID, verification source, and approver.");
  });

  it("allows unresolved cooperative records without assigning a target UUID", () => {
    const crosswalk = parseMigrationCrosswalk({
      version: 1,
      users: [],
      cooperatives: [{
        ...validCooperative,
        targetCooperativeId: null,
        mappingStatus: "unresolved",
        verificationSource: null,
        approvedBy: null,
      }],
    });

    expect(summarizeMigrationCrosswalk(crosswalk).cooperatives).toEqual({
      total: 1,
      approved: 0,
      unresolved: 1,
    });
    expect(() => parseMigrationCrosswalk({
      version: 1,
      users: [],
      cooperatives: [{
        ...validCooperative,
        mappingStatus: "unresolved",
      }],
    })).toThrow("Unresolved cooperative mappings must not contain a target UUID.");
  });

  it("rejects duplicate source or target identities", () => {
    expect(() => parseMigrationCrosswalk({
      version: 1,
      users: [validUser, { ...validUser, legacyUserId: "13" }],
      cooperatives: [],
    })).toThrow("An Auth UUID cannot be assigned to multiple legacy users.");

    expect(() => parseMigrationCrosswalk({
      version: 1,
      users: [validUser, { ...validUser, legacyUserId: "12" }],
      cooperatives: [],
    })).toThrow("Legacy user IDs must be unique.");
  });

  it("rejects duplicate cooperative targets and incomplete approved mappings", () => {
    expect(() => parseMigrationCrosswalk({
      version: 1,
      users: [],
      cooperatives: [validCooperative, { ...validCooperative, targetCooperativeId: "550e8400-e29b-41d4-a716-446655440000" }],
    })).toThrow("Legacy cooperative IDs must be unique.");

    expect(() => parseMigrationCrosswalk({
      version: 1,
      users: [],
      cooperatives: [validCooperative, { ...validCooperative, legacyCooperativeId: "4" }],
    })).toThrow("A target cooperative UUID cannot be assigned to multiple legacy cooperatives.");

    expect(() => parseMigrationCrosswalk({
      version: 1,
      users: [],
      cooperatives: [{ ...validCooperative, approvedBy: null }],
    })).toThrow("Approved cooperative mappings require a target UUID, verification source, and approver.");
  });
});
