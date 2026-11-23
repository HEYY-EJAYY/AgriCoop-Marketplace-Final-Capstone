import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  withRequestDatabaseScope: vi.fn((_authUserId: string | null, callback: () => Promise<unknown>) => callback()),
}));

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return {
    ...actual,
    getDb: mocks.getDb,
    withRequestDatabaseScope: mocks.withRequestDatabaseScope,
  };
});

import { appRouter } from "./routers";

function buyerCaller(id = 42) {
  return appRouter.createCaller({
    req: { headers: {} },
    res: {},
    user: {
      id,
      openId: "buyer-auth",
      role: "buyer",
      approvalStatus: "approved",
      verificationStatus: "approved",
      cooperativeId: 1,
      contactNumber: null,
      birthdate: null,
      phone: null,
      address: null,
      profileImageUrl: null,
      name: "Buyer",
      email: "buyer@example.test",
    },
    authUserId: "buyer-auth",
    authResolution: "application_user_resolved",
  } as TrpcContext);
}

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
      cooperativeId: 1,
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

describe("cart router", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
    mocks.withRequestDatabaseScope.mockClear();
  });

  it("rejects admin role from cart.mine", async () => {
    await expect(adminCaller().cart.mine()).rejects.toMatchObject({
      code: "FORBIDDEN",
    } satisfies Partial<TRPCError>);
  });

  it("clamps quantity to stock and ignores client-side price", async () => {
    const execute = vi.fn(async () => []);
    const productRow = {
      id: 9,
      name: "Tomatoes",
      unit: "kg",
      sellerId: 7,
      stockQty: 12,
      minOrderQty: 1,
      status: "published",
      verificationStatus: "approved",
      visibility: "visible",
      deletedAt: null,
      sellerApprovalStatus: "approved",
      sellerDeletedAt: null,
    };
    const cartLoadRows = [{
      productId: 9,
      quantity: 12,
      name: "Tomatoes",
      unit: "kg",
      minOrderQty: 1,
      stockQty: 12,
      priceCents: 5000,
      sellerId: 7,
      sellerName: "Farm",
      cooperativeId: 1,
      cooperativeName: "Coop",
      allowsPickup: true,
      allowsDelivery: true,
      acceptsOnlinePayment: false,
      primaryImageUrl: null,
      status: "published",
      verificationStatus: "approved",
      visibility: "visible",
      deletedAt: null,
      sellerApprovalStatus: "approved",
      sellerDeletedAt: null,
    }];

    let selectPass = 0;
    mocks.getDb.mockResolvedValue({
      select: () => {
        selectPass += 1;
        if (selectPass === 1) {
          return {
            from: () => ({
              leftJoin: () => ({
                where: () => ({
                  limit: async () => [productRow],
                }),
              }),
            }),
          };
        }
        return {
          from: () => ({
            innerJoin: () => ({
              innerJoin: () => ({
                leftJoin: () => ({
                  where: async () => cartLoadRows,
                }),
              }),
            }),
          }),
        };
      },
      execute,
      delete: () => ({ where: async () => undefined }),
    });

    const result = await buyerCaller().cart.setQuantity({ productId: 9, quantity: 99 });
    expect(result.clamped).toBe(true);
    expect(result.quantity).toBe(12);
    expect(result.stockQty).toBe(12);
    expect(result.items[0]?.priceCents).toBe(5000);
    expect(execute).toHaveBeenCalled();
  });

  it("removes the cart row when quantity is set to 0", async () => {
    const deleteWhere = vi.fn(async () => undefined);
    let selectPass = 0;
    mocks.getDb.mockResolvedValue({
      select: () => {
        selectPass += 1;
        if (selectPass === 1) {
          return {
            from: () => ({
              leftJoin: () => ({
                where: () => ({
                  limit: async () => [{
                    id: 9,
                    sellerId: 7,
                    stockQty: 5,
                    minOrderQty: 1,
                    status: "published",
                    verificationStatus: "approved",
                    visibility: "visible",
                    deletedAt: null,
                    name: "Tomatoes",
                    unit: "kg",
                    sellerApprovalStatus: "approved",
                    sellerDeletedAt: null,
                  }],
                }),
              }),
            }),
          };
        }
        return {
          from: () => ({
            innerJoin: () => ({
              innerJoin: () => ({
                leftJoin: () => ({
                  where: async () => [],
                }),
              }),
            }),
          }),
        };
      },
      delete: () => ({ where: deleteWhere }),
      execute: vi.fn(async () => []),
    });

    const result = await buyerCaller().cart.setQuantity({ productId: 9, quantity: 0 });
    expect(result.quantity).toBe(0);
    expect(deleteWhere).toHaveBeenCalled();
  });

  type MockProduct = {
    stockQty: number;
    minOrderQty: number;
  };

  const productRowFor = (product: MockProduct) => ({
    id: 9,
    name: "Tomatoes",
    unit: "kg",
    sellerId: 7,
    stockQty: product.stockQty,
    minOrderQty: product.minOrderQty,
    status: "published",
    verificationStatus: "approved",
    visibility: "visible",
    deletedAt: null,
    allowsPickup: true,
    allowsDelivery: true,
    sellerApprovalStatus: "approved",
    sellerDeletedAt: null,
  });

  const cartLoadRow = (quantity: number, product: MockProduct) => ({
    productId: 9,
    quantity,
    name: "Tomatoes",
    unit: "kg",
    minOrderQty: product.minOrderQty,
    stockQty: product.stockQty,
    priceCents: 5000,
    sellerId: 7,
    sellerName: "Farm",
    cooperativeId: 1,
    cooperativeName: "Coop",
    allowsPickup: true,
    allowsDelivery: true,
    acceptsOnlinePayment: false,
    primaryImageUrl: null,
    status: "published",
    verificationStatus: "approved",
    visibility: "visible",
    deletedAt: null,
    sellerApprovalStatus: "approved",
    sellerDeletedAt: null,
  });

  function makeThenableChain(getResult: () => unknown) {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "leftJoin", "innerJoin", "where", "limit", "orderBy", "groupBy", "innerJoin"]) {
      chain[method] = () => chain;
    }
    chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(getResult()).then(onFulfilled, onRejected);
    return chain;
  }

  function mockDbForAdd(existingQuantity: number | null, product: MockProduct) {
    const queue: unknown[] = [
      existingQuantity === null ? [] : [{ quantity: existingQuantity }],
      [productRowFor(product)],
      [cartLoadRow(1, product)],
    ];
    mocks.getDb.mockResolvedValue({
      select: () => makeThenableChain(() => queue.shift() ?? []),
      execute: vi.fn(async () => []),
      delete: () => ({ where: async () => undefined }),
    });
  }

  it.each([
    ["100", 100],
    ["25", 25],
    ["2", 2],
  ])("adds a new product with %s stock at quantity 1", async (_label, stockQty) => {
    mockDbForAdd(null, { stockQty, minOrderQty: 1 });
    const result = await buyerCaller().cart.add({ productId: 9 });
    expect(result.quantity).toBe(1);
    expect(result.clamped).toBe(false);
  });

  it("adds a new product at quantity 1 even when minOrderQty is greater than 1", async () => {
    mockDbForAdd(null, { stockQty: 100, minOrderQty: 50 });
    const result = await buyerCaller().cart.add({ productId: 9 });
    expect(result.quantity).toBe(1);
  });

  it("increments an existing cart item by 1 instead of the minimum order quantity", async () => {
    mockDbForAdd(4, { stockQty: 100, minOrderQty: 50 });
    const result = await buyerCaller().cart.add({ productId: 9 });
    expect(result.quantity).toBe(5);
  });

  it("clamps repeated adds at available stock", async () => {
    mockDbForAdd(100, { stockQty: 100, minOrderQty: 1 });
    const result = await buyerCaller().cart.add({ productId: 9 });
    expect(result.quantity).toBe(100);
  });

  it("allows draft cart quantities below the product minimum until checkout", async () => {
    const execute = vi.fn(async () => []);
    let selectPass = 0;
    mocks.getDb.mockResolvedValue({
      select: () => {
        selectPass += 1;
        if (selectPass === 1) {
          return {
            from: () => ({
              leftJoin: () => ({
                where: () => ({
                  limit: async () => [productRowFor({ stockQty: 100, minOrderQty: 50 })],
                }),
              }),
            }),
          };
        }
        return {
          from: () => ({
            innerJoin: () => ({
              innerJoin: () => ({
                leftJoin: () => ({
                  where: async () => [cartLoadRow(5, { stockQty: 100, minOrderQty: 50 })],
                }),
              }),
            }),
          }),
        };
      },
      execute,
      delete: () => ({ where: async () => undefined }),
    });

    const result = await buyerCaller().cart.setQuantity({ productId: 9, quantity: 5 });
    expect(result.quantity).toBe(5);
    expect(result.clamped).toBe(false);
  });

  it("still clamps cart quantities to available stock", async () => {
    const execute = vi.fn(async () => []);
    let selectPass = 0;
    mocks.getDb.mockResolvedValue({
      select: () => {
        selectPass += 1;
        if (selectPass === 1) {
          return {
            from: () => ({
              leftJoin: () => ({
                where: () => ({
                  limit: async () => [productRowFor({ stockQty: 12, minOrderQty: 1 })],
                }),
              }),
            }),
          };
        }
        return {
          from: () => ({
            innerJoin: () => ({
              innerJoin: () => ({
                leftJoin: () => ({
                  where: async () => [cartLoadRow(12, { stockQty: 12, minOrderQty: 1 })],
                }),
              }),
            }),
          }),
        };
      },
      execute,
      delete: () => ({ where: async () => undefined }),
    });

    const result = await buyerCaller().cart.setQuantity({ productId: 9, quantity: 99 });
    expect(result.quantity).toBe(12);
    expect(result.clamped).toBe(true);
  });
});
