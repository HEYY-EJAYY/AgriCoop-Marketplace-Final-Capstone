import { describe, expect, it } from "vitest";
import { normalizeCooperativeName } from "./cooperativeNames";

describe("normalizeCooperativeName", () => {
  it("trims, collapses whitespace, strips edge punctuation, and title-cases words", () => {
    expect(normalizeCooperativeName("  ...butuan  FARMERS   coop!! ")).toEqual({
      displayName: "Butuan Farmers Coop",
      normalizedName: "butuanfarmerscoop",
    });
  });

  it("ignores case, spaces, and punctuation for duplicate matching", () => {
    expect(normalizeCooperativeName("Butuan Farmers-Coop").normalizedName).toBe(
      normalizeCooperativeName(" butuan farmers coop ").normalizedName,
    );
  });

  it("rejects names that contain no letters or numbers", () => {
    expect(() => normalizeCooperativeName("... --- !!!")).toThrow(
      "Enter a valid cooperative name.",
    );
  });
});
