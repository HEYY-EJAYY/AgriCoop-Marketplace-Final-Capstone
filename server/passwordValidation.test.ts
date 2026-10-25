import { describe, expect, it } from "vitest";
import { validatePasswordReset } from "../client/src/lib/passwordValidation";

describe("validatePasswordReset", () => {
  it("requires at least 8 characters", () => {
    expect(validatePasswordReset("short7", "short7")).toBe("Password must be at least 8 characters.");
  });

  it("requires matching passwords", () => {
    expect(validatePasswordReset("password8", "password9")).toBe("Passwords do not match.");
  });

  it("accepts a matching password of at least 8 characters", () => {
    expect(validatePasswordReset("password8", "password8")).toBeNull();
  });
});
