import { describe, expect, it } from "vitest";
import { mapSupabaseAccountStatus, mapSupabaseRole } from "./supabaseProfiles";

describe("Supabase profile mapping", () => {
  it("maps the real database role names to application roles", () => {
    expect(mapSupabaseRole("buyer")).toBe("buyer");
    expect(mapSupabaseRole("seller")).toBe("seller");
    expect(mapSupabaseRole("coop_officer")).toBe("admin");
    expect(mapSupabaseRole("system_admin")).toBe("superadmin");
  });

  it("rejects unknown or missing role names", () => {
    expect(mapSupabaseRole("admin")).toBeNull();
    expect(mapSupabaseRole(undefined)).toBeNull();
  });

  it("normalizes account statuses conservatively", () => {
    expect(mapSupabaseAccountStatus("active")).toBe("approved");
    expect(mapSupabaseAccountStatus("suspended")).toBe("suspended");
    expect(mapSupabaseAccountStatus("pending")).toBe("pending");
    expect(mapSupabaseAccountStatus(undefined)).toBe("pending");
  });
});
