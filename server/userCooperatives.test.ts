import { describe, expect, it, vi } from "vitest";
import { previewUserCooperativeSelection } from "./userCooperatives";

function mockDb(rowsByCall: unknown[][]) {
  let call = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rowsByCall[call++] ?? [],
        }),
      }),
    }),
    execute: vi.fn(),
  };
}

describe("previewUserCooperativeSelection", () => {
  it("accepts an active existing cooperative id", async () => {
    const db = mockDb([[{ id: 7, status: "active" }]]);
    const result = await previewUserCooperativeSelection(db as any, { cooperativeId: 7 });
    expect(result).toEqual({ kind: "existing", cooperativeId: 7 });
  });

  it("reports exact duplicate when name and location match", async () => {
    const db = mockDb([[{
      id: 3,
      name: "Sutafaco Cooperative",
      normalizedName: "sutafacocooperative",
      location: "Butuan City, Agusan del Norte",
      normalizedLocation: "butuancityagusandelnorte",
      address: "Poblacion Barangay Road",
    }]]);
    const result = await previewUserCooperativeSelection(db as any, {
      newCooperativeName: "SUTAFACO Cooperative",
      newCooperativeLocation: "Butuan City, Agusan del Norte",
      newCooperativeAddress: "Poblacion Barangay Road",
    });
    expect(result.kind).toBe("exact_duplicate");
    if (result.kind === "exact_duplicate") {
      expect(result.match.normalizedName).toBe("sutafacocooperative");
      expect(result.match.address).toBe("Poblacion Barangay Road");
    }
  });

  it("allows creating a new name when the caller confirms the new normalized form", async () => {
    const db = mockDb([
      [{ id: 9, name: "Near Match", normalizedName: "nearmatch", location: "City", address: "Main", normalizedLocation: "city" }],
    ]);
    const result = await previewUserCooperativeSelection(db as any, {
      newCooperativeName: "Near Match Co",
      newCooperativeLocation: "City",
      newCooperativeAddress: "Main Street",
      confirmSimilarNormalizedName: "nearmatchco",
    });
    expect(result.kind).toBe("ok_to_create");
  });

  it("returns similar matches when names are near duplicates", async () => {
    const db = mockDb([
      [{ id: 5, name: "Green Valley Coop", normalizedName: "greenvalleycoop", location: "Laguna", address: "Sta", normalizedLocation: "laguna" }],
    ]);
    const result = await previewUserCooperativeSelection(db as any, {
      newCooperativeName: "Green Valley Cooperative",
      newCooperativeLocation: "Laguna Province",
      newCooperativeAddress: "Barangay 1",
    });
    expect(result.kind).toBe("similar_matches");
  });
});