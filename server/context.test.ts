import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSupabaseAppUser: vi.fn(),
}));

vi.mock("./clients.js", () => ({
  supabase: { auth: { getUser: mocks.getUser } },
}));
vi.mock("./supabaseProfiles.js", () => ({
  getSupabaseAppUser: mocks.getSupabaseAppUser,
}));

import { createContext } from "./_core/context";

const appUser = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Test User",
  email: "test@example.com",
  role: "buyer" as const,
  approvalStatus: "approved" as const,
  verificationStatus: "unverified" as const,
  cooperativeId: null,
  cooperativeName: null,
  contactNumber: null,
  address: null,
};

function options(authorization?: string) {
  return {
    req: { headers: authorization ? { authorization } : {} },
    res: {},
  } as TrpcContext;
}

describe("Supabase request context", () => {
  it("passes the bearer token to Supabase profile resolution without using MySQL", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: { id: appUser.id, email: appUser.email } },
      error: null,
    });
    mocks.getSupabaseAppUser.mockResolvedValueOnce(appUser);

    const context = await createContext(options("Bearer access-token"));

    expect(context.user).toEqual(appUser);
    expect(context.supabaseUser).toEqual(appUser);
    expect(mocks.getUser).toHaveBeenCalledWith("access-token");
    expect(mocks.getSupabaseAppUser).toHaveBeenCalledWith(
      appUser.id,
      "access-token",
      appUser.email
    );
  });

  it("treats a valid Auth token without a profiles row as anonymous", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: { id: appUser.id } },
      error: null,
    });
    mocks.getSupabaseAppUser.mockResolvedValueOnce(null);

    const context = await createContext(options("Bearer access-token"));

    expect(context.user).toBeNull();
    expect(context.supabaseUser).toBeNull();
  });
});
