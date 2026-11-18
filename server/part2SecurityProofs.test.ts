import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { TrpcContext } from "./_core/context";
import { canCreateManagedAccountRole } from "./authz";
import { publicRegistrationInputSchema } from "./routers";
import {
  RegistrationRateLimiter,
  RegistrationRateLimitError,
} from "./registration";
import { previewUserCooperativeSelection } from "./userCooperatives";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  withRequestDatabaseScope: vi.fn((_authUserId: string | null, callback: () => Promise<unknown>) => callback()),
  getBuyerOrders: vi.fn(async () => []),
  getSellerOrders: vi.fn(async () => []),
  getAdminOverview: vi.fn(async () => ({
    users: [],
    cooperatives: [],
    products: [],
    orders: [],
    quotations: [],
    transactions: [],
  })),
  getSellerProducts: vi.fn(async () => []),
}));

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return {
    ...actual,
    getDb: mocks.getDb,
    withRequestDatabaseScope: mocks.withRequestDatabaseScope,
    getBuyerOrders: mocks.getBuyerOrders,
    getSellerOrders: mocks.getSellerOrders,
    getAdminOverview: mocks.getAdminOverview,
    getSellerProducts: mocks.getSellerProducts,
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
  const result: Record<string, unknown> = {
    from: () => result,
    where: () => result,
    limit: async () => rows,
    orderBy: () => result,
    leftJoin: () => result,
    innerJoin: () => result,
    for: () => result,
    set: () => result,
    values: async () => undefined,
  };
  return { select: () => result };
}

function reviewTransaction(application: { id: number; userId: number; status: string }) {
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => ({
            limit: async () => [application],
          }),
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    execute: vi.fn(async () => undefined),
  };
  return {
    transaction: async (callback: (inner: typeof tx) => Promise<unknown>) => callback(tx),
  };
}

function productUpdateChain(returning: unknown[]) {
  const tail = {
    where: () => ({
      returning: async () => returning,
    }),
  };
  return {
    update: () => ({
      set: () => tail,
    }),
  };
}

describe("Part 2 security proofs", () => {
  beforeEach(() => {
    mocks.getDb.mockReset().mockResolvedValue(chain([]));
    mocks.getBuyerOrders.mockClear();
    mocks.getSellerOrders.mockClear();
    mocks.getAdminOverview.mockClear();
    mocks.getSellerProducts.mockClear();
  });

  it("signup cannot set role, status, or approval fields", () => {
    const base = {
      email: "applicant@example.test",
      password: "secret12",
      name: "Applicant",
      role: "coop_admin" as const,
      cooperativeId: 1,
    };
    expect(publicRegistrationInputSchema.safeParse(base).success).toBe(true);
    expect(publicRegistrationInputSchema.safeParse({ ...base, status: "approved" }).success).toBe(false);
    expect(publicRegistrationInputSchema.safeParse({ ...base, approvalStatus: "approved" }).success).toBe(false);
    expect(publicRegistrationInputSchema.safeParse({ ...base, role: "admin" }).success).toBe(false);
    expect(publicRegistrationInputSchema.safeParse({ ...base, role: "superadmin" }).success).toBe(false);
  });

  it("pending Cooperative Admin applicant has no admin access", async () => {
    await expect(caller("buyer", 10, { requestedRole: "admin" }).officerApplications.pendingList())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("buyer", 10, { requestedRole: "admin" }).admin.overview())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("Officer Admin cannot read application files or approve applications", async () => {
    await expect(caller("admin").officerApplications.pendingList())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("admin").officerApplications.documentUrl({ applicationId: 1, kind: "id" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("admin").officerApplications.review({
      applicationId: 1,
      decision: "approved",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("nobody approves their own application", async () => {
    mocks.getDb.mockResolvedValue(reviewTransaction({
      id: 42,
      userId: 1,
      status: "pending",
    }));
    await expect(caller("superadmin", 1).officerApplications.review({
      applicationId: 42,
      decision: "approved",
    })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "You cannot review your own application.",
    });
  });

  it("Admin cannot create Admin or SuperAdmin accounts", () => {
    expect(canCreateManagedAccountRole("admin", "admin")).toBe(false);
    expect(canCreateManagedAccountRole("admin", "superadmin")).toBe(false);
  });

  it("admin.createAccount rejects superadmin at the schema boundary", async () => {
    const managedAccountRole = z.enum(["buyer", "seller", "admin"]);
    expect(managedAccountRole.safeParse("superadmin").success).toBe(false);
    await expect(caller("admin").admin.createAccount({
      name: "Officer",
      email: "officer@example.test",
      role: "admin",
      cooperativeId: 2,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("buyer order archive does not change seller or admin order views", async () => {
    const dbSource = readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");
    const sellerBlock = dbSource.match(/export async function getSellerOrders[\s\S]*?^}/m)?.[0] ?? "";
    expect(sellerBlock).toMatch(/threadStates\.userId,\s*sellerId/);
    expect(sellerBlock).toMatch(/threadStates\.channel,\s*"seller_order"/);
    expect(sellerBlock).not.toMatch(/threadStates\.channel,\s*"order"/);
    const adminBlock = dbSource.match(/export async function getAdminOverview[\s\S]*?^}/m)?.[0] ?? "";
    expect(adminBlock).not.toMatch(/archivedAt/i);

    await caller("seller", 20).orders.sellerMine();
    expect(mocks.getSellerOrders).toHaveBeenCalledWith(20, { archived: false, deleted: false });
    expect(mocks.getSellerOrders).toHaveBeenCalledTimes(1);

    await caller("buyer", 10).orders.buyerMine({ archived: true });
    expect(mocks.getBuyerOrders).toHaveBeenCalledWith(10, { archived: true, deleted: false });

    await expect(
      caller("admin", 99).orders.updateArchive({ orderIds: [1], action: "archive" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await caller("admin").admin.overview();
    expect(mocks.getAdminOverview).toHaveBeenCalled();
  });

  it("seller cannot archive another seller's listing", async () => {
    mocks.getDb.mockResolvedValue(productUpdateChain([]));
    await expect(caller("seller", 20).products.archive({ id: 99 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cooperative creation is rate limited and rejects near-duplicates", () => {
    let now = 0;
    const limiter = new RegistrationRateLimiter(() => now);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      limiter.consume("create_cooperative", "192.0.2.77", `seller-${attempt}@example.test`);
    }
    expect(() => limiter.consume("create_cooperative", "192.0.2.77", "another@example.test"))
      .toThrow(RegistrationRateLimitError);

    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{
              id: 3,
              name: "Sutafaco Cooperative",
              normalizedName: "sutafacocooperative",
              location: "Butuan City, Agusan del Norte",
              normalizedLocation: "butuancityagusandelnorte",
              address: "Poblacion",
            }],
          }),
        }),
      }),
    };
    return previewUserCooperativeSelection(db as never, {
      newCooperativeName: "SUTAFACO Cooperative",
      newCooperativeLocation: "Butuan City, Agusan del Norte",
      newCooperativeAddress: "Poblacion",
    }).then(result => {
      expect(result.kind).toBe("exact_duplicate");
    });
  });
});