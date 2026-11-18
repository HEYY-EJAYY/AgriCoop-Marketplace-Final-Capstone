import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserByVerifiedAuthId: vi.fn(),
  withRequestDatabaseScope: vi.fn(),
}));

vi.mock("./clients", () => ({
  supabaseAdmin: { auth: { getUser: mocks.getUser } },
}));

vi.mock("./db", () => ({
  getUserByVerifiedAuthId: mocks.getUserByVerifiedAuthId,
  withRequestDatabaseScope: mocks.withRequestDatabaseScope,
}));

import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { TrpcContext } from "./_core/context";
import { createContext } from "./_core/context";

function contextOptions(authorization = "Bearer test-access-token"): CreateExpressContextOptions {
  return {
    req: {
      headers: authorization ? { authorization } : {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    info: {} as CreateExpressContextOptions["info"],
  };
}

describe("request context identity resolution", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.getUserByVerifiedAuthId.mockReset();
    mocks.withRequestDatabaseScope.mockReset();
    mocks.withRequestDatabaseScope.mockImplementation((_authUserId, callback) => callback());
  });

  it("does not provision an application profile from Auth metadata", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          email: "unlinked@example.test",
          email_confirmed_at: "2026-01-01T00:00:00Z",
          user_metadata: { role: "superadmin", name: "Unlinked" },
        },
      },
    });
    mocks.getUserByVerifiedAuthId.mockResolvedValue({ status: "application_user_missing", user: null });

    const context = await createContext(contextOptions());

    expect(context.user).toBeNull();
    expect(context.authUserId).toBe("f47ac10b-58cc-4372-a567-0e02b2c3d479");
    expect(context.authResolution).toBe("application_user_missing");
    expect(mocks.getUserByVerifiedAuthId).toHaveBeenCalledWith("f47ac10b-58cc-4372-a567-0e02b2c3d479", expect.objectContaining({
      email: "unlinked@example.test",
      name: "Unlinked",
    }));
  });

  it("reports when no bearer token was received without validating a token", async () => {
    const context = await createContext(contextOptions(""));

    expect(context.user).toBeNull();
    expect(context.authUserId).toBeNull();
    expect(context.authResolution).toBe("no_bearer_token");
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("reports a rejected bearer token without looking up an application user", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthApiError", status: 401 },
    });

    const context = await createContext(contextOptions());

    expect(context.user).toBeNull();
    expect(context.authResolution).toBe("bearer_rejected");
    expect(mocks.getUserByVerifiedAuthId).not.toHaveBeenCalled();
  });

  it("does not resolve or create a request scope for an unverified Auth identity", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "unverified-id", email: "waiting@example.test", email_confirmed_at: null } },
      error: null,
    });

    const context = await createContext(contextOptions());

    expect(context.user).toBeNull();
    expect(context.authUserId).toBeNull();
    expect(context.authResolution).toBe("email_not_verified");
    expect(mocks.getUserByVerifiedAuthId).not.toHaveBeenCalled();
    expect(mocks.withRequestDatabaseScope).not.toHaveBeenCalled();
  });

  it("distinguishes an unavailable application database from a missing profile mapping", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479", email_confirmed_at: "2026-01-01T00:00:00Z", user_metadata: {} } },
      error: null,
    });
    mocks.withRequestDatabaseScope.mockRejectedValue(new Error("Database unavailable"));

    const context = await createContext(contextOptions());

    expect(context.user).toBeNull();
    expect(context.authResolution).toBe("application_database_unavailable");
    expect(mocks.getUserByVerifiedAuthId).not.toHaveBeenCalled();
  });

  it("reports database permission failures separately without logging database details", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479", email_confirmed_at: "2026-01-01T00:00:00Z" } },
      error: null,
    });
    mocks.withRequestDatabaseScope.mockRejectedValue(Object.assign(new Error("details suppressed"), { code: "42501" }));

    const context = await createContext(contextOptions());

    expect(context.authResolution).toBe("application_database_access_denied");
  });

  it("classifies a permission denial from the application-user lookup after successful Supabase Auth", async () => {
    const authUserId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    mocks.getUser.mockResolvedValue({
      data: {
        user: { id: authUserId, email_confirmed_at: "2026-01-01T00:00:00Z" },
      },
      error: null,
    });
    mocks.getUserByVerifiedAuthId.mockRejectedValue(Object.assign(
      new Error("Request database operation failed during application_user_lookup."),
      {
        databasePhase: "application_user_lookup",
        cause: Object.assign(new Error("permission denied for schema agricoop_app"), { code: "42501" }),
      },
    ));

    const context = await createContext(contextOptions());

    expect(context.authResolution).toBe("application_database_access_denied");
    expect(context.authUserId).toBe(authUserId);
    expect(context.user).toBeNull();
    expect(mocks.withRequestDatabaseScope).toHaveBeenCalledWith(authUserId, expect.any(Function));
    expect(mocks.getUserByVerifiedAuthId).toHaveBeenCalledWith(authUserId, expect.any(Object));
  });

  it("logs only the database phase and SQLSTATE, not credentials or identity values", async () => {
    const authUserId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const markers = [
      "Bearer auth-token-marker",
      "auth-token-marker",
      "database-url-marker",
      "service-role-marker",
      authUserId,
    ];
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AGRICOOP_AUTH_DIAGNOSTICS", "true");
    const diagnosticLog = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.getUser.mockResolvedValue({
      data: { user: { id: authUserId, email_confirmed_at: "2026-01-01T00:00:00Z" } },
      error: null,
    });
    mocks.getUserByVerifiedAuthId.mockRejectedValue(Object.assign(
      new Error(markers.join(" ")),
      {
        databasePhase: "application_user_lookup",
        cause: Object.assign(new Error("permission denied"), { code: "42501" }),
      },
    ));

    try {
      await createContext(contextOptions("Bearer auth-token-marker"));
      const logOutput = JSON.stringify(diagnosticLog.mock.calls);

      expect(logOutput).toContain("application_user_lookup");
      expect(logOutput).toContain("42501");
      for (const marker of markers) expect(logOutput).not.toContain(marker);
    } finally {
      diagnosticLog.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("recognizes a permission SQLSTATE nested in a database error cause", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479", email_confirmed_at: "2026-01-01T00:00:00Z" } },
      error: null,
    });
    mocks.withRequestDatabaseScope.mockRejectedValue(
      Object.assign(new Error("wrapped database error"), { cause: Object.assign(new Error("permission denied"), { code: "42501" }) }),
    );

    const context = await createContext(contextOptions());

    expect(context.authResolution).toBe("application_database_access_denied");
  });

  it("distinguishes missing PostgreSQL schema objects from a database outage", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479", email_confirmed_at: "2026-01-01T00:00:00Z" } },
      error: null,
    });
    mocks.withRequestDatabaseScope.mockRejectedValue(Object.assign(new Error("relation unavailable"), { code: "42P01" }));

    const context = await createContext(contextOptions());

    expect(context.authResolution).toBe("application_database_schema_unavailable");
  });

  it("does not misreport a visible profile with no visible legacy mapping as a missing profile", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479", email_confirmed_at: "2026-01-01T00:00:00Z" } },
      error: null,
    });
    mocks.getUserByVerifiedAuthId.mockResolvedValue({ status: "application_user_mapping_unavailable", user: null });

    const context = await createContext(contextOptions());

    expect(context.user).toBeNull();
    expect(context.authResolution).toBe("application_user_mapping_unavailable");
  });

  it("fails closed when the canonical public role conflicts with the legacy application role", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479", email_confirmed_at: "2026-01-01T00:00:00Z" } },
      error: null,
    });
    mocks.getUserByVerifiedAuthId.mockResolvedValue({ status: "application_role_mapping_conflict", user: null });

    const context = await createContext(contextOptions());

    expect(context.user).toBeNull();
    expect(context.authResolution).toBe("application_role_mapping_conflict");
  });

  it("resolves an existing user without refreshing fields or roles from Auth metadata", async () => {
    const existingUser = {
      id: 8,
      openId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      email: "member@example.test",
      name: "Member",
      loginMethod: "supabase",
      role: "buyer",
      approvalStatus: "approved",
      verificationStatus: "unverified",
      cooperativeId: null,
      contactNumber: null,
      address: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      lastSignedIn: new Date("2026-01-01T00:00:00Z"),
    };
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: existingUser.openId,
          email: "member@example.test",
          email_confirmed_at: "2026-01-01T00:00:00Z",
          user_metadata: { role: "superadmin", name: "Updated Member" },
        },
      },
    });
    mocks.getUserByVerifiedAuthId.mockResolvedValue({ status: "application_user_resolved", user: existingUser });

    const context = await createContext(contextOptions());

    expect(context.user).toBe(existingUser);
    expect(context.authResolution).toBe("application_user_resolved");
    expect(mocks.getUserByVerifiedAuthId).toHaveBeenCalledWith(existingUser.openId, expect.objectContaining({
      email: "member@example.test",
      name: "Updated Member",
    }));
  });
});
