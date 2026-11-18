import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  withRequestDatabaseScope: vi.fn((_authUserId: string | null, callback: () => Promise<unknown>) => callback()),
  getMarketplace: vi.fn(async () => []),
  getBuyerOrders: vi.fn(async () => []),
  getSellerOrders: vi.fn(async () => []),
  getSellerProducts: vi.fn(async () => []),
  getOrderDetail: vi.fn(),
  getCooperatives: vi.fn(async () => []),
  getCategories: vi.fn(async () => []),
  storageGetSignedUrl: vi.fn(async () => "https://signed.example/qr.png"),
}));

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return {
    ...actual,
    getDb: mocks.getDb,
    withRequestDatabaseScope: mocks.withRequestDatabaseScope,
    getMarketplace: mocks.getMarketplace,
    getBuyerOrders: mocks.getBuyerOrders,
    getSellerOrders: mocks.getSellerOrders,
    getSellerProducts: mocks.getSellerProducts,
    getOrderDetail: mocks.getOrderDetail,
    getCooperatives: mocks.getCooperatives,
    getCategories: mocks.getCategories,
  };
});

vi.mock("./storage", async () => {
  const actual = await vi.importActual<typeof import("./storage")>("./storage");
  return {
    ...actual,
    storageGetSignedUrl: mocks.storageGetSignedUrl,
  };
});

import { appRouter } from "./routers";

function caller(
  role: "buyer" | "seller" | "admin" | "superadmin" | null,
  id = 50,
  extras: { requestedRole?: "admin" | null } = {},
) {
  return appRouter.createCaller({
    req: { headers: {} },
    res: {},
    user: role
      ? {
          id: role === "admin" ? 30 : role === "superadmin" ? 1 : id,
          openId: "auth-user",
          role,
          requestedRole: extras.requestedRole ?? null,
          approvalStatus: "approved",
          verificationStatus: "approved",
          cooperativeId: role === "admin" ? 2 : null,
          contactNumber: null,
          birthdate: null,
          phone: null,
          address: null,
          profileImageUrl: null,
          name: role,
          email: `${role}@example.test`,
        }
      : null,
    authUserId: role ? "auth-user" : null,
    authResolution: role ? "application_user_resolved" : "anonymous",
  } as TrpcContext);
}

function chain(rows: unknown[]) {
  const result: any = {
    from: () => result,
    where: () => result,
    limit: async () => rows,
    orderBy: () => result,
    leftJoin: () => result,
    innerJoin: () => result,
    for: () => result,
  };
  return {
    select: () => result,
  };
}

describe("tRPC role × procedure access matrix", () => {
  beforeEach(() => {
    mocks.getDb.mockReset().mockResolvedValue(chain([]));
    mocks.getOrderDetail.mockReset();
    mocks.getMarketplace.mockClear();
    mocks.getBuyerOrders.mockClear();
    mocks.getSellerOrders.mockClear();
    mocks.getSellerProducts.mockClear();
  });

  it("lets anon browse marketplace and cooperatives", async () => {
    await expect(caller(null).marketplace.list()).resolves.toEqual([]);
    await expect(caller(null).marketplace.categories()).resolves.toEqual([]);
    await expect(caller(null).cooperatives.list()).resolves.toEqual([]);
    await expect(caller(null).cooperatives.listActive()).resolves.toEqual([]);
  });

  it("blocks anon from order detail and seller payment details", async () => {
    await expect(caller(null).orders.byId({ id: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller(null).sellers.getOnlinePayment({ sellerId: 22 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("scopes buyer and seller order lists", async () => {
    await expect(caller("buyer", 10).orders.buyerMine()).resolves.toEqual([]);
    expect(mocks.getBuyerOrders).toHaveBeenCalledWith(10, { archived: false, deleted: false });
    await expect(caller("seller", 20).orders.sellerMine()).resolves.toEqual([]);
    expect(mocks.getSellerOrders).toHaveBeenCalledWith(20, { archived: false, deleted: false });
    await expect(caller("buyer", 10).orders.sellerMine()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns friendly NOT_FOUND for unauthorized order detail viewers", async () => {
    mocks.getOrderDetail.mockResolvedValue({
      order: { id: 9, buyerId: 10, sellerId: 20, paymentMethod: "f2f" },
      proof: null,
      history: [],
      events: [],
      items: [],
    });
    await expect(caller("buyer", 11).orders.byId({ id: 9 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller("buyer", 10).orders.byId({ id: 9 })).resolves.toMatchObject({ order: { id: 9 } });
    await expect(caller("seller", 20).orders.byId({ id: 9 })).resolves.toMatchObject({ order: { id: 9 } });
    await expect(caller("admin").orders.byId({ id: 9 })).resolves.toMatchObject({ order: { id: 9 } });
    await expect(caller("superadmin").orders.byId({ id: 9 })).resolves.toMatchObject({ order: { id: 9 } });
  });

  it("returns the system online account to buyers and blocks seller payment management", async () => {
    mocks.getDb.mockResolvedValue(chain([{
      id: 1,
      qrImagePath: "system/qr.png",
      accountName: "Coop Treasury",
      accountNumber: "09170001111",
      label: "GCash",
      cashPickupEnabled: true,
      cashDeliveryEnabled: true,
      onlineEnabled: false,
      isActive: true,
      archivedAt: null,
    }]));
    await expect(caller("seller", 50).sellers.getOnlinePayment({ sellerId: 22 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller("seller", 50).sellers.getOnlinePayment())
      .resolves.toMatchObject({ hasQr: false, accountName: null });
    await expect(caller("buyer", 10).sellers.getOnlinePayment({ sellerId: 22 }))
      .resolves.toMatchObject({ accountName: "Coop Treasury", hasQr: true });
    expect(mocks.storageGetSignedUrl).toHaveBeenCalledWith(
      "system/qr.png",
      expect.objectContaining({ bucket: "system-payment-qr" }),
    );
    await expect(caller("seller", 50).sellers.uploadOnlinePaymentQr({
      fileName: "qr.png",
      contentType: "image/png",
      base64: "aGk=",
    })).rejects.toMatchObject({ code: "FORBIDDEN", message: "Online payment is managed by cooperative officers." });
    await expect(caller("seller", 50).sellers.saveOnlinePaymentDetails({ accountName: "Secret" }))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: "Online payment is managed by cooperative officers." });
    await expect(caller("seller", 20).systemPayment.getCheckoutOnlineDetails())
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller("buyer", 10).systemPayment.getCheckoutOnlineDetails())
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(null).systemPayment.getAvailability())
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller("seller", 20).systemPayment.getSettings())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets sellers manage their own listings list", async () => {
    await expect(caller("seller", 20).products.mine()).resolves.toEqual([]);
    expect(mocks.getSellerProducts).toHaveBeenCalledWith(20);
    await expect(caller("buyer", 10).products.mine()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("accepts marketplace.list with nullish input (avoids Zod null crash)", async () => {
    await expect(caller(null).marketplace.list(null)).resolves.toEqual([]);
    await expect(caller(null).marketplace.list(undefined)).resolves.toEqual([]);
  });

  it("keeps pending Cooperative Admin applicants off officer application review", async () => {
    await expect(caller("buyer", 10, { requestedRole: "admin" }).officerApplications.pendingList())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("buyer", 10, { requestedRole: "admin" }).officerApplications.review({
      applicationId: 1,
      decision: "approved",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("buyer", 10).admin.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks Officer Admin from reading application files or approving applications", async () => {
    await expect(caller("admin").officerApplications.pendingList())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("admin").officerApplications.documentUrl({ applicationId: 1, kind: "id" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("admin").officerApplications.review({
      applicationId: 1,
      decision: "approved",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks Admin from creating Officer Admin accounts via admin.createAccount", async () => {
    await expect(caller("admin").admin.createAccount({
      name: "Officer",
      email: "officer@example.test",
      role: "admin",
      cooperativeId: 2,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
