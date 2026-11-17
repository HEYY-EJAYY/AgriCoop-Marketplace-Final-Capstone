import { describe, expect, it } from "vitest";
import { quotationResponseInputSchema } from "../shared/quotation";

describe("seller quotation response input", () => {
  const response = {
    quotationId: 7,
    quotedPriceCents: 1250,
    status: "responded" as const,
  };

  it("accepts optional seller notes up to the API's 600-character limit", () => {
    expect(quotationResponseInputSchema.safeParse(response).success).toBe(true);
    expect(quotationResponseInputSchema.safeParse({
      ...response,
      sellerNote: "a".repeat(600),
    }).success).toBe(true);
    expect(quotationResponseInputSchema.safeParse({
      ...response,
      sellerNote: "a".repeat(601),
    }).success).toBe(false);
  });

  it("rejects nonpositive quoted prices", () => {
    expect(quotationResponseInputSchema.safeParse({
      ...response,
      quotedPriceCents: 0,
    }).success).toBe(false);
  });
});
