import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { cartItems, orders, products, quotations, users } from "../drizzle/pg-schema";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getMarketplace: vi.fn(),
  getOpenOrderReservationQuantities: vi.fn(),
  ensureOrderPaymentRecord: vi.fn(),
  getSystemPaymentAvailability: vi.fn(),
  withRequestDatabaseScope: vi.fn((_authUserId: string | null, callback: () => Promise<unknown>) => callback()),
}));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getDb: mocks.getDb,
    getMarketplace: mocks.getMarketplace,
    getOpenOrderReservationQuantities: mocks.getOpenOrderReservationQuantities,
    ensureOrderPaymentRecord: mocks.ensureOrderPaymentRecord,
    withRequestDatabaseScope: mocks.withRequestDatabaseScope,
  };
});

vi.mock("./systemPayment", async importOriginal => {
  const actual = await importOriginal<typeof import("./systemPayment")>();
  return {
    ...actual,
    getSystemPaymentAvailability: mocks.getSystemPaymentAvailability,
  };
});

import { appRouter } from "./routers";

function buyerContext(): TrpcContext {
  return {
    req: { headers: {} },
    res: {},
    user: {
      id: 42,
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
  } as TrpcContext;
}

function purchasableProduct(id: number, sellerId: number) {
  return {
    id,
    sellerId,
    cooperativeId: 1,
    name: `Product ${id}`,
    unit: "kg",
    stockQty: 12,
    minOrderQty: 2,
    priceCents: 500,
    status: "published",
    verificationStatus: "approved",
    visibility: "visible",
    deletedAt: null,
    allowsPickup: true,
    allowsDelivery: true,
    acceptsOnlinePayment: false,
    primaryImageUrl: null,
    imageUrls: [],
  };
}

describe("marketplace purchasability invariant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows every marketplace result through cart add, checkout, and quotation request", async () => {
    const productsForSale = [purchasableProduct(7, 9), purchasableProduct(8, 10)];
    const listings = productsForSale.map(product => ({
      sellerName: `Seller ${product.sellerId}`,
      cooperativeName: "Cooperative",
      onlinePaymentAvailable: false,
      sellerHasOnlineQr: false,
      product,
    }));
    mocks.getMarketplace.mockResolvedValue(listings);
    mocks.getOpenOrderReservationQuantities.mockResolvedValue(new Map());
    mocks.ensureOrderPaymentRecord.mockResolvedValue(undefined);
    mocks.getSystemPaymentAvailability.mockResolvedValue({
      cashPickupEnabled: true,
      cashDeliveryEnabled: true,
      onlineEnabled: false,
      onlineAccountReady: false,
    });

    let activeProduct = productsForSale[0]!;
    let nextOrderId = 100;
    let nextQuotationId = 200;
    const cartRow = () => ({
      productId: activeProduct.id,
      quantity: activeProduct.minOrderQty,
      name: activeProduct.name,
      unit: activeProduct.unit,
      minOrderQty: activeProduct.minOrderQty,
      stockQty: activeProduct.stockQty,
      priceCents: activeProduct.priceCents,
      sellerId: activeProduct.sellerId,
      sellerName: `Seller ${activeProduct.sellerId}`,
      cooperativeId: activeProduct.cooperativeId,
      cooperativeName: "Cooperative",
      allowsPickup: activeProduct.allowsPickup,
      allowsDelivery: activeProduct.allowsDelivery,
      acceptsOnlinePayment: false,
      primaryImageUrl: null,
      status: activeProduct.status,
      verificationStatus: activeProduct.verificationStatus,
      visibility: activeProduct.visibility,
      deletedAt: null,
      sellerApprovalStatus: "approved",
      sellerDeletedAt: null,
    });

    const makeQuery = (rows: unknown[]) => {
      const query: Record<string, unknown> = {
        where: () => query,
        innerJoin: () => query,
        leftJoin: () => query,
        orderBy: () => query,
        for: () => query,
        limit: async () => rows,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(rows).then(resolve, reject),
      };
      return query;
    };

    const selectRows = (selection: Record<string, unknown> | undefined, table: unknown) => {
      if (table === cartItems) {
        return selection && "quantity" in selection ? [] : [cartRow()];
      }
      if (table === products) {
        if (selection && "sellerApprovalStatus" in selection) {
          return [{ ...activeProduct, sellerApprovalStatus: "approved", sellerDeletedAt: null }];
        }
        if (selection && "minOrderQty" in selection && Object.keys(selection).length === 2) {
          return [{ minOrderQty: activeProduct.minOrderQty, stockQty: activeProduct.stockQty }];
        }
        return [activeProduct];
      }
      if (table === users) {
        return selection && "approvalStatus" in selection
          ? [{ id: activeProduct.sellerId, approvalStatus: "approved", deletedAt: null }]
          : [];
      }
      return [];
    };

    const executedSql: string[] = [];
    const tx = {
      select: (selection?: Record<string, unknown>) => ({
        from: (table: unknown) => makeQuery(selectRows(selection, table)),
      }),
      insert: (table: unknown) => ({
        values: (_values: unknown) => ({
          returning: async () => [{
            id: table === orders ? nextOrderId++ : table === quotations ? nextQuotationId++ : 300,
          }],
        }),
      }),
      execute: async (query: unknown) => {
        const raw = JSON.stringify(query);
        executedSql.push(raw);
        if (raw.includes("order_create_lock_products")) return [activeProduct];
        if (raw.includes("order_create_lock_sellers")) {
          return [{ id: activeProduct.sellerId, approvalStatus: "approved", deletedAt: null }];
        }
        return [];
      },
      transaction: async (work: (transaction: unknown) => unknown) => work(tx),
    };
    mocks.getDb.mockResolvedValue(tx);

    const caller = appRouter.createCaller(buyerContext());
    const marketplaceResults = await caller.marketplace.list();
    expect(marketplaceResults).toHaveLength(productsForSale.length);

    for (const listing of marketplaceResults) {
      activeProduct = listing.product as typeof activeProduct;
      const qty = activeProduct.minOrderQty;

      await expect(caller.cart.add({ productId: activeProduct.id })).resolves.toMatchObject({
        quantity: qty,
        stockQty: activeProduct.stockQty,
      });
      await expect(caller.orders.create({
        items: [{ productId: activeProduct.id, quantity: qty }],
        paymentMethod: "cash_pickup",
      })).resolves.toMatchObject({ success: true });
      await expect(caller.quotations.request({
        productId: activeProduct.id,
        requestedQty: qty,
      })).resolves.toMatchObject({ success: true });
    }

    expect(mocks.getMarketplace).toHaveBeenCalledOnce();
    expect(mocks.getOpenOrderReservationQuantities).toHaveBeenCalled();
    expect(executedSql.some(sql => sql.includes("agricoop.order_create_scope"))).toBe(true);
    expect(executedSql.some(sql => sql.includes("order_create_lock_products"))).toBe(true);
    expect(executedSql.some(sql => sql.includes("order_create_lock_sellers"))).toBe(true);
  });
});
