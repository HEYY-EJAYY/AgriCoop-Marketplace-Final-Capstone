import { describe, expect, it } from "vitest";

describe("server integration credentials", () => {
  it("accepts the configured Supabase service role key shape when present", () => {
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!baseUrl || !serviceRoleKey) return;
    expect(baseUrl).toMatch(/^https:\/\//);
    expect(serviceRoleKey.length).toBeGreaterThan(10);
  });
});
