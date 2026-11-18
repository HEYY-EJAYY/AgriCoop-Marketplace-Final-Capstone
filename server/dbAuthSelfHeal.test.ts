import { describe, expect, it } from "vitest";
import { requestedRoleFromAuthMetadata } from "./registration";

describe("auth self-heal metadata guards", () => {
  it("reads cooperative admin intent only from explicit metadata keys", () => {
    expect(requestedRoleFromAuthMetadata({ requestedRole: "admin" })).toBe("admin");
    expect(requestedRoleFromAuthMetadata({ requested_role: "admin" })).toBe("admin");
    expect(requestedRoleFromAuthMetadata({ requestedRole: "superadmin" })).toBeNull();
    expect(requestedRoleFromAuthMetadata({ role: "admin" })).toBeNull();
    expect(requestedRoleFromAuthMetadata(null)).toBeNull();
  });
});