import { describe, expect, it } from "vitest";
import { getEmailVerificationReturn } from "./emailVerification";

describe("Supabase email-verification return state", () => {
  it("recognizes a successful signup callback", () => {
    expect(getEmailVerificationReturn("?verification=success", "")).toBe("success");
    expect(getEmailVerificationReturn("", "#type=signup")).toBe("success");
  });

  it("recognizes expired or rejected verification links", () => {
    expect(getEmailVerificationReturn("?error_code=otp_expired&type=signup", "")).toBe("expired");
    expect(getEmailVerificationReturn("", "#error=access_denied&error_code=otp_expired")).toBe("expired");
  });

  it("leaves password-recovery callbacks to their own flow", () => {
    expect(getEmailVerificationReturn("?error_code=otp_expired&type=recovery", "")).toBe("none");
  });

  it("does not infer verification state from unrelated URLs", () => {
    expect(getEmailVerificationReturn("?verification=anything", "")).toBe("none");
    expect(getEmailVerificationReturn("", "")).toBe("none");
  });
});
