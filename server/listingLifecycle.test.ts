import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  withRequestDatabaseScope: vi.fn((_id: string | null, cb: () => Promise<unknown>) => cb()),
}));

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return { ...actual, getDb: mocks.getDb, withRequestDatabaseScope: mocks.withRequestDatabaseScope };
});

import { appRouter } from "./routers";

function sellerCtx(): TrpcContext {
  return {
    req: { headers: {} },
    res: {},
    user: {
      id: 20,
      openId: "seller-auth",
      role: "seller",
      requestedRole: null,
      approvalStatus: "approved",
      verificationStatus: "approved",
      cooperativeId: 1,
      contactNumber: null,
      birthdate: null,
      phone: null,
      address: null,
      profileImageUrl: null,
      name: "Seller",
      email: "seller@example.test",
    },
    authUserId: "seller-auth",
    authResolution: "application_user_resolved",
  } as TrpcContext;
}

function chainReturning(ids: Array<{ id: number }>) {
  return {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => ids,
        }),
      }),
    }),
  };
}

describe("products soft delete / unarchive", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
  });

  it("softDelete marks own listing deleted", async () => {
    mocks.getDb.mockResolvedValue(chainReturning([{ id: 7 }]));
    const result = await appRouter.createCaller(sellerCtx()).products.softDelete({ id: 7 });
    expect(result).toEqual({ success: true });
  });

  it("unarchive restores archived own listing", async () => {
    mocks.getDb.mockResolvedValue(chainReturning([{ id: 8 }]));
    const result = await appRouter.createCaller(sellerCtx()).products.unarchive({ id: 8 });
    expect(result).toEqual({ success: true });
  });

  it("softDelete not found when no row updated", async () => {
    mocks.getDb.mockResolvedValue(chainReturning([]));
    await expect(appRouter.createCaller(sellerCtx()).products.softDelete({ id: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
