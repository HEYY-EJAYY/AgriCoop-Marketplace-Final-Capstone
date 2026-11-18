import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { assertBuyerOwnsOrders } from "./orderArchive";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  withRequestDatabaseScope: vi.fn((_authUserId: string | null, callback: () => Promise<unknown>) => callback()),
  getBuyerOrders: vi.fn(async () => []),
  countBuyerOrderInboxStates: vi.fn(async () => ({ active: 0, archived: 0 })),
}));

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return {
    ...actual,
    getDb: mocks.getDb,
    withRequestDatabaseScope: mocks.withRequestDatabaseScope,
    getBuyerOrders: mocks.getBuyerOrders,
    countBuyerOrderInboxStates: mocks.countBuyerOrderInboxStates,
  };
});

import { appRouter } from "./routers";

function caller(role: "buyer" | "seller" | "admin", id = 10) {
  return appRouter.createCaller({
    req: { headers: {} },
    res: {},
    user: {
      id,
      openId: "auth-user",
      role,
      approvalStatus: "approved",
      verificationStatus: "approved",
      cooperativeId: null,
      contactNumber: null,
      birthdate: null,
      phone: null,
      address: null,
      profileImageUrl: null,
      name: role,
      email: `${role}@example.test`,
    },
    authUserId: "auth-user",
    authResolution: "application_user_resolved",
  } as TrpcContext);
}

function orderSelectChain(ownedIds: number[]) {
  const result: Record<string, unknown> = {
    from: () => result,
    where: () => result,
    limit: async () => (ownedIds.length ? [{}] : []),
    orderBy: () => result,
    leftJoin: () => result,
    innerJoin: () => result,
    for: () => result,
    set: () => result,
    values: async () => undefined,
  };
  let selectPass = 0;
  return {
    select: () => {
      selectPass += 1;
      if (selectPass === 1) {
        return {
          from: () => ({
            where: async () => ownedIds.map(id => ({ id })),
          }),
        };
      }
      return {
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      };
    },
    update: () => result,
    insert: () => ({ values: async () => undefined }),
  };
}

describe("assertBuyerOwnsOrders", () => {
  it("passes when every id is owned", () => {
    expect(() => assertBuyerOwnsOrders([1, 2], [{ id: 1 }, { id: 2 }])).not.toThrow();
  });

  it("throws FORBIDDEN when any id is missing", () => {
    try {
      assertBuyerOwnsOrders([1, 2], [{ id: 1 }]);
      expect.fail("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("FORBIDDEN");
    }
  });
});

describe("orders.updateArchive", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
    mocks.countBuyerOrderInboxStates.mockClear();
  });

  it("rejects staff who are not the buyer", async () => {
    await expect(
      caller("admin", 99).orders.updateArchive({ orderIds: [1], action: "archive" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects archive when the buyer does not own every order", async () => {
    mocks.getDb.mockResolvedValue(orderSelectChain([1]));
    await expect(
      caller("buyer", 10).orders.updateArchive({ orderIds: [1, 2], action: "archive" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: /your own orders/i });
  });

  it("archives owned orders for the buyer", async () => {
    mocks.getDb.mockResolvedValue(orderSelectChain([7]));
    await expect(
      caller("buyer", 10).orders.updateArchive({ orderIds: [7], action: "archive" }),
    ).resolves.toMatchObject({ success: true, count: 1 });
  });

  it("scopes buyerMine lists with archived flag", async () => {
    await caller("buyer", 10).orders.buyerMine({ archived: true });
    expect(mocks.getBuyerOrders).toHaveBeenCalledWith(10, { archived: true, deleted: false });
  });

  it("uses the dedicated seller_order channel for seller deletes", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    let selectPass = 0;
    mocks.getDb.mockResolvedValue({
      select: () => {
        selectPass += 1;
        return {
          from: () => ({
            where: () => selectPass === 1
              ? Promise.resolve([{ id: 7 }])
              : { limit: async () => [] },
          }),
        };
      },
      insert: () => ({ values: async (value: Record<string, unknown>) => { inserted.push(value); } }),
    });

    await expect(caller("seller", 10).orders.sellerUpdateArchive({
      orderIds: [7],
      action: "delete",
    })).resolves.toMatchObject({ success: true });
    expect(inserted[0]).toMatchObject({ channel: "seller_order", threadId: 7, userId: 10 });
  });

  it("uses the dedicated quotation channel for quotation deletion", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    let selectPass = 0;
    mocks.getDb.mockResolvedValue({
      select: () => {
        selectPass += 1;
        return {
          from: () => ({
            where: () => selectPass === 1
              ? Promise.resolve([{ id: 8 }])
              : { limit: async () => [] },
          }),
        };
      },
      insert: () => ({ values: async (value: Record<string, unknown>) => { inserted.push(value); } }),
    });

    await expect(caller("buyer", 10).quotations.updateState({
      quotationIds: [8],
      action: "delete",
      side: "buyer",
    })).resolves.toMatchObject({ success: true });
    expect(inserted[0]).toMatchObject({ channel: "quotation", threadId: 8, userId: 10 });
  });
});