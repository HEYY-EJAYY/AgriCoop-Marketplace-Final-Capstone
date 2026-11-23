import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  deleteAuthUser: vi.fn(),
  storageRemove: vi.fn(),
  storageFrom: vi.fn(),
}));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getDb: mocks.getDb,
    withRequestDatabaseScope: (_authUserId: string | null, callback: () => Promise<unknown>) => callback(),
  };
});

vi.mock("./clients", () => ({
  createPublicAuthClient: () => ({ auth: { resend: vi.fn() } }),
  supabaseAdmin: {
    auth: { admin: { deleteUser: mocks.deleteAuthUser } },
    storage: { from: mocks.storageFrom },
  },
}));

import { appRouter } from "./routers";

function caller(role: "admin" | "superadmin" = "admin", cooperativeId: number | null = 7, actorId = 1) {
  return appRouter.createCaller({
    req: { headers: {} },
    res: {},
    user: {
      id: actorId,
      openId: "admin-auth",
      role,
      approvalStatus: "approved",
      verificationStatus: "approved",
      cooperativeId,
      contactNumber: null,
      birthdate: null,
      phone: null,
      address: null,
      profileImageUrl: null,
      name: "Admin",
      email: "admin@example.test",
    },
    authUserId: "admin-auth",
    authResolution: "application_user_resolved",
  } as TrpcContext);
}

type TxScript = {
  target: Record<string, unknown> | null;
  listingCount?: number;
  openOrderCount?: number;
  purgeResult?: { coopDocumentPaths: string[]; verificationPaths: string[] };
};

function makeTx(script: TxScript) {
  const executed: unknown[] = [];
  const results: unknown[] = [
    script.target ? [script.target] : [],
    [{ count: script.listingCount ?? 0 }],
    [{ count: script.openOrderCount ?? 0 }],
  ];
  let selectCount = 0;
  const tx = {
    select: () => {
      const result = results[Math.min(selectCount, results.length - 1)];
      selectCount += 1;
      const isCountOrList = selectCount > 1;
      const chain: Record<string, (...args: unknown[]) => unknown> = {
        from: () => chain,
        where: () => (isCountOrList ? Promise.resolve(result) : chain),
        for: () => chain,
        limit: async () => result,
      };
      return chain;
    },
    execute: async (query: unknown) => {
      executed.push(query);
      return [{ result: script.purgeResult ?? { coopDocumentPaths: [], verificationPaths: [] } }];
    },
  };
  return { tx, executed };
}

function mockDb(script: TxScript) {
  const { tx, executed } = makeTx(script);
  mocks.getDb.mockResolvedValue({
    transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
  });
  return { executed };
}

const eligibleTarget = {
  id: 2,
  openId: "buyer-auth-id",
  loginMethod: "supabase",
  role: "buyer",
  cooperativeId: 7,
};

describe("admin permanent delete user", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
    mocks.deleteAuthUser.mockReset().mockResolvedValue({ error: null });
    mocks.storageRemove.mockReset().mockResolvedValue({ error: null });
    mocks.storageFrom.mockReset().mockReturnValue({ remove: mocks.storageRemove });
  });

  it("permanently deletes an eligible account: purge function, documents, and Auth user", async () => {
    const { executed } = mockDb({
      target: eligibleTarget,
      listingCount: 3,
      openOrderCount: 1,
      purgeResult: {
        coopDocumentPaths: ["coop-admin-applications/buyer-auth-id/id.pdf"],
        verificationPaths: ["profile-verification-documents/buyer-auth-id/doc.png"],
      },
    });

    await expect(caller().admin.deleteUser({ userId: 2, confirm: true }))
      .resolves.toMatchObject({ success: true, cleanupWarnings: 0, listingCount: 3, openOrderCount: 1 });

    // purge_user_account + write_audit_log both run through tx.execute.
    expect(executed.length).toBeGreaterThanOrEqual(2);
    expect(mocks.deleteAuthUser).toHaveBeenCalledWith("buyer-auth-id");
    expect(mocks.storageFrom).toHaveBeenCalledWith("coop-admin-applications");
    expect(mocks.storageFrom).toHaveBeenCalledWith("profile-verification-documents");
    expect(mocks.storageRemove).toHaveBeenCalledWith(["coop-admin-applications/buyer-auth-id/id.pdf"]);
    expect(mocks.storageRemove).toHaveBeenCalledWith(["profile-verification-documents/buyer-auth-id/doc.png"]);
  });

  it("completes deletion for a seller with listings (listing detach handled by purge function)", async () => {
    mockDb({
      target: { ...eligibleTarget, role: "seller" },
      listingCount: 2,
    });

    await expect(caller().admin.deleteUser({ userId: 2, confirm: true }))
      .resolves.toMatchObject({ success: true, listingCount: 2 });
    expect(mocks.deleteAuthUser).toHaveBeenCalledWith("buyer-auth-id");
  });

  it("does not call the Auth admin API for demo-seeded users", async () => {
    mockDb({ target: { ...eligibleTarget, openId: "demo-buyer-001", loginMethod: "demo" } });

    await expect(caller().admin.deleteUser({ userId: 2, confirm: true }))
      .resolves.toMatchObject({ success: true });

    expect(mocks.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("still succeeds with a cleanup warning when the Auth deletion fails", async () => {
    mockDb({ target: eligibleTarget });
    mocks.deleteAuthUser.mockResolvedValue({ error: { message: "Auth unavailable" } });

    await expect(caller().admin.deleteUser({ userId: 2, confirm: true }))
      .resolves.toMatchObject({ success: true, cleanupWarnings: 1 });
  });

  it("refuses to delete a SuperAdmin account", async () => {
    mockDb({ target: { ...eligibleTarget, role: "superadmin", cooperativeId: null } });

    await expect(caller("superadmin", null).admin.deleteUser({ userId: 2, confirm: true }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("refuses self-deletion", async () => {
    mockDb({ target: { ...eligibleTarget, id: 1 } });

    await expect(caller().admin.deleteUser({ userId: 1, confirm: true }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses when a cooperative admin targets a user outside their cooperative", async () => {
    mockDb({ target: { ...eligibleTarget, cooperativeId: 9 } });

    await expect(caller("admin", 7).admin.deleteUser({ userId: 2, confirm: true }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses when a cooperative admin targets an OfficerAdmin", async () => {
    mockDb({ target: { ...eligibleTarget, role: "admin", cooperativeId: 7 } });

    await expect(caller("admin", 7).admin.deleteUser({ userId: 2, confirm: true }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets a SuperAdmin delete an OfficerAdmin", async () => {
    mockDb({ target: { ...eligibleTarget, role: "admin", cooperativeId: 7 } });

    await expect(caller("superadmin", null).admin.deleteUser({ userId: 2, confirm: true }))
      .resolves.toMatchObject({ success: true });
    expect(mocks.deleteAuthUser).toHaveBeenCalledWith("buyer-auth-id");
  });

  it("requires explicit confirmation", async () => {
    await expect(caller().admin.deleteUser({ userId: 2, confirm: false as unknown as true }))
      .rejects.toThrow();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
