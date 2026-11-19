import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  withRequestDatabaseScope: vi.fn((_id: string | null, cb: () => Promise<unknown>) => cb()),
}));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getDb: mocks.getDb,
    withRequestDatabaseScope: mocks.withRequestDatabaseScope,
    getCooperatives: vi.fn(async () => []),
  };
});

import { appRouter } from "./routers";

function ctx(
  role: "buyer" | "seller" | "admin" | "superadmin" | null,
  cooperativeId: number | null = role === "seller" ? 1 : null,
): TrpcContext {
  if (!role) {
    return {
      req: { ip: "192.0.2.40" } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
      user: null,
      authUserId: null,
      authResolution: "no_bearer_token",
    };
  }
  return {
    req: { ip: "192.0.2.40" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: {
      id: role === "superadmin" ? 1 : role === "admin" ? 2 : 3,
      openId: `${role}-auth`,
      role,
      approvalStatus: "approved",
      cooperativeId,
      name: role,
      email: `${role}@example.test`,
    } as TrpcContext["user"],
    authUserId: `${role}-auth`,
    authResolution: "resolved",
  };
}

describe("cooperative soft delete authorization", () => {
  it("soft-deletes the cooperative and writes its audit record in one transaction", async () => {
    const cooperative = { id: 8, deletedAt: null };
    const updates: Array<Record<string, unknown>> = [];
    let selectCount = 0;
    const tx = {
      select: () => {
        const current = selectCount++;
        const result = current === 0
          ? [cooperative]
          : [{ count: current === 1 ? 2 : 4 }];
        const chain: Record<string, (...args: unknown[]) => unknown> = {
          from: () => chain,
          where: () => current === 0 ? chain : Promise.resolve(result),
          for: () => chain,
          limit: async () => result,
        };
        return chain;
      },
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return {
            where: () => ({
              returning: async () => [{ id: cooperative.id }],
            }),
          };
        },
      }),
      execute: vi.fn(async () => undefined),
    };
    const transaction = vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx));
    mocks.getDb.mockResolvedValue({ transaction });

    await expect(appRouter.createCaller(ctx("superadmin")).cooperatives.softDelete({ id: cooperative.id }))
      .resolves.toEqual({ success: true, sellerCount: 2, listingCount: 4 });

    expect(transaction).toHaveBeenCalledOnce();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      deletedBy: 1,
      status: "inactive",
    });
    expect(updates[0].deletedAt).toBeInstanceOf(Date);
    expect(tx.execute).toHaveBeenCalledOnce();
  });

  it("forbids buyers, sellers, and anonymous users from softDelete and restore", async () => {
    for (const role of [null, "buyer", "seller"] as const) {
      const caller = appRouter.createCaller(ctx(role));
      await expect(caller.cooperatives.softDelete({ id: 1 })).rejects.toMatchObject({
        code: expect.stringMatching(/UNAUTHORIZED|FORBIDDEN/),
      });
      await expect(caller.cooperatives.restore({ id: 1 })).rejects.toMatchObject({
        code: expect.stringMatching(/UNAUTHORIZED|FORBIDDEN/),
      });
    }
  });

  it("restricts cooperative management mutations to the Admin's assigned cooperative", async () => {
    mocks.getDb.mockReset();
    const caller = appRouter.createCaller(ctx("admin", 7));

    await expect(caller.cooperatives.update({ id: 8, name: "Other cooperative" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.cooperatives.softDelete({ id: 8 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.cooperatives.restore({ id: 8 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.cooperatives.setStatus({ id: 8, status: "inactive" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("does not allow Officer Admins to create platform cooperatives", async () => {
    mocks.getDb.mockReset();
    const caller = appRouter.createCaller(ctx("admin", 7));

    await expect(caller.cooperatives.create({
      name: "New cooperative",
      location: "Test City",
      address: "10 Test Street",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("scopes the management list query to the Officer Admin's cooperative", async () => {
    const whereConditions: SQL[] = [];
    const db = {
      select: () => ({
        from: () => ({
          where: (condition: SQL | undefined) => {
            if (condition) whereConditions.push(condition);
            return { orderBy: async () => [] };
          },
        }),
      }),
    };
    mocks.getDb.mockResolvedValue(db as never);

    await expect(appRouter.createCaller(ctx("admin", 7)).cooperatives.manageList())
      .resolves.toEqual([]);

    expect(whereConditions).toHaveLength(1);
    const query = new PgDialect().sqlToQuery(whereConditions[0]);
    expect(query.sql).toContain('"cooperatives"."id" = $1');
    expect(query.params).toContain(7);
  });
});
