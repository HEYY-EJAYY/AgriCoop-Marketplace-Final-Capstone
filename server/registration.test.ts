import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  resend: vi.fn(),
  deleteUser: vi.fn(),
  listUsers: vi.fn(),
  getDb: vi.fn(),
  upsertUser: vi.fn(),
  withRequestDatabaseScope: vi.fn(),
}));

vi.mock("./clients", () => ({
  createPublicAuthClient: () => ({ auth: { resend: mocks.resend } }),
  supabaseAdmin: { auth: { admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser, listUsers: mocks.listUsers } } },
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
import { PgDialect } from "drizzle-orm/pg-core";
import { cooperativeAdminApplications, cooperatives, roles as rolesTable, users as usersTable } from "../drizzle/pg-schema";
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

let nextTestIp = 10;

function publicContext(ip = `192.0.2.${nextTestIp++}`): TrpcContext {
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
    },
    error: null,
  };
}

const pgDialect = new PgDialect();

function registrationDb(
  roleRows: Array<{ roleId: number; roleName: string }>,
  profileExecute = vi.fn().mockResolvedValue(undefined),
  options: { softDeleted?: boolean } = {},
) {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn((clause: any) => ({
          limit: vi.fn(async () => {
            if (table === cooperatives) return [{ id: 12, status: "active" }];
            if (table === usersTable) {
              let sqlText = "";
              try {
                sqlText = clause ? pgDialect.sqlToQuery(clause).sql : "";
              } catch {
                sqlText = "";
              }
              if (/"deletedAt"\s+is not null/i.test(sqlText)) {
                return options.softDeleted ? [{ id: 99 }] : [];
              }
              return [{ id: 99 }];
            }
            if (table === rolesTable) return roleRows;
            if (table === cooperativeAdminApplications) return [];
            return roleRows;
          }),
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    execute: vi.fn(async (query: any) => {
      let sqlText = "";
      try {
        sqlText = pgDialect.sqlToQuery(query).sql;
      } catch {
        sqlText = "";
      }
      if (/email_has_deleted_user/i.test(sqlText)) {
        return [{ deleted: Boolean(options.softDeleted) }];
      }
      return profileExecute(query);
    }),
  };
}

describe("public registration role policy and verification", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", "https://market.example.test");
    mocks.createUser.mockReset();
    mocks.listUsers.mockReset().mockResolvedValue({ data: { users: [] }, error: null });
    mocks.resend.mockReset().mockResolvedValue({ error: null });
    mocks.deleteUser.mockReset().mockResolvedValue({ error: null });
    mocks.upsertUser.mockReset().mockResolvedValue(undefined);
    mocks.withRequestDatabaseScope.mockReset().mockImplementation((_authUserId, callback) => callback());
    const values = vi.fn().mockResolvedValue(undefined);
    mocks.getDb.mockReset().mockResolvedValue(registrationDb([{ roleId: 47, roleName: "seller" }], values));
  });

  it("allows Buyer, Seller, and Cooperative Admin self-registration choices only", () => {
    expect(registrationRoleSchema.safeParse("buyer").success).toBe(true);
    expect(registrationRoleSchema.safeParse("seller").success).toBe(true);
    expect(registrationRoleSchema.safeParse("coop_admin").success).toBe(true);
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

  it("requires a cooperative for seller and coop_admin, and rejects admin/superadmin roles", () => {
    const sellerRegistration = {
      email: "seller@example.test",
      password: "example-password",
      name: "Example Seller",
      role: "seller" as const,
    };

    expect(publicRegistrationInputSchema.safeParse(sellerRegistration).success).toBe(false);
    expect(publicRegistrationInputSchema.safeParse({ ...sellerRegistration, cooperativeId: 2 }).success).toBe(true);
    expect(publicRegistrationInputSchema.safeParse({
      ...sellerRegistration,
      role: "coop_admin",
      newCooperativeName: "New Farm Coop",
      newCooperativeLocation: "Butuan City",
      newCooperativeAddress: "Purok 1, Brgy. Sample",
    }).success).toBe(true);
    expect(publicRegistrationInputSchema.safeParse({ ...sellerRegistration, role: "admin" }).success).toBe(false);
    expect(publicRegistrationInputSchema.safeParse({
      ...sellerRegistration,
      cooperativeId: 2,
      approvalStatus: "approved",
    }).success).toBe(false);
  });

  it("starts Supabase email confirmation without auto-confirming or returning auth tokens", async () => {
    mocks.createUser.mockResolvedValue(newAuthSignup());
    const profileExecute = vi.fn().mockResolvedValue(undefined);
    mocks.getDb.mockResolvedValue(registrationDb([{ roleId: 48, roleName: "seller" }], profileExecute));
    const caller = appRouter.createCaller(publicContext());

    const result = await caller.auth.register({
      email: " Seller@Example.Test ",
      password: "example-password",
      name: "Example Seller",
      role: "seller",
      cooperativeId: 12,
    });

    expect(mocks.createUser).toHaveBeenCalledWith({
      email: "seller@example.test",
      password: "example-password",
      email_confirm: false,
      user_metadata: { name: "Example Seller" },
    });
    expect(mocks.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "seller@example.test",
      options: { emailRedirectTo: "https://market.example.test/auth?verification=success" },
    });
    expect(mocks.upsertUser).toHaveBeenCalledWith(expect.objectContaining({
      openId: "new-auth-user",
      role: "seller",
      approvalStatus: "pending",
      cooperativeId: null,
      requestedRole: null,
    }), undefined, expect.objectContaining({ intent: "seller" }));
    expect(profileExecute).toHaveBeenCalled();
    expect(result).toEqual({ success: true, verificationRequired: true });
    expect(JSON.stringify(result)).not.toContain("access_token");
  });

  it("provisions a Buyer with the server-selected approved role and canonical role ID", async () => {
    const signup = newAuthSignup();
    signup.data.user.email = "buyer@example.test";
    mocks.createUser.mockResolvedValue(signup);
    const profileExecute = vi.fn().mockResolvedValue(undefined);
    mocks.getDb.mockResolvedValue(registrationDb([{ roleId: 47, roleName: "buyer" }], profileExecute));

    const result = await appRouter.createCaller(publicContext()).auth.register({
      email: "buyer@example.test",
      password: "example-password",
      name: "Example Buyer",
      role: "buyer",
      cooperativeId: 12,
    });

    expect(result).toEqual({ success: true, verificationRequired: true });
    expect(mocks.upsertUser).toHaveBeenCalledWith(expect.objectContaining({
      openId: "new-auth-user",
      role: "buyer",
      approvalStatus: "approved",
      cooperativeId: null,
      requestedRole: null,
    }), undefined, expect.objectContaining({ intent: "buyer" }));
    expect(profileExecute).toHaveBeenCalled();
  });

  it("fails closed and removes the Auth identity when a public registration role is ambiguous", async () => {
    mocks.createUser.mockResolvedValue(newAuthSignup());
    mocks.getDb.mockResolvedValue(registrationDb([
      { roleId: 47, roleName: "seller" },
      { roleId: 48, roleName: "seller" },
    ]));

    await expect(appRouter.createCaller(publicContext("192.0.2.11")).auth.register({
      email: "seller@example.test",
      password: "example-password",
      name: "Example Seller",
      role: "seller",
      cooperativeId: 12,
    })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });

    expect(mocks.deleteUser).toHaveBeenCalledWith("new-auth-user");
  });

  it("maps Cooperative Admin registration to Buyer access without granting Admin", async () => {
    mocks.createUser.mockResolvedValue(newAuthSignup());
    const profileExecute = vi.fn().mockResolvedValue(undefined);
    const db = registrationDb([{ roleId: 47, roleName: "buyer" }], profileExecute);
    mocks.getDb.mockResolvedValue(db);

    const result = await appRouter.createCaller(publicContext("192.0.2.12")).auth.register({
      email: "officer-applicant@example.test",
      password: "example-password",
      name: "Officer Applicant",
      role: "coop_admin",
      cooperativeId: 12,
    });

    expect(result).toEqual({ success: true, verificationRequired: true });
    expect(mocks.upsertUser).toHaveBeenCalledWith(expect.objectContaining({
      role: "buyer",
      approvalStatus: "approved",
      cooperativeId: null,
      requestedRole: "admin",
    }), undefined, expect.objectContaining({ intent: "cooperative_admin" }));
    const executedSql = profileExecute.mock.calls
      .map(call => JSON.stringify(call))
      .join("\n");
    expect(executedSql).toMatch(/cooperativeAdminApplications/);
  });

  it("does not provision an application profile for an existing Auth identity", async () => {
    mocks.createUser.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", message: "User already registered", name: "AuthApiError" },
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

  it("returns generic success for a duplicate signup matching an active account", async () => {
    mocks.createUser.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", message: "User already registered", name: "AuthApiError" },
    });
    mocks.listUsers.mockResolvedValue({
      data: {
        users: [{
          id: "active-auth-user",
          email: "active@example.test",
          email_confirmed_at: "2026-11-18T08:00:00.000Z",
        }],
      },
      error: null,
    });

    const result = await appRouter.createCaller(publicContext()).auth.register({
      email: "active@example.test",
      password: "example-password",
      name: "Existing Buyer",
      role: "buyer",
    });

    expect(result).toEqual({ success: true, verificationRequired: true });
    expect(JSON.stringify(result)).not.toContain("This account is no longer active");
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  it("repairs orphan Auth users when duplicate signup is unconfirmed and has no app row", async () => {
    mocks.createUser.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", message: "User already registered", name: "AuthApiError" },
    });
    mocks.listUsers.mockResolvedValue({
      data: {
        users: [{
          id: "orphan-auth-user",
          email: "orphan@example.test",
          email_confirmed_at: null,
        }],
      },
      error: null,
    });
    const profileExecute = vi.fn().mockResolvedValue(undefined);
    const orphanDb = {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => {
              if (table === usersTable) return [];
              if (table === rolesTable) return [{ roleId: 47, roleName: "buyer" }];
              if (table === cooperatives) return [{ id: 12, status: "active" }];
              return [];
            }),
          })),
        })),
      })),
      execute: vi.fn(async (query: any) => {
        let sqlText = "";
        try {
          sqlText = pgDialect.sqlToQuery(query).sql;
        } catch {
          sqlText = "";
        }
        if (/email_has_deleted_user/i.test(sqlText)) return [{ deleted: false }];
        return profileExecute(query);
      }),
    };
    mocks.getDb.mockResolvedValue(orphanDb);

    const result = await appRouter.createCaller(publicContext()).auth.register({
      email: "orphan@example.test",
      password: "example-password",
      name: "Orphan Repair",
      role: "buyer",
    });

    expect(result).toEqual({ success: true, verificationRequired: true });
    expect(mocks.upsertUser).toHaveBeenCalledWith(expect.objectContaining({
      openId: "orphan-auth-user",
      role: "buyer",
    }), undefined, expect.objectContaining({ intent: "buyer" }));
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("fails closed and removes a new Auth user if email confirmation is disabled", async () => {
    mocks.createUser.mockResolvedValue({
      data: {
        user: { id: "auto-confirmed-user", email: "buyer@example.test", identities: [{ id: "identity-1" }], email_confirmed_at: "2026-01-01T00:00:00Z" },
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

  it("keeps registration successful when confirmation email is deferred by rate limits", async () => {
    mocks.createUser.mockResolvedValue(newAuthSignup());
    mocks.resend.mockResolvedValue({
      error: { code: "over_email_send_rate_limit", message: "email rate limit exceeded", name: "AuthApiError" },
    });
    const profileExecute = vi.fn().mockResolvedValue(undefined);
    mocks.getDb.mockResolvedValue(registrationDb([{ roleId: 48, roleName: "seller" }], profileExecute));

    const result = await appRouter.createCaller(publicContext("192.0.2.77")).auth.register({
      email: "seller-rate-limit@example.test",
      password: "example-password",
      name: "Example Seller",
      role: "seller",
      cooperativeId: 12,
    });

    expect(result).toEqual({ success: true, verificationRequired: true });
    expect(mocks.upsertUser).toHaveBeenCalled();
    expect(profileExecute).toHaveBeenCalled();
  });

  it("rejects registration for a soft-deleted account with an inactive message", async () => {
    mocks.getDb.mockResolvedValue(registrationDb([{ roleId: 47, roleName: "buyer" }], undefined, { softDeleted: true }));

    await expect(appRouter.createCaller(publicContext("192.0.2.88")).auth.register({
      email: "soft-deleted@example.test",
      password: "example-password",
      name: "Deleted User",
      role: "buyer",
    })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "This account is no longer active. Please contact an administrator.",
    });

    expect(mocks.createUser).not.toHaveBeenCalled();
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

    for (let attempt = 0; attempt < 10; attempt += 1) {
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
