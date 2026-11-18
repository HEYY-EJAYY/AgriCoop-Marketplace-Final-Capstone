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

  it("asks for confirmation when an exact normalized name already exists", async () => {
    const db = mockDb([[{
      id: 3,
      name: "Sutafaco Cooperative",
      normalizedName: "sutafacocooperative",
      location: "Butuan City",
    }]]);
    const result = await previewUserCooperativeSelection(db as any, {
      newCooperativeName: "SUTAFACO Cooperative",
    });
    expect(result.kind).toBe("needs_confirmation");
    if (result.kind === "needs_confirmation") {
      expect(result.suggestion.normalizedName).toBe("sutafacocooperative");
    }
  });

  it("allows creating a new name when the caller confirms the new normalized form", async () => {
    const db = mockDb([
      [], // exact miss
      [{ id: 9, name: "Near Match", normalizedName: "nearmatch", location: "City" }],
    ]);
    const result = await previewUserCooperativeSelection(db as any, {
      newCooperativeName: "Near Match Co",
      confirmSimilarNormalizedName: "nearmatchco",
    });
    expect(result.kind).toBe("ok_to_create");
  });
});
