import { describe, expect, it } from "vitest";
import {
  mutationFailureFallback,
  toUserFacingErrorMessage,
  USER_FACING_DELETE_COOPERATIVE_ERROR,
  USER_FACING_DELETE_USER_ERROR,
  USER_FACING_LOAD_ERROR,
} from "./userFacingErrors";

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
    expect(mutationFailureFallback("admin.deleteUser", {}, "e5f6g7h8"))
      .toBe("We couldn't delete that user. Please try again. (ref: e5f6g7h8)");
    expect(mutationFailureFallback("cooperatives.softDelete", { id: 8 }, "1234abcd"))
      .toBe("We couldn't delete that cooperative. Please try again. (ref: 1234abcd)");
    expect(mutationFailureFallback("auth.resendVerification", { email: "a@b.co" }, "bd53e929"))
      .toBe("We couldn't send a verification email right now. Please try again later. (ref: bd53e929)");
    expect(mutationFailureFallback("auth.register", {}, "0badf00d"))
      .toBe("We couldn't complete registration. Please try again later. (ref: 0badf00d)");
  });

  it("replaces the generic load toast with the relevant deletion message", () => {
    expect(toUserFacingErrorMessage(USER_FACING_LOAD_ERROR, USER_FACING_DELETE_USER_ERROR))
      .toBe(USER_FACING_DELETE_USER_ERROR);
    expect(toUserFacingErrorMessage("Failed query: update agricoop_app.cooperatives", USER_FACING_DELETE_COOPERATIVE_ERROR))
      .toBe(USER_FACING_DELETE_COOPERATIVE_ERROR);
  });
});
