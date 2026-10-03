import { describe, expect, it } from "vitest";

describe("Credential Validation", () => {
  it("accepts the configured Supabase public URL and key shape", () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return;
    expect(supabaseUrl).toMatch(/^https:\/\//);
    expect(supabaseKey.length).toBeGreaterThan(10);
  });
});
