import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { orders, products, users } from "../drizzle/pg-schema";
import { paymentMethodsForFulfillment } from "../shared/paymentMethods";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getOpenOrderReservationQuantities: vi.fn(),
  ensureOrderPaymentRecord: vi.fn(),
  getSystemPaymentAvailability: vi.fn(),
  storageDownloadPrivateProof: vi.fn(),
  storageUpload: vi.fn(),
  withRequestDatabaseScope: vi.fn((_authUserId: string | null, callback: () => Promise<unknown>) => callback()),
}));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getDb: mocks.getDb,
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

vi.mock("./storage", async importOriginal => {
  const actual = await importOriginal<typeof import("./storage")>();
  return {
    ...actual,
    storageDownloadPrivateProof: mocks.storageDownloadPrivateProof,
  };
});

vi.mock("./clients", () => ({
  createPublicAuthClient: () => ({ auth: { resend: vi.fn() } }),
  supabaseAdmin: {
    auth: { admin: { deleteUser: vi.fn(), updateUserById: vi.fn() } },
    storage: { from: () => ({ upload: mocks.storageUpload, remove: vi.fn() }) },
  },
}));

import { appRouter } from "./routers";
import { createCheckoutReceiptUploadIntent } from "./paymentProofs";
import { PAYMENT_PROOF_BUCKET } from "../shared/paymentProofs";

const BUYER_ID = 42;
const SELLER_ID = 9;

const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082",
  "hex",
);

function buyerContext(): TrpcContext {
  return {
    req: { headers: {} },
    res: {},
    user: {
      id: BUYER_ID,
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
    onlinePaymentEnabled: true,
    fulfillmentType: "on_hand",
    primaryImageUrl: null,
    imageUrls: [],
  };
}

const deliveryDetails = {
  recipientName: "Juan Dela Cruz",
  contactNumber: "09171234567",
  province: "Agusan del Norte",
  city: "Cabadbaran",
  barangay: "Poblacion",
  streetAddress: "123 Rizal Street",
};

function checkoutReceiptIntent() {
  return createCheckoutReceiptUploadIntent({
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
    storagePath: `${PAYMENT_PROOF_BUCKET}/${BUYER_ID}/checkout/receipt.png`,
    originalFileName: "receipt.png",
    mimeType: "image/png",
    fileSizeBytes: PNG_BYTES.length,
  });
}

function makeTx(product: ReturnType<typeof purchasableProduct>) {
  const insertedOrders: Array<Record<string, unknown>> = [];
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
  const tx = {
    select: () => ({
      from: (table: unknown) => makeQuery(
        table === users ? [] : table === products ? [product] : [],
      ),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          if (table === orders) insertedOrders.push(values);
          return [{ id: table === orders ? 555 : 777 }];
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(undefined).then(resolve, reject),
      }),
    }),
    update: () => ({
      set: () => ({ where: async () => undefined }),
    }),
    execute: async (query: unknown) => {
      const raw = JSON.stringify(query);
      if (raw.includes("order_create_lock_products")) return [product];
      if (raw.includes("order_create_lock_sellers")) {
        return [{ id: SELLER_ID, approvalStatus: "approved", deletedAt: null }];
      }
      return [];
    },
    transaction: async (work: (transaction: unknown) => unknown) => work(tx),
  };
  return { tx, insertedOrders };
}

function mockDatabase(product: ReturnType<typeof purchasableProduct>) {
  const { tx, insertedOrders } = makeTx(product);
  mocks.getDb.mockResolvedValue(tx);
  return { insertedOrders };
}

describe("paymentMethodsForFulfillment", () => {
  it("keeps online for both fulfillment methods and binds cash methods to their fulfillment", () => {
    expect(paymentMethodsForFulfillment(["cash_pickup", "cash_delivery", "online"], "pickup"))
      .toEqual(["cash_pickup", "online"]);
    expect(paymentMethodsForFulfillment(["cash_pickup", "cash_delivery", "online"], "delivery"))
      .toEqual(["cash_delivery", "online"]);
  });
});

describe("orders.create fulfillment/payment separation", () => {
  beforeAll(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-secret";
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOpenOrderReservationQuantities.mockResolvedValue(new Map());
    mocks.ensureOrderPaymentRecord.mockResolvedValue(undefined);
    mocks.storageDownloadPrivateProof.mockResolvedValue(PNG_BYTES);
    mocks.storageUpload.mockResolvedValue({ error: null });
    mocks.getSystemPaymentAvailability.mockResolvedValue({
      cashPickupEnabled: true,
      cashDeliveryEnabled: true,
      onlineEnabled: true,
      onlineAccountReady: true,
    });
  });

  const caller = () => appRouter.createCaller(buyerContext());
  const product = { ...purchasableProduct(7, SELLER_ID), stockQty: 100 };

  it("accepts Cash on Pickup with pickup fulfillment and no delivery details", async () => {
    const { insertedOrders } = mockDatabase(product);
    await expect(caller().orders.create({
      items: [{ productId: 7, quantity: 2 }],
      paymentMethod: "cash_pickup",
      fulfillmentMethod: "pickup",
    })).resolves.toMatchObject({ success: true });
    expect(insertedOrders[0]).toMatchObject({
      paymentMethod: "cash_pickup",
      fulfillmentMethod: "pickup",
      deliveryDetails: null,
      paymentStatus: "pending",
    });
  });

  it("accepts Cash on Delivery with delivery fulfillment and a complete address", async () => {
    const { insertedOrders } = mockDatabase(product);
    await expect(caller().orders.create({
      items: [{ productId: 7, quantity: 20 }],
      paymentMethod: "cash_delivery",
      fulfillmentMethod: "delivery",
      deliveryDetails,
    })).resolves.toMatchObject({ success: true });
    expect(insertedOrders[0]).toMatchObject({
      paymentMethod: "cash_delivery",
      fulfillmentMethod: "delivery",
      deliveryDetails: expect.objectContaining({ city: "Cabadbaran" }),
    });
  });

  it("accepts Online Payment + Pickup with a verified receipt", async () => {
    const { insertedOrders } = mockDatabase(product);
    await expect(caller().orders.create({
      items: [{ productId: 7, quantity: 2 }],
      paymentMethod: "online",
      fulfillmentMethod: "pickup",
      receiptUploadIntent: checkoutReceiptIntent(),
    })).resolves.toMatchObject({ success: true });
    expect(insertedOrders[0]).toMatchObject({
      paymentMethod: "online",
      fulfillmentMethod: "pickup",
      deliveryDetails: null,
      paymentStatus: "awaiting_verification",
    });
  });

  it("accepts Online Payment + Delivery, persisting fulfillment and the delivery address", async () => {
    const { insertedOrders } = mockDatabase(product);
    await expect(caller().orders.create({
      items: [{ productId: 7, quantity: 20 }],
      paymentMethod: "online",
      fulfillmentMethod: "delivery",
      deliveryDetails,
      receiptUploadIntent: checkoutReceiptIntent(),
    })).resolves.toMatchObject({ success: true });
    expect(insertedOrders[0]).toMatchObject({
      paymentMethod: "online",
      fulfillmentMethod: "delivery",
      deliveryDetails: expect.objectContaining({ recipientName: "Juan Dela Cruz" }),
      paymentStatus: "awaiting_verification",
    });
  });

  it("rejects blank, whitespace-only, and incomplete delivery addresses for cash and online", async () => {
    mockDatabase(product);
    const blankAddress = {
      ...deliveryDetails,
      recipientName: "   ",
      contactNumber: "",
      province: " ",
      city: "",
      barangay: "   ",
      streetAddress: "     ",
    };
    for (const method of ["cash_delivery", "online"] as const) {
      await expect(caller().orders.create({
        items: [{ productId: 7, quantity: 20 }],
        paymentMethod: method,
        fulfillmentMethod: "delivery",
        deliveryDetails: blankAddress,
        ...(method === "online" ? { receiptUploadIntent: checkoutReceiptIntent() } : {}),
      })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    for (const field of ["recipientName", "contactNumber", "province", "city", "barangay", "streetAddress"] as const) {
      const { [field]: _omitted, ...rest } = deliveryDetails;
      void _omitted;
      await expect(caller().orders.create({
        items: [{ productId: 7, quantity: 2 }],
        paymentMethod: "cash_delivery",
        fulfillmentMethod: "delivery",
        deliveryDetails: rest,
      })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("rejects online payment without an explicit fulfillment selection", async () => {
    await expect(caller().orders.create({
      items: [{ productId: 7, quantity: 2 }],
      paymentMethod: "online",
      receiptUploadIntent: checkoutReceiptIntent(),
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects delivery fulfillment without delivery details for both cash and online", async () => {
    await expect(caller().orders.create({
      items: [{ productId: 7, quantity: 2 }],
      paymentMethod: "cash_delivery",
      fulfillmentMethod: "delivery",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().orders.create({
      items: [{ productId: 7, quantity: 2 }],
      paymentMethod: "online",
      fulfillmentMethod: "delivery",
      receiptUploadIntent: checkoutReceiptIntent(),
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects incompatible payment/fulfillment combinations", async () => {
    mockDatabase(product);
    await expect(caller().orders.create({
      items: [{ productId: 7, quantity: 2 }],
      paymentMethod: "cash_pickup",
      fulfillmentMethod: "delivery",
      deliveryDetails,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().orders.create({
      items: [{ productId: 7, quantity: 2 }],
      paymentMethod: "cash_delivery",
      fulfillmentMethod: "pickup",
      deliveryDetails,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects online payment when no active payment account is configured", async () => {
    mocks.getSystemPaymentAvailability.mockResolvedValue({
      cashPickupEnabled: true,
      cashDeliveryEnabled: true,
      onlineEnabled: true,
      onlineAccountReady: false,
    });
    mockDatabase(product);
    await expect(caller().orders.create({
      items: [{ productId: 7, quantity: 2 }],
      paymentMethod: "online",
      fulfillmentMethod: "pickup",
      receiptUploadIntent: checkoutReceiptIntent(),
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects online payment without a receipt upload intent", async () => {
    mockDatabase(product);
    await expect(caller().orders.create({
      items: [{ productId: 7, quantity: 2 }],
      paymentMethod: "online",
      fulfillmentMethod: "pickup",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects delivery orders below the 20 kg minimum for cash and online", async () => {
    mockDatabase(product);
    for (const quantity of [2, 10, 19]) {
      await expect(caller().orders.create({
        items: [{ productId: 7, quantity }],
        paymentMethod: "cash_delivery",
        fulfillmentMethod: "delivery",
        deliveryDetails,
      })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(caller().orders.create({
      items: [{ productId: 7, quantity: 19 }],
      paymentMethod: "online",
      fulfillmentMethod: "delivery",
      deliveryDetails,
      receiptUploadIntent: checkoutReceiptIntent(),
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("allows pickup below 20 kg while rejecting the same cart for delivery", async () => {
    mockDatabase(product);
    await expect(caller().orders.create({
      items: [{ productId: 7, quantity: 5 }],
      paymentMethod: "cash_pickup",
      fulfillmentMethod: "pickup",
    })).resolves.toMatchObject({ success: true });
    await expect(caller().orders.create({
      items: [{ productId: 7, quantity: 5 }],
      paymentMethod: "cash_delivery",
      fulfillmentMethod: "delivery",
      deliveryDetails,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects delivery when a product's weight cannot be determined", async () => {
    const pieceProduct = { ...purchasableProduct(8, SELLER_ID), unit: "piece" };
    mockDatabase(pieceProduct);
    await expect(caller().orders.create({
      items: [{ productId: 8, quantity: 100 }],
      paymentMethod: "cash_delivery",
      fulfillmentMethod: "delivery",
      deliveryDetails,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("ignores client-submitted weight hints when enforcing the delivery minimum", async () => {
    mockDatabase(product);
    await expect(caller().orders.create({
      items: [{ productId: 7, quantity: 19 }],
      paymentMethod: "cash_delivery",
      fulfillmentMethod: "delivery",
      deliveryDetails,
      // @ts-expect-error intentionally forged field — must not bypass validation
      totalWeightGrams: 99_999_999,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
