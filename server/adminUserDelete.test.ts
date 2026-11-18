import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  updateUserById: vi.fn(),
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
  supabaseAdmin: { auth: { admin: { updateUserById: mocks.updateUserById } } },
}));

import { appRouter } from "./routers";

function adminCaller() {
  return appRouter.createCaller({
    req: { headers: {} },
    res: {},
    user: {
      id: 1,
      openId: "admin-auth",
      role: "admin",
      approvalStatus: "approved",
      verificationStatus: "approved",
      cooperativeId: 7,
      contactNumber: null,
      birthdate: null,
      phone: null,
      address: null,
      profileImageUrl: null,
      name: "Cooperative Admin",
      email: "admin@example.test",
    },
    authUserId: "admin-auth",
    authResolution: "application_user_resolved",
  } as TrpcContext);
}

describe("admin soft delete user", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
    mocks.updateUserById.mockReset().mockResolvedValue({ error: null });
  });

  it("soft-deletes and bans an eligible account without deleting its owner-only cart rows", async () => {
    const target = {
      id: 2,
      openId: "buyer-auth",
      role: "buyer",
      cooperativeId: 7,
      deletedAt: null,
    };
    const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const tx = {
      select: (() => {
        let selectCount = 0;
        return () => {
          selectCount += 1;
          const current = selectCount;
          const chain: Record<string, (...args: unknown[]) => unknown> = {
            from: () => chain,
            where: () => current === 1
              ? chain
              : Promise.resolve([{ count: current === 2 ? 3 : 1 }]),
            for: () => chain,
            limit: async () => [target],
          };
          return chain;
        };
      })(),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          updates.push({ table, values });
          return { where: async () => undefined };
        },
      }),
      insert: () => ({ values: async () => undefined }),
      delete: vi.fn(),
      execute: async () => undefined,
    };
    mocks.getDb.mockResolvedValue({
      transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
    });

    await expect(adminCaller().admin.softDeleteUser({ userId: 2, confirm: true }))
      .resolves.toMatchObject({ success: true, listingCount: 3, openOrderCount: 1 });

    expect(mocks.updateUserById).toHaveBeenCalledWith("buyer-auth", { ban_duration: "876000h" });
    expect(updates.some(update => "deletedAt" in update.values)).toBe(true);
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it("does not report success when the Auth ban fails", async () => {
    const target = {
      id: 2,
      openId: "buyer-auth",
      role: "buyer",
      cooperativeId: 7,
      deletedAt: null,
    };
    let selectCount = 0;
    const tx = {
      select: () => {
        selectCount += 1;
        const current = selectCount;
        const chain: Record<string, (...args: unknown[]) => unknown> = {
          from: () => chain,
          where: () => current === 1
            ? chain
            : Promise.resolve([{ count: 0 }]),
          for: () => chain,
          limit: async () => [target],
        };
        return chain;
      },
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      insert: () => ({ values: async () => undefined }),
      execute: async () => undefined,
    };
    mocks.getDb.mockResolvedValue({
      transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
    });
    mocks.updateUserById.mockResolvedValue({ error: { message: "Auth service unavailable" } });

    await expect(adminCaller().admin.softDeleteUser({ userId: 2, confirm: true }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
