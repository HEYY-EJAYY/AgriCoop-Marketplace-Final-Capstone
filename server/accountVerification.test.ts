import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  withRequestDatabaseScope: vi.fn((_authUserId: string | null, callback: () => Promise<unknown>) => callback()),
}));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getDb: mocks.getDb,
    withRequestDatabaseScope: mocks.withRequestDatabaseScope,
  };
});

import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

function createDb(
  target: { submissionId: number; userId: number; cooperativeId: number | null; verificationStatus: "pending" | "approved" | "rejected" | "unverified" } | undefined,
  updateResult: Array<{ id: number }> = [{ id: 2 }],
) {
  const dialect = new PgDialect();
  const conditions: Array<{ sql: string; params: unknown[] }> = [];
  const insertedValues: unknown[] = [];
  const updateSets: unknown[] = [];
  const db = {
    select: vi.fn(() => {
      const builder = {
        from: () => builder,
        innerJoin: () => builder,
        where: (condition: SQL) => {
          const query = dialect.sqlToQuery(condition);
          conditions.push({ sql: query.sql, params: query.params });
          return builder;
        },
        for: () => builder,
        orderBy: () => builder,
        limit: async () => target ? [target] : [],
      };
      return builder;
    }),
    update: vi.fn(() => ({
      set: (values: unknown) => {
        updateSets.push(values);
        return {
          where: (condition: SQL) => {
            const query = dialect.sqlToQuery(condition);
            conditions.push({ sql: query.sql, params: query.params });
            return { returning: async () => updateResult };
          },
        };
      },
    })),
    insert: vi.fn(() => ({
      values: async (values: unknown) => {
        insertedValues.push(values);
      },
    })),
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
    transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db)),
  };
  return { db, conditions, insertedValues, updateSets };
}

function caller(role: "buyer" | "seller" | "admin" | "superadmin", cooperativeId: number | null) {
  return appRouter.createCaller({
    req: { headers: {} },
    res: {},
    user: {
      id: role === "admin" ? 30 : role === "superadmin" ? 1 : 50,
      openId: "verified-auth-id",
      email: "reviewer@example.test",
      name: "Reviewer",
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

describe("profile verification review", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
    mocks.withRequestDatabaseScope.mockClear();
  });

  it("reviews pending members in the Admin's cooperative and records a notification atomically", async () => {
    const { db, conditions, insertedValues, updateSets } = createDb({
      submissionId: 22,
      userId: 2,
      cooperativeId: 12,
      verificationStatus: "pending",
    });
    mocks.getDb.mockResolvedValue(db);

    await expect(caller("admin", 12).account.reviewVerification({
      submissionId: 22,
      decision: "rejected",
      note: "Please submit clearer profile information.",
    })).resolves.toEqual({ success: true, verificationStatus: "rejected" });

    expect(db.transaction).toHaveBeenCalledOnce();
    expect(updateSets).toEqual([
      expect.objectContaining({
        status: "rejected",
        reviewNote: "Please submit clearer profile information.",
        reviewedBy: 30,
      }),
      expect.objectContaining({
        verificationStatus: "rejected",
        verificationNote: "Please submit clearer profile information.",
        verifiedBy: 30,
      }),
    ]);
    expect(conditions.at(-1)?.params).toContain("pending");
    expect(insertedValues).toEqual([
      expect.objectContaining({
        userId: 2,
        type: "profile_verification_rejected",
        relatedEntityId: 22,
      }),
    ]);
  });

  it("denies Admin review outside the assigned cooperative", async () => {
    const { db, updateSets, insertedValues } = createDb({
      submissionId: 22,
      userId: 2,
      cooperativeId: 99,
      verificationStatus: "pending",
    });
    mocks.getDb.mockResolvedValue(db);

    await expect(caller("admin", 12).account.reviewVerification({
      submissionId: 22,
      decision: "approved",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updateSets).toHaveLength(0);
    expect(insertedValues).toHaveLength(0);
  });

  it("allows SuperAdmin to review a pending member across cooperatives", async () => {
    const { db } = createDb({ submissionId: 22, userId: 2, cooperativeId: 99, verificationStatus: "pending" });
    mocks.getDb.mockResolvedValue(db);

    await expect(caller("superadmin", null).account.reviewVerification({
      submissionId: 22,
      decision: "approved",
    })).resolves.toEqual({ success: true, verificationStatus: "approved" });
  });

  it("rejects repeated review of a non-pending profile", async () => {
    const { db, updateSets, insertedValues } = createDb({
      submissionId: 22,
      userId: 2,
      cooperativeId: 12,
      verificationStatus: "approved",
    });
    mocks.getDb.mockResolvedValue(db);

    await expect(caller("admin", 12).account.reviewVerification({
      submissionId: 22,
      decision: "rejected",
      note: "The application was already reviewed.",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(updateSets).toHaveLength(0);
    expect(insertedValues).toHaveLength(0);
  });

  it("requires a reason before a rejection can be reviewed", async () => {
    await expect(caller("admin", 12).account.reviewVerification({
      submissionId: 22,
      decision: "rejected",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("does not record a decision when the pending-state update loses a race", async () => {
    const { db, insertedValues } = createDb(
      { submissionId: 22, userId: 2, cooperativeId: 12, verificationStatus: "pending" },
      [],
    );
    mocks.getDb.mockResolvedValue(db);

    await expect(caller("admin", 12).account.reviewVerification({
      submissionId: 22,
      decision: "approved",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(insertedValues).toHaveLength(0);
  });

  it("does not allow Sellers to review profile verification", async () => {
    const { db } = createDb({ submissionId: 22, userId: 2, cooperativeId: 12, verificationStatus: "pending" });
    mocks.getDb.mockResolvedValue(db);

    await expect(caller("seller", 12).account.reviewVerification({
      submissionId: 22,
      decision: "approved",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
