import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  withRequestDatabaseScope: vi.fn((_authUserId: string | null, callback: () => Promise<unknown>) => callback()),
  storagePut: vi.fn(),
  storageCreateSignedUploadUrl: vi.fn(),
  storageDownloadPrivateProof: vi.fn(),
  storageDeletePublicUrl: vi.fn(),
  storageDeleteObject: vi.fn(),
  storageGet: vi.fn(),
  storageGetSignedUrl: vi.fn(),
}));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getDb: mocks.getDb,
    withRequestDatabaseScope: mocks.withRequestDatabaseScope,
  };
});

vi.mock("./storage", async importOriginal => {
  const actual = await importOriginal<typeof import("./storage")>();
  return {
    ...actual,
    storagePut: mocks.storagePut,
    storageCreateSignedUploadUrl: mocks.storageCreateSignedUploadUrl,
    storageDownloadPrivateProof: mocks.storageDownloadPrivateProof,
    storageDeletePublicUrl: mocks.storageDeletePublicUrl,
    storageDeleteObject: mocks.storageDeleteObject,
    storageGet: mocks.storageGet,
    storageGetSignedUrl: mocks.storageGetSignedUrl,
  };
});

import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

function createDb(
  selectResults: unknown[][],
  deleteResults: unknown[] = [{ id: 4 }],
  updateResults: unknown[][] = [],
) {
  const conditions: Array<{ sql: string; params: unknown[] }> = [];
  const updateSets: unknown[] = [];
  const dialect = new PgDialect();
  let selectIndex = 0;
  let updateIndex = 0;
  const db = {
    select: vi.fn(() => {
      const result = selectResults[selectIndex++] ?? [];
      const builder = {
        from: () => builder,
        innerJoin: () => builder,
        where: (condition: SQL) => {
          const query = dialect.sqlToQuery(condition);
          conditions.push({ sql: query.sql, params: query.params });
          return builder;
        },
        orderBy: () => builder,
        limit: () => builder,
        for: () => builder,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject),
      };
      return builder;
    }),
    delete: vi.fn(() => ({
      where: (condition: SQL) => {
        const query = dialect.sqlToQuery(condition);
        conditions.push({ sql: query.sql, params: query.params });
        return { returning: async () => deleteResults };
      },
    })),
    transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db)),
    execute: vi.fn(async () => undefined),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: async () => [{ id: 1 }],
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => {
        updateSets.push(values);
        return {
        where: (condition: SQL) => {
          const query = dialect.sqlToQuery(condition);
          conditions.push({ sql: query.sql, params: query.params });
          return {
            returning: async () => updateResults[updateIndex++] ?? [{ id: 1 }],
          };
        },
        };
      }),
    })),
  };
  return { db, conditions, updateSets };
}

function caller(role: "buyer" | "seller" | "admin" | "superadmin", cooperativeId: number | null) {
  return appRouter.createCaller({
    req: { headers: {} },
    res: {},
    user: {
      id: role === "admin" ? 30 : role === "superadmin" ? 1 : 50,
      openId: "verified-auth-id",
      email: "officer@example.test",
      name: "Officer",
      loginMethod: "supabase",
      role,
      approvalStatus: "approved",
      verificationStatus: "approved",
      cooperativeId,
      contactNumber: null,
      address: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      lastSignedIn: new Date("2026-01-01T00:00:00Z"),
    },
    authUserId: "verified-auth-id",
    authResolution: "application_user_resolved",
  } as TrpcContext);
}

const qrUpload = {
  fileName: "qr.png",
  contentType: "image/png" as const,
  base64: "iVBORw0KGgo=",
};

describe("admin payment option router authorization", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.example.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
    mocks.getDb.mockReset();
    mocks.withRequestDatabaseScope.mockClear();
    mocks.storagePut.mockReset().mockResolvedValue({ key: "qr.png", url: "https://storage.example.test/qr.png" });
    mocks.storageCreateSignedUploadUrl.mockReset().mockImplementation(async path => ({ path, token: "signed-upload-token" }));
    mocks.storageDownloadPrivateProof.mockReset().mockResolvedValue(Buffer.from("iVBORw0KGgo=", "base64"));
    mocks.storageDeletePublicUrl.mockReset().mockResolvedValue(true);
    mocks.storageDeleteObject.mockReset().mockResolvedValue(true);
    mocks.storageGet.mockReset().mockImplementation(async path => ({
      key: path,
      url: "https://storage.example.test/storage/v1/object/public/product-images/qr.png",
    }));
    mocks.storageGetSignedUrl.mockReset().mockResolvedValue("https://storage.example.test/signed-proof");
  });

  it("allows Admin upload but forces the assigned cooperative's QR prefix", async () => {
    const { db } = createDb([[{ id: 12 }]]);
    mocks.getDb.mockResolvedValue(db);

    await caller("admin", 12).adminPayment.uploadQrImage({
      ...qrUpload,
      cooperativeId: 99,
    });

    expect(mocks.storagePut).toHaveBeenCalledWith(
      expect.stringMatching(/^payment-options\/cooperative-12\/30\//),
      expect.any(Buffer),
      "image/png",
    );
  });

  it("rejects SuperAdmin payment-option management (OfficerAdmin-only policy)", async () => {
    const { db } = createDb([]);
    mocks.getDb.mockResolvedValue(db);

    await expect(caller("superadmin", null).adminPayment.uploadQrImage(qrUpload))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("returns active options only when the submitted basket belongs to the requested cooperative", async () => {
    const option = {
      id: 8,
      cooperativeId: 12,
      methodName: "GCash",
      accountName: "AgriCoop",
      accountNumber: "123",
      qrImagePath: "payment-options/cooperative-12/qr.png",
      instructions: null,
    };
    const { db } = createDb([
      [{
        id: 7,
        cooperativeId: 12,
        status: "published",
        verificationStatus: "approved",
        visibility: "visible",
        sellerApprovalStatus: "approved",
      }],
      [option],
    ]);
    mocks.storageGet.mockResolvedValueOnce({
      key: "qr.png",
      url: "https://storage.example.test/qr.png",
    });
    mocks.getDb.mockResolvedValue(db);

    await expect(caller("buyer", null).adminPayment.checkoutOptions({
      cooperativeId: 12,
      productIds: [7],
    })).resolves.toEqual([{
      id: 8,
      cooperativeId: 12,
      methodName: "GCash",
      accountName: "AgriCoop",
      accountNumber: "123",
      instructions: null,
      qrImageUrl: "https://storage.example.test/qr.png",
    }]);
  });

  it("rejects a basket from another cooperative before returning payment details", async () => {
    const { db } = createDb([[
      {
        id: 7,
        cooperativeId: 99,
        status: "published",
        verificationStatus: "approved",
        visibility: "visible",
        sellerApprovalStatus: "approved",
      },
    ]]);
    mocks.getDb.mockResolvedValue(db);

    await expect(caller("buyer", null).adminPayment.checkoutOptions({
      cooperativeId: 12,
      productIds: [7],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("issues a scoped upload authorization, then persists a verified private proof", async () => {
    const uploadDb = createDb([
      [{ id: 9, buyerId: 50, sellerId: 20, cooperativeId: 12, paymentMethod: "gcash", paymentStatus: "pending", status: "submitted", totalCents: 500 }],
      [],
      [{ id: 90, buyerId: 50, sellerId: 20, amountCents: 500, paymentMethod: "gcash", status: "payment_coordinated" }],
    ]);
    const { db, updateSets } = createDb([
      [{ id: 9, buyerId: 50, sellerId: 20, cooperativeId: 12, paymentMethod: "gcash", paymentStatus: "pending", status: "submitted", totalCents: 500 }],
      [],
      [{ id: 90, buyerId: 50, sellerId: 20, amountCents: 500, paymentMethod: "gcash", status: "pending" }],
      [{ nextId: 1 }],
    ]);
    mocks.getDb.mockResolvedValueOnce(uploadDb.db).mockResolvedValueOnce(db);

    const authorization = await caller("buyer", null).payments.uploadProof({
      orderId: 9,
      fileName: "receipt.png",
      contentType: "image/png",
      fileSizeBytes: 8,
    });

    expect(authorization).toMatchObject({
      success: true,
      storagePath: expect.stringMatching(/^payment-proofs\/50\/9\//),
      uploadToken: "signed-upload-token",
      uploadIntent: expect.any(String),
    });
    expect(mocks.storageCreateSignedUploadUrl).toHaveBeenCalledWith(authorization.storagePath);

    await expect(caller("buyer", null).payments.finalizeProofUpload({
      orderId: 9,
      uploadIntent: authorization.uploadIntent,
    })).resolves.toEqual({ success: true, proofId: 1 });
    expect(mocks.storageDownloadPrivateProof).toHaveBeenCalledWith(authorization.storagePath);
    expect(updateSets).toEqual(expect.arrayContaining([
      { status: "pending" },
      { paymentStatus: "awaiting_verification" },
    ]));
    expect(mocks.storageDeleteObject).not.toHaveBeenCalled();
  });

  it("rejects uploads for another buyer's payment and invalid file metadata", async () => {
    const { db } = createDb([[]]);
    mocks.getDb.mockResolvedValue(db);
    await expect(caller("buyer", null).payments.uploadProof({
      orderId: 9,
      fileName: "receipt.png",
      contentType: "image/png",
      fileSizeBytes: 8,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.storageCreateSignedUploadUrl).not.toHaveBeenCalled();

    await expect(caller("buyer", null).payments.uploadProof({
      orderId: 9,
      fileName: "receipt.gif",
      contentType: "image/gif" as "image/png",
      fileSizeBytes: 8,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.getDb).toHaveBeenCalledTimes(1);

    await expect(caller("buyer", null).payments.uploadProof({
      orderId: 9,
      fileName: "receipt.png",
      contentType: "image/png",
      fileSizeBytes: 5 * 1024 * 1024 + 1,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("does not issue an upload capability when the order has no existing transaction", async () => {
    const { db } = createDb([
      [{ id: 9, buyerId: 50, sellerId: 20, cooperativeId: 12, paymentMethod: "gcash", paymentStatus: "pending", status: "submitted", totalCents: 500 }],
      [],
      [],
    ]);
    mocks.getDb.mockResolvedValue(db);

    await expect(caller("buyer", null).payments.uploadProof({
      orderId: 9,
      fileName: "receipt.png",
      contentType: "image/png",
      fileSizeBytes: 8,
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.storageCreateSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects an uploaded object whose byte signature or actual size does not match its signed metadata", async () => {
    const uploadDb = createDb([
      [{ id: 9, buyerId: 50, sellerId: 20, cooperativeId: 12, paymentMethod: "gcash", paymentStatus: "pending", status: "submitted", totalCents: 500 }],
      [],
      [{ id: 90, buyerId: 50, sellerId: 20, amountCents: 500, paymentMethod: "gcash", status: "payment_coordinated" }],
    ]);
    mocks.getDb.mockResolvedValue(uploadDb.db);
    const authorization = await caller("buyer", null).payments.uploadProof({
      orderId: 9,
      fileName: "receipt.png",
      contentType: "image/png",
      fileSizeBytes: 8,
    });

    mocks.storageDownloadPrivateProof.mockResolvedValueOnce(Buffer.from("not image"));
    await expect(caller("buyer", null).payments.finalizeProofUpload({
      orderId: 9,
      uploadIntent: authorization.uploadIntent,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.storageDeleteObject).toHaveBeenCalledWith(
      authorization.storagePath,
      "payment-proofs/50/9/",
      { bucket: "payment-proofs", public: false },
    );
    expect(mocks.getDb).toHaveBeenCalledTimes(1);

    mocks.storageDownloadPrivateProof.mockResolvedValueOnce(Buffer.from("iVBORw0KGgo=", "base64").subarray(0, 7));
    await expect(caller("buyer", null).payments.finalizeProofUpload({
      orderId: 9,
      uploadIntent: authorization.uploadIntent,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("prevents Admin proof review across cooperatives but allows SuperAdmin review", async () => {
    const payment = {
      proof: { id: 4, orderId: 14, storagePath: "payment-proofs/50/14/receipt.png", verificationStatus: "pending", uploadedBy: 50 },
      order: { id: 14, buyerId: 50, sellerId: 20, cooperativeId: 99, status: "confirmed", paymentStatus: "pending", paymentMethod: "gcash", totalCents: 500 },
    };
    const adminDb = createDb([[payment]]);
    mocks.getDb.mockResolvedValueOnce(adminDb.db);
    await expect(caller("admin", 12).payments.reviewQueue()).resolves.toEqual({ proofs: [], cashAwaitingReceived: [] });
    expect(adminDb.db.select).toHaveBeenCalledTimes(2);
    expect(mocks.storageGetSignedUrl).not.toHaveBeenCalled();

    const proofKey = "payment-proofs/50/14/receipt.png";
    const superAdminDb = createDb([
      [payment],
      [{ id: 90, orderId: 14, buyerId: 50, sellerId: 20, amountCents: 500, paymentMethod: "gcash", status: "pending" }],
    ]);
    mocks.getDb.mockResolvedValueOnce(superAdminDb.db);
    await expect(caller("superadmin", null).payments.reviewQueue())
      .resolves.toMatchObject({ proofs: [{ proof: { id: 4 }, evidenceUrl: "https://storage.example.test/signed-proof" }] });
    expect(mocks.storageGetSignedUrl).toHaveBeenCalledWith(
      proofKey,
      { bucket: "payment-proofs", public: false, expiresIn: 300 },
    );
  });

  it("does not allow a Seller to verify another seller's payment proof", async () => {
    const proof = {
      id: 4,
      orderId: 14,
      transactionId: 90,
      uploadedBy: 50,
      storagePath: "payment-proofs/50/14/receipt.png",
      verificationStatus: "pending",
    };
    const order = {
      id: 14,
      buyerId: 50,
      sellerId: 20,
      cooperativeId: 99,
      status: "confirmed",
      paymentStatus: "awaiting_verification",
      paymentMethod: "gcash",
      totalCents: 500,
    };
    const db = createDb([
      [{ orderId: 14 }],
      [order],
      [proof],
      [{ id: 90, orderId: 14, buyerId: 50, sellerId: 20, amountCents: 500, paymentMethod: "gcash", status: "pending" }],
    ]);
    mocks.getDb.mockResolvedValueOnce(db.db);
    await expect(caller("seller", 12).payments.reviewProof({ proofId: 4, decision: "verified" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows SuperAdmin review across cooperatives and updates proof, order, and transaction atomically", async () => {
    const proof = {
      id: 4,
      orderId: 14,
      transactionId: 90,
      uploadedBy: 50,
      storagePath: "payment-proofs/50/14/receipt.png",
      verificationStatus: "pending",
    };
    const order = {
      id: 14,
      buyerId: 50,
      sellerId: 20,
      cooperativeId: 99,
      status: "confirmed",
      paymentStatus: "awaiting_verification",
      paymentMethod: "gcash",
      totalCents: 500,
    };
    const transaction = {
      id: 90,
      orderId: 14,
      buyerId: 50,
      sellerId: 20,
      amountCents: 500,
      paymentMethod: "gcash",
      status: "pending",
    };
    const { db, updateSets, conditions } = createDb([
      [{ orderId: 14 }],
      [order],
      [proof],
      [transaction],
    ]);
    mocks.getDb.mockResolvedValue(db);

    await expect(caller("superadmin", null).payments.reviewProof({
      proofId: 4,
      decision: "verified",
    })).resolves.toEqual({ success: true });

    expect(updateSets).toEqual(expect.arrayContaining([
      expect.objectContaining({ verificationStatus: "verified", reviewedBy: 1 }),
      { paymentStatus: "paid" },
      { status: "paid" },
    ]));
    expect(conditions.some(condition => condition.params.includes("awaiting_verification"))).toBe(true);
  });

  it("blocks Admin review across cooperatives and duplicate or cancelled-order reviews", async () => {
    const proof = {
      id: 4,
      orderId: 14,
      transactionId: 90,
      uploadedBy: 50,
      storagePath: "payment-proofs/50/14/receipt.png",
      verificationStatus: "pending",
    };
    const otherCooperativeOrder = {
      id: 14,
      buyerId: 50,
      sellerId: 20,
      cooperativeId: 99,
      status: "confirmed",
      paymentStatus: "pending",
      paymentMethod: "gcash",
      totalCents: 500,
    };
    const transaction = {
      id: 90,
      orderId: 14,
      buyerId: 50,
      sellerId: 20,
      amountCents: 500,
      paymentMethod: "gcash",
      status: "pending",
    };
    const adminDb = createDb([[{ orderId: 14 }], [otherCooperativeOrder], [proof], [transaction]]);
    mocks.getDb.mockResolvedValueOnce(adminDb.db);
    await expect(caller("admin", 12).payments.reviewProof({
      proofId: 4,
      decision: "verified",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(adminDb.db.update).not.toHaveBeenCalled();

    const duplicateDb = createDb([
      [{ orderId: 14 }],
      [{ ...otherCooperativeOrder, cooperativeId: 12 }],
      [{ ...proof, verificationStatus: "verified" }],
      [transaction],
    ]);
    mocks.getDb.mockResolvedValueOnce(duplicateDb.db);
    await expect(caller("admin", 12).payments.reviewProof({
      proofId: 4,
      decision: "verified",
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(duplicateDb.db.update).not.toHaveBeenCalled();

    const cancelledDb = createDb([
      [{ orderId: 14 }],
      [{ ...otherCooperativeOrder, cooperativeId: 12, status: "cancelled" }],
      [proof],
      [transaction],
    ]);
    mocks.getDb.mockResolvedValueOnce(cancelledDb.db);
    await expect(caller("admin", 12).payments.reviewProof({
      proofId: 4,
      decision: "verified",
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(cancelledDb.db.update).not.toHaveBeenCalled();
  });

  it("restricts Admin deletion queries to the assigned cooperative", async () => {
    const { db, conditions } = createDb([
      [{ cooperativeId: 12, qrImagePath: "payment-options/cooperative-12/qr.png" }],
      [],
    ]);
    mocks.getDb.mockResolvedValue(db);

    await expect(caller("admin", 12).adminPayment.deleteOption({ id: 4 }))
      .resolves.toMatchObject({ success: true });

    expect(conditions[0].params).toEqual([4, 12]);
    expect(conditions[2].params).toEqual([4, 12]);
    expect(mocks.storageDeleteObject).toHaveBeenCalledWith(
      "payment-options/cooperative-12/qr.png",
      "payment-options/cooperative-12/",
    );
  });

  it("returns not found for an Admin targeting another cooperative's option", async () => {
    const { db, conditions } = createDb([[]]);
    mocks.getDb.mockResolvedValue(db);

    await expect(caller("admin", 12).adminPayment.deleteOption({ id: 4 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(conditions[0].params).toEqual([4, 12]);
    expect(db.delete).not.toHaveBeenCalled();
    expect(mocks.storageDeleteObject).not.toHaveBeenCalled();
  });

  it("rejects SuperAdmin deletion (OfficerAdmin-only policy)", async () => {
    const { db } = createDb([]);
    mocks.getDb.mockResolvedValue(db);

    await expect(caller("superadmin", null).adminPayment.deleteOption({ id: 4 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.delete).not.toHaveBeenCalled();
    expect(mocks.storageDeleteObject).not.toHaveBeenCalled();
  });
});
