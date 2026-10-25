import { describe, expect, it } from "vitest";
import { getSupabaseAuthHeaders } from "./trpc";

describe("tRPC Supabase authorization headers", () => {
  it("reads the session at request time so a refreshed session is sent", async () => {
    const headers = await getSupabaseAuthHeaders(async () => ({
      data: { session: { access_token: "fresh-access-token" } },
      error: null,
    }));

    expect(headers).toEqual({ Authorization: "Bearer fresh-access-token" });
  });

  it("sends no authorization header when the session is absent", async () => {
    const headers = await getSupabaseAuthHeaders(async () => ({
      data: { session: null },
      error: null,
    }));
    expect(headers).toEqual({});
  });
});
