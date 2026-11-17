import { describe, expect, it } from "vitest";
import { toUserFacingErrorMessage } from "./userFacingErrors";

describe("toUserFacingErrorMessage", () => {
  it("replaces Failed query SQL payloads", () => {
    expect(toUserFacingErrorMessage("Failed query: select id from agricoop_app.orders"))
      .toBe("We could not load this data right now. Please try again.");
  });

  it("keeps short user-facing messages", () => {
    expect(toUserFacingErrorMessage("Only approved Buyer accounts can place orders."))
      .toBe("Only approved Buyer accounts can place orders.");
  });
});
