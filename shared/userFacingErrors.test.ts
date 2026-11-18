import { describe, expect, it } from "vitest";
import { mutationFailureFallback, toUserFacingErrorMessage } from "./userFacingErrors";

describe("toUserFacingErrorMessage", () => {
  it("replaces Failed query SQL payloads", () => {
    expect(toUserFacingErrorMessage("Failed query: select id from agricoop_app.orders"))
      .toBe("We could not load this data right now. Please try again.");
  });

  it("keeps short user-facing messages", () => {
    expect(toUserFacingErrorMessage("Only approved Buyer accounts can place orders."))
      .toBe("Only approved Buyer accounts can place orders.");
  });

  it("uses action-specific mutation failures with a reference code", () => {
    const fallback = mutationFailureFallback("orders.sellerUpdateArchive", { action: "delete" }, "a1b2c3d4");
    expect(toUserFacingErrorMessage("Failed query: update agricoop_app.\"threadStates\"", fallback))
      .toBe("We couldn't delete that order. Please try again. (ref: a1b2c3d4)");
    expect(mutationFailureFallback("admin.softDeleteUser", {}, "e5f6g7h8"))
      .toBe("We couldn't delete that user. Please try again. (ref: e5f6g7h8)");
  });
});
