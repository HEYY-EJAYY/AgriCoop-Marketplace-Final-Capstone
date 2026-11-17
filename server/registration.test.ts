import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  resend: vi.fn(),
  deleteUser: vi.fn(),
  getDb: vi.fn(),
  upsertUser: vi.fn(),
  withRequestDatabaseScope: vi.fn(),
}));

vi.mock("./clients", () => ({
  createPublicAuthClient: () => ({ auth: { signUp: mocks.signUp, resend: mocks.resend } }),
  supabaseAdmin: { auth: { admin: { deleteUser: mocks.deleteUser } } },
}));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getDb: mocks.getDb,
    upsertUser: mocks.upsertUser,
    withRequestDatabaseScope: mocks.withRequestDatabaseScope,
  };
});

import type { TrpcContext } from "./_core/context";
import {
  appRouter,
  publicRegistrationInputSchema,
  registrationRoleSchema,
} from "./routers";
import {
  getEmailVerificationRedirectUrl,
  isDuplicateSignupError,
  isVerifiedSupabaseEmail,
  provisionAuthAccount,
  RegistrationCleanupError,
  RegistrationProvisioningError,
  RegistrationRateLimiter,
  RegistrationRateLimitError,
} from "./registration";

function publicContext(ip = "192.0.2.10"): TrpcContext {
  return {
    req: {
      ip,
      protocol: "https",
      headers: { origin: "https://market.example.test" },
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: null,
    authUserId: null,
    authResolution: "no_bearer_token",
  };
}

function newAuthSignup() {
  return {
    data: {
      user: {
        id: "new-auth-user",
        email: "seller@example.test",
        identities: [{ id: "identity-1" }],
        email_confirmed_at: null,
      },
      session: null,
    },
    error: null,
  };
}

function registrationDb(roleRows: Array<{ roleId: number; roleName: string }>, profileValues = vi.fn().mockResolvedValue(undefined)) {
  const limit = vi.fn().mockResolvedValue(roleRows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return {
    select: vi.fn(() => ({ from })),
    insert: vi.fn(() => ({ values: profileValues })),
  };
}

describe("public registration role policy and verification", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", "https://market.example.test");
    mocks.signUp.mockReset();
    mocks.resend.mockReset();
    mocks.deleteUser.mockReset().mockResolvedValue({ error: null });
    mocks.upsertUser.mockReset().mockResolvedValue(undefined);
    mocks.withRequestDatabaseScope.mockReset().mockImplementation((_authUserId, callback) => callback());
    const values = vi.fn().mockResolvedValue(undefined);
    mocks.getDb.mockReset().mockResolvedValue(registrationDb([{ roleId: 47, roleName: "seller" }], values));
  });

  it("allows only Buyer and Seller self-registration", () => {
    expect(registrationRoleSchema.safeParse("buyer").success).toBe(true);
    expect(registrationRoleSchema.safeParse("seller").success).toBe(true);
    expect(registrationRoleSchema.safeParse("admin").success).toBe(false);
    expect(registrationRoleSchema.safeParse("superadmin").success).toBe(false);
  });

  it.each(["admin", "superadmin"])("rejects self-registration as %s", roleName => {
    expect(publicRegistrationInputSchema.safeParse({
      email: "user@example.test",
      password: "example-password",
      name: "Example User",
      role: roleName,
    }).success).toBe(false);
  });

  it("does not accept public cooperative assignments or administrative fields", () => {
    const sellerRegistration = {
      email: "seller@example.test",
      password: "example-password",
      name: "Example Seller",
      role: "seller",
    };

    expect(publicRegistrationInputSchema.safeParse(sellerRegistration).success).toBe(true);
    expect(publicRegistrationInputSchema.safeParse({ ...sellerRegistration, cooperativeId: 2 }).success).toBe(false);
    expect(publicRegistrationInputSchema.safeParse({ ...sellerRegistration, role: "admin" }).success).toBe(false);
  });

  it("starts Supabase email confirmation without auto-confirming or returning auth tokens", async () => {
    mocks.signUp.mockResolvedValue(newAuthSignup());
    const profileValues = vi.fn().mockResolvedValue(undefined);
    mocks.getDb.mockResolvedValue(registrationDb([{ roleId: 48, roleName: "seller" }], profileValues));
    const caller = appRouter.createCaller(publicContext());

    const result = await caller.auth.register({
      email: " Seller@Example.Test ",
      password: "example-password",
      name: "Example Seller",
      role: "seller",
    });

    expect(mocks.signUp).toHaveBeenCalledWith({
      email: "seller@example.test",
      password: "example-password",
      options: {
        data: { name: "Example Seller" },
        emailRedirectTo: "https://market.example.test/auth?verification=success",
      },
    });
    expect(mocks.upsertUser).toHaveBeenCalledWith(expect.objectContaining({
      openId: "new-auth-user",
      role: "seller",
      approvalStatus: "pending",
      cooperativeId: null,
    }));
    expect(profileValues).toHaveBeenCalledWith({
      userId: "new-auth-user",
      fullName: "Example Seller",
      email: "seller@example.test",
      roleId: 48,
    });
    expect(result).toEqual({ success: true, verificationRequired: true });
    expect(JSON.stringify(result)).not.toContain("access_token");
  });

  it("provisions a Buyer with the server-selected approved role and canonical role ID", async () => {
    const signup = newAuthSignup();
    signup.data.user.email = "buyer@example.test";
    mocks.signUp.mockResolvedValue(signup);
    const profileValues = vi.fn().mockResolvedValue(undefined);
    mocks.getDb.mockResolvedValue(registrationDb([{ roleId: 47, roleName: "buyer" }], profileValues));

    const result = await appRouter.createCaller(publicContext()).auth.register({
      email: "buyer@example.test",
      password: "example-password",
      name: "Example Buyer",
      role: "buyer",
    });

    expect(result).toEqual({ success: true, verificationRequired: true });
    expect(mocks.upsertUser).toHaveBeenCalledWith(expect.objectContaining({
      openId: "new-auth-user",
      role: "buyer",
      approvalStatus: "approved",
      cooperativeId: null,
    }));
    expect(profileValues).toHaveBeenCalledWith({
      userId: "new-auth-user",
      fullName: "Example Buyer",
      email: "buyer@example.test",
      roleId: 47,
    });
  });

  it("fails closed and removes the Auth identity when a public registration role is ambiguous", async () => {
    mocks.signUp.mockResolvedValue(newAuthSignup());
    mocks.getDb.mockResolvedValue(registrationDb([
      { roleId: 47, roleName: "seller" },
      { roleId: 48, roleName: "seller" },
    ]));

    await expect(appRouter.createCaller(publicContext("192.0.2.11")).auth.register({
      email: "seller@example.test",
      password: "example-password",
      name: "Example Seller",
      role: "seller",
    })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });

    expect(mocks.deleteUser).toHaveBeenCalledWith("new-auth-user");
  });

  it("rejects a requested role that conflicts with the canonical public role", async () => {
    mocks.signUp.mockResolvedValue(newAuthSignup());
    mocks.getDb.mockResolvedValue(registrationDb([{ roleId: 47, roleName: "buyer" }]));

    await expect(appRouter.createCaller(publicContext("192.0.2.12")).auth.register({
      email: "seller@example.test",
      password: "example-password",
      name: "Example Seller",
      role: "seller",
    })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });

    expect(mocks.upsertUser).not.toHaveBeenCalled();
    expect(mocks.deleteUser).toHaveBeenCalledWith("new-auth-user");
  });

  it("does not provision an application profile for an existing Auth identity", async () => {
    mocks.signUp.mockResolvedValue({
      data: {
        user: { id: "existing-auth-user", email: "buyer@example.test", identities: [], email_confirmed_at: null },
        session: null,
      },
      error: null,
    });

    const result = await appRouter.createCaller(publicContext()).auth.register({
      email: "buyer@example.test",
      password: "example-password",
      name: "Example Buyer",
      role: "buyer",
    });

    expect(result).toEqual({ success: true, verificationRequired: true });
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  it("fails closed and removes a new Auth user if email confirmation is disabled", async () => {
    mocks.signUp.mockResolvedValue({
      data: {
        user: { id: "auto-confirmed-user", email: "buyer@example.test", identities: [{ id: "identity-1" }], email_confirmed_at: "2026-01-01T00:00:00Z" },
        session: {},
      },
      error: null,
    });

    await expect(appRouter.createCaller(publicContext()).auth.register({
      email: "buyer@example.test",
      password: "example-password",
      name: "Example Buyer",
      role: "buyer",
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(mocks.deleteUser).toHaveBeenCalledWith("auto-confirmed-user");
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  it("denies operational tRPC procedures to an unverified request context", async () => {
    const caller = appRouter.createCaller({
      ...publicContext(),
      authResolution: "email_not_verified",
    });

    await expect(caller.conversations.create({ subject: "Not verified", body: "Blocked" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("resends confirmation through the public Auth client and only returns generic success", async () => {
    mocks.resend.mockResolvedValue({ error: null });

    const result = await appRouter.createCaller(publicContext("192.0.2.13")).auth.resendVerification({
      email: "buyer@example.test",
    });

    expect(mocks.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "buyer@example.test",
      options: { emailRedirectTo: "https://market.example.test/auth?verification=success" },
    });
    expect(result).toEqual({ success: true });
  });

  it("uses only an HTTPS application origin for the verification callback", () => {
    expect(getEmailVerificationRedirectUrl("https://market.example.test"))
      .toBe("https://market.example.test/auth?verification=success");
    expect(() => getEmailVerificationRedirectUrl("http://market.example.test")).toThrow();
    expect(() => getEmailVerificationRedirectUrl(undefined)).toThrow("APP_URL is required");
  });

  it("recognizes verified email only from Supabase's confirmation field", () => {
    expect(isVerifiedSupabaseEmail({ email_confirmed_at: "2026-01-01T00:00:00Z" })).toBe(true);
    expect(isVerifiedSupabaseEmail({ email_confirmed_at: null })).toBe(false);
    expect(isVerifiedSupabaseEmail({})).toBe(false);
  });

  it("recognizes duplicate-signup responses without exposing account-existence errors", () => {
    expect(isDuplicateSignupError({ code: "email_exists" })).toBe(true);
    expect(isDuplicateSignupError({ code: "user_already_exists" })).toBe(true);
    expect(isDuplicateSignupError({ code: "invalid_credentials" })).toBe(false);
  });

  it("rate-limits registration and resend by IP and normalized email", () => {
    let now = 0;
    const limiter = new RegistrationRateLimiter(() => now);
    limiter.consume("register", "192.0.2.20", "Buyer@Example.Test");
    limiter.consume("register", "192.0.2.21", "buyer@example.test");
    limiter.consume("register", "192.0.2.22", "buyer@example.test");
    expect(() => limiter.consume("register", "192.0.2.23", "BUYER@example.test"))
      .toThrow(RegistrationRateLimitError);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.consume("register", "192.0.2.30", `buyer-${attempt}@example.test`);
    }
    expect(() => limiter.consume("register", "192.0.2.30", "another@example.test"))
      .toThrow(RegistrationRateLimitError);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      limiter.consume("resend", `192.0.2.${40 + attempt}`, "resend@example.test");
    }
    expect(() => limiter.consume("resend", "192.0.2.50", "resend@example.test"))
      .toThrow(RegistrationRateLimitError);

    now += 60 * 60 * 1000;
    expect(() => limiter.consume("register", "192.0.2.23", "buyer@example.test")).not.toThrow();
  });

  it("removes a newly created Auth account when profile provisioning fails", async () => {
    const removeAuthUser = vi.fn().mockResolvedValue(undefined);
    const provision = vi.fn().mockRejectedValue(new Error("database details"));

    await expect(provisionAuthAccount("new-auth-id", provision, removeAuthUser))
      .rejects.toBeInstanceOf(RegistrationProvisioningError);
    expect(removeAuthUser).toHaveBeenCalledWith("new-auth-id");
  });

  it("surfaces failed Auth cleanup so the route can log a sanitized follow-up", async () => {
    const removeAuthUser = vi.fn().mockRejectedValue(new Error("private cleanup details"));

    await expect(provisionAuthAccount("new-auth-id", async () => {
      throw new Error("private provisioning details");
    }, removeAuthUser)).rejects.toBeInstanceOf(RegistrationCleanupError);
    expect(removeAuthUser).toHaveBeenCalledWith("new-auth-id");
  });
});
