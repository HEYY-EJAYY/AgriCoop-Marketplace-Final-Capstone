import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  withRequestDatabaseScope: vi.fn((_authUserId: string | null, callback: () => Promise<unknown>) => callback()),
  storageCreateSignedUploadUrl: vi.fn(),
  storageDownloadPrivateObject: vi.fn(),
  storageDeleteObject: vi.fn(),
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
    storageCreateSignedUploadUrl: mocks.storageCreateSignedUploadUrl,
    storageDownloadPrivateObject: mocks.storageDownloadPrivateObject,
    storageDeleteObject: mocks.storageDeleteObject,
    storageGetSignedUrl: mocks.storageGetSignedUrl,
  };
});

import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";
import { PROFILE_VERIFICATION_BUCKET } from "../shared/profileVerification";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const applicantRow = {
  id: 50,
  cooperativeId: 12,
  verificationStatus: "unverified",
};

function createDb(selectResults: unknown[][], updateResults: unknown[][] = []) {
  const conditions: Array<{ sql: string; params: unknown[] }> = [];
  const insertedValues: unknown[] = [];
  const updateSets: unknown[] = [];
  const dialect = new PgDialect();
  let selectIndex = 0;
  let updateIndex = 0;
  const db = {
    execute: vi.fn(async (query: SQL) => {
      const rendered = dialect.sqlToQuery(query);
      if (rendered.sql.includes("create_notification")) {
        insertedValues.push({
          userId: rendered.params[0],
          type: rendered.params[1],
          title: rendered.params[2],
          content: rendered.params[3],
          link: rendered.params[4],
          relatedEntityId: rendered.params[5],
          relatedEntityType: rendered.params[6],
        });
      }
      return [];
    }),
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
    insert: vi.fn(() => ({
      values: (values: unknown) => {
        insertedValues.push(values);
        return { returning: async () => [{ id: 44 }] };
      },
    })),
    update: vi.fn(() => ({
      set: (values: unknown) => {
        updateSets.push(values);
        return {
          where: (condition: SQL) => {
            const query = dialect.sqlToQuery(condition);
            conditions.push({ sql: query.sql, params: query.params });
            return { returning: async () => updateResults[updateIndex++] ?? [{ id: 50 }] };
          },
        };
      },
    })),
    transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db)),
  };
  return { db, conditions, insertedValues, updateSets, dialect };
}

function caller(role: "buyer" | "seller" | "admin" | "superadmin", options: {
  id?: number;
  cooperativeId?: number | null;
  verificationStatus?: "unverified" | "pending" | "approved" | "rejected";
} = {}) {
  const id = options.id ?? (role === "admin" ? 30 : role === "superadmin" ? 1 : 50);
  return appRouter.createCaller({
    req: { headers: {} },
    res: {},
    user: {
      id,
      openId: `auth-id-${id}`,
      email: "applicant@example.test",
      name: "Test Applicant",
      loginMethod: "supabase",
      role,
      approvalStatus: "approved",
      verificationStatus: options.verificationStatus ?? "unverified",
      cooperativeId: options.cooperativeId ?? (role === "admin" ? 12 : null),
      contactNumber: null,
      address: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      lastSignedIn: new Date("2026-01-01T00:00:00Z"),
    },
    authUserId: `auth-id-${id}`,
    authResolution: "application_user_resolved",
  } as TrpcContext);
}

describe("profile verification submission and evidence access", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
    mocks.getDb.mockReset();
    mocks.withRequestDatabaseScope.mockClear();
    mocks.storageCreateSignedUploadUrl.mockReset().mockImplementation(async (path: string) => ({ path, token: "upload-token" }));
    mocks.storageDownloadPrivateObject.mockReset().mockResolvedValue(png);
    mocks.storageDeleteObject.mockReset().mockResolvedValue(true);
    mocks.storageGetSignedUrl.mockReset().mockResolvedValue("https://storage.example.test/signed-evidence");
  });

  it("submits a validated private document and atomically records applicant details and notification", async () => {
    const { db, insertedValues, updateSets, dialect } = createDb([
      [],
      [applicantRow],
      [],
    ]);
    mocks.getDb.mockResolvedValue(db);

    const upload = await caller("buyer").account.requestVerificationUpload({
      contentType: "image/png",
      fileSizeBytes: png.length,
    });
    expect(upload.storagePath).toMatch(new RegExp(`^${PROFILE_VERIFICATION_BUCKET}/50/`));

    await expect(caller("buyer").account.submitVerification({
      uploadIntent: upload.uploadIntent,
      birthdate: "1990-01-02",
      phone: "555-010-0200",
      address: "Farm Road",
      note: "Please review my details.",
    })).resolves.toEqual({ success: true, submissionId: 44, verificationStatus: "pending" });

    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL).sql)
      .toContain("set_config('agricoop.profile_verification_upload_verified'");
    expect(dialect.sqlToQuery(db.execute.mock.calls[1][0] as SQL).sql)
      .toContain("create_notification");
    expect(mocks.storageDownloadPrivateObject).toHaveBeenCalledWith(upload.storagePath, PROFILE_VERIFICATION_BUCKET);
    expect(updateSets).toEqual([expect.objectContaining({
      verificationStatus: "pending",
      phone: "555-010-0200",
      address: "Farm Road",
    })]);
    expect(insertedValues).toEqual([
      expect.objectContaining({ userId: 50, storagePath: upload.storagePath, status: "pending" }),
      expect.objectContaining({ userId: 50, type: "profile_verification_submitted" }),
    ]);
  });

  it("rejects invalid applicant data before database access", async () => {
    await expect(caller("buyer").account.submitVerification({
      uploadIntent: "invalid",
      birthdate: "2099-12-31",
      phone: "123",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects an uploaded object whose signature does not match the authorized MIME type", async () => {
    const { db, insertedValues } = createDb([[]]);
    mocks.getDb.mockResolvedValue(db);
    mocks.storageDownloadPrivateObject.mockResolvedValue(Buffer.from("not an image"));
    const upload = await caller("buyer").account.requestVerificationUpload({
      contentType: "image/png",
      fileSizeBytes: 12,
    });

    await expect(caller("buyer").account.submitVerification({
      uploadIntent: upload.uploadIntent,
      birthdate: "1990-01-02",
      phone: "555-010-0200",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(mocks.storageDeleteObject).toHaveBeenCalledWith(
      upload.storagePath,
      `${PROFILE_VERIFICATION_BUCKET}/50/`,
      { bucket: PROFILE_VERIFICATION_BUCKET, public: false },
    );
    expect(db.execute).not.toHaveBeenCalled();
    expect(insertedValues).toHaveLength(0);
  });

  it("rejects a byte count that differs from the signed upload authorization", async () => {
    const { db } = createDb([[]]);
    mocks.getDb.mockResolvedValue(db);
    mocks.storageDownloadPrivateObject.mockResolvedValue(Buffer.concat([png, Buffer.from([0])]));
    const upload = await caller("buyer").account.requestVerificationUpload({
      contentType: "image/png",
      fileSizeBytes: png.length,
    });

    await expect(caller("buyer").account.submitVerification({
      uploadIntent: upload.uploadIntent,
      birthdate: "1990-01-02",
      phone: "555-010-0200",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("does not allow another user to finalize an applicant-bound upload intent", async () => {
    const { db } = createDb([[]]);
    mocks.getDb.mockResolvedValue(db);
    const upload = await caller("buyer").account.requestVerificationUpload({
      contentType: "image/png",
      fileSizeBytes: png.length,
    });

    await expect(caller("buyer", { id: 51 }).account.submitVerification({
      uploadIntent: upload.uploadIntent,
      birthdate: "1990-01-02",
      phone: "555-010-0200",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.storageDownloadPrivateObject).not.toHaveBeenCalled();
  });

  it("blocks a second pending submission under the locked user row", async () => {
    const { db, insertedValues } = createDb([
      [],
      [applicantRow],
      [{ id: 44, status: "pending" }],
    ]);
    mocks.getDb.mockResolvedValue(db);
    const upload = await caller("buyer").account.requestVerificationUpload({
      contentType: "image/png",
      fileSizeBytes: png.length,
    });

    await expect(caller("buyer").account.submitVerification({
      uploadIntent: upload.uploadIntent,
      birthdate: "1990-01-02",
      phone: "555-010-0200",
    })).rejects.toMatchObject({ code: "CONFLICT" });

    expect(insertedValues).toHaveLength(0);
    expect(mocks.storageDeleteObject).toHaveBeenCalled();
  });

  it("denies applicant access to the reviewer queue and binds history to the caller's own ID", async () => {
    const { db, conditions } = createDb([[]]);
    mocks.getDb.mockResolvedValue(db);

    await expect(caller("buyer").account.verificationQueue()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller("buyer", { id: 50 }).account.verificationMine();

    expect(conditions[0]?.params).toContain(50);
    expect(mocks.storageGetSignedUrl).not.toHaveBeenCalled();
  });

  it("scopes Admin queues to their cooperative and gives SuperAdmins platform-wide evidence access", async () => {
    const scoped = createDb([[]]);
    mocks.getDb.mockResolvedValueOnce(scoped.db);
    await expect(caller("admin", { cooperativeId: 12 }).account.verificationQueue()).resolves.toEqual([]);
    expect(scoped.conditions[0]?.params).toContain(12);
    expect(mocks.storageGetSignedUrl).not.toHaveBeenCalled();

    const evidence = {
      submissionId: 44,
      userId: 50,
      name: "Applicant",
      role: "seller",
      cooperativeId: 99,
      birthdate: null,
      phone: null,
      address: null,
      submissionNote: null,
      storagePath: `${PROFILE_VERIFICATION_BUCKET}/50/550e8400-e29b-41d4-a716-446655440000.png`,
      mimeType: "image/png",
      fileSizeBytes: png.length,
      submittedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const platform = createDb([[evidence]]);
    mocks.getDb.mockResolvedValueOnce(platform.db);

    const rows = await caller("superadmin", { cooperativeId: null }).account.verificationQueue();
    expect(rows).toEqual([expect.objectContaining({
      submissionId: 44,
      evidenceUrl: "https://storage.example.test/signed-evidence",
    })]);
    expect(mocks.storageGetSignedUrl).toHaveBeenCalledWith(evidence.storagePath, {
      bucket: PROFILE_VERIFICATION_BUCKET,
      public: false,
      expiresIn: 60,
    });
  });

  it("denies applicants and cross-cooperative Admins from reviewing submissions", async () => {
    await expect(caller("buyer").account.reviewVerification({
      submissionId: 44,
      decision: "approved",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getDb).not.toHaveBeenCalled();

    const otherCooperativeDb = createDb([[
      { submissionId: 44, userId: 50, cooperativeId: 99, verificationStatus: "pending" },
    ]]);
    mocks.getDb.mockResolvedValueOnce(otherCooperativeDb.db);
    await expect(caller("admin", { cooperativeId: 12 }).account.reviewVerification({
      submissionId: 44,
      decision: "approved",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(otherCooperativeDb.db.update).not.toHaveBeenCalled();
  });

  it("requires a reason for rejection", async () => {
    await expect(caller("admin").account.reviewVerification({
      submissionId: 44,
      decision: "rejected",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each([
    ["approved", undefined],
    ["rejected", "The submitted details could not be verified."],
  ] as const)("records the authorized %s decision and corresponding notification", async (decision, note) => {
    const { db, insertedValues, updateSets } = createDb(
      [[{
        submissionId: 44,
        userId: 50,
        cooperativeId: 12,
        verificationStatus: "pending",
      }]],
      [[{ id: 44 }], [{ id: 50 }]],
    );
    mocks.getDb.mockResolvedValue(db);

    await expect(caller("admin", { cooperativeId: 12 }).account.reviewVerification({
      submissionId: 44,
      decision,
      ...(note ? { note } : {}),
    })).resolves.toEqual({ success: true, verificationStatus: decision });

    expect(updateSets).toEqual([
      expect.objectContaining({ status: decision, reviewedBy: 30 }),
      expect.objectContaining({ verificationStatus: decision, verifiedBy: 30 }),
    ]);
    expect(insertedValues).toEqual([
      expect.objectContaining({
        userId: 50,
        type: `profile_verification_${decision}`,
        relatedEntityId: 44,
      }),
    ]);
  });
});
