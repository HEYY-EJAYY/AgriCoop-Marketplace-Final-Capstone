import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  withRequestDatabaseScope: vi.fn((_authUserId: string | null, callback: () => Promise<unknown>) => callback()),
  getMarketplace: vi.fn(async () => []),
  getBuyerOrders: vi.fn(async () => []),
  getSellerOrders: vi.fn(async () => []),
  getSellerProducts: vi.fn(async () => []),
  getAdminOverview: vi.fn(async () => ({
    users: [],
    cooperatives: [],
    products: [],
    orders: [],
    quotations: [],
    transactions: [],
  })),
  createUser: vi.fn(),
  generateLink: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

vi.mock("./clients", () => ({
  createPublicAuthClient: () => ({
    auth: { resetPasswordForEmail: mocks.resetPasswordForEmail },
  }),
  supabaseAdmin: {
    auth: {
      admin: {
        createUser: mocks.createUser,
        generateLink: mocks.generateLink,
        deleteUser: vi.fn().mockResolvedValue({ error: null }),
      },
    },
  },
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
    getAdminOverview: mocks.getAdminOverview,
    upsertUser: vi.fn().mockResolvedValue(undefined),
  };
});

import { appRouter } from "./routers";

type Role = "anon" | "buyer" | "seller" | "admin" | "superadmin";
type Expectation = "allow" | "forbidden" | "unauthorized";

type AuditRow = {
  procedure: string;
  role: Role;
  expect: Expectation;
  run: () => Promise<unknown>;
};

function contextFor(role: Role): TrpcContext {
  if (role === "anon") {
    return {
      req: { headers: {} },
      res: {},
      user: null,
      authUserId: null,
      authResolution: "anonymous",
    } as TrpcContext;
  }
  return {
    req: { headers: {} },
    res: {},
    user: {
      id: role === "superadmin" ? 1 : role === "admin" ? 30 : role === "seller" ? 20 : 10,
      openId: "auth-user",
      role,
      requestedRole: null,
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
    },
    authUserId: "auth-user",
    authResolution: "application_user_resolved",
  } as TrpcContext;
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
  const updateTail = {
    where: () => ({
      returning: async () => [{ id: 1 }],
    }),
  };
  return {
    select: () => result,
    update: () => ({ set: () => updateTail }),
    execute: vi.fn().mockResolvedValue([{ role_id: 4 }]),
    insert: () => ({ values: async () => undefined }),
  };
}

function formatMatrix(rows: AuditRow[], outcomes: Array<{ ok: boolean; code?: string }>) {
  const header = ["procedure", "anon", "buyer", "seller", "admin", "superadmin"].join("\t");
  const procedures = [...new Set(rows.map(row => row.procedure))];
  const lines = [header];
  for (const procedure of procedures) {
    const cells = [procedure];
    for (const role of ["anon", "buyer", "seller", "admin", "superadmin"] as const) {
      const index = rows.findIndex(row => row.procedure === procedure && row.role === role);
      const outcome = outcomes[index];
      cells.push(outcome?.ok ? "PASS" : `FAIL(${outcome?.code ?? "error"})`);
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

describe("production access audit matrix", () => {
  it("smokes admin and superadmin products.mine under mocks", async () => {
    mocks.getSellerProducts.mockResolvedValue([]);
    await expect(appRouter.createCaller(contextFor("admin")).products.mine()).resolves.toEqual([]);
    await expect(appRouter.createCaller(contextFor("superadmin")).products.mine()).resolves.toEqual([]);
  });

  beforeEach(() => {
    mocks.getDb.mockReset().mockResolvedValue(chain([]));
    mocks.createUser.mockReset().mockResolvedValue({
      data: { user: { id: "00000000-0000-4000-8000-000000009999" } },
      error: null,
    });
    mocks.generateLink.mockReset().mockResolvedValue({
      data: { properties: { action_link: "https://example.test/set-password" } },
      error: null,
    });
    mocks.resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  });

  it("matches expected allow/forbidden/unauthorized outcomes for key procedures", async () => {
    const rows: AuditRow[] = [];

    const add = (procedure: string, role: Role, expect: Expectation, run: () => Promise<unknown>) => {
      rows.push({ procedure, role, expect, run });
    };

    for (const role of ["anon", "buyer", "seller", "admin", "superadmin"] as const) {
      const caller = appRouter.createCaller(contextFor(role));
      add("marketplace.list", role, "allow", () => caller.marketplace.list());
      add("orders.buyerMine", role, role === "anon" ? "unauthorized" : role === "buyer" || role === "seller" ? "allow" : "forbidden", () => caller.orders.buyerMine());
      add("orders.sellerMine", role, role === "seller" ? "allow" : role === "anon" ? "unauthorized" : "forbidden", () => caller.orders.sellerMine());
      add("admin.overview", role, role === "admin" || role === "superadmin" ? "allow" : role === "anon" ? "unauthorized" : "forbidden", () => caller.admin.overview());
      add("officerApplications.pendingList", role, role === "superadmin" ? "allow" : role === "anon" ? "unauthorized" : "forbidden", () => caller.officerApplications.pendingList());
      add("admin.createAccount buyer", role, role === "admin" || role === "superadmin" ? "allow" : role === "anon" ? "unauthorized" : "forbidden", () => caller.admin.createAccount({
        name: "Managed Buyer",
        email: "managed-buyer@example.test",
        role: "buyer",
      }));
      add(
        "products.mine",
        role,
        role === "seller" || role === "admin" || role === "superadmin"
          ? "allow"
          : role === "anon"
            ? "unauthorized"
            : "forbidden",
        () => caller.products.mine(),
      );
      add("products.archive", role, role === "seller" || role === "admin" || role === "superadmin" ? "allow" : role === "anon" ? "unauthorized" : "forbidden", () => caller.products.archive({ id: 1 }));
    }

    const outcomes: Array<{ ok: boolean; code?: string; detail?: string }> = [];
    for (const row of rows) {
      mocks.getDb.mockReset().mockResolvedValue(chain([]));
      mocks.getSellerProducts.mockReset().mockResolvedValue([]);
      mocks.getBuyerOrders.mockReset().mockResolvedValue([]);
      mocks.getSellerOrders.mockReset().mockResolvedValue([]);
      mocks.getAdminOverview.mockReset().mockResolvedValue({
        users: [],
        cooperatives: [],
        products: [],
        orders: [],
        quotations: [],
        transactions: [],
      });
      mocks.getMarketplace.mockReset().mockResolvedValue([]);
      let ok = false;
      let code: string | undefined;
      try {
        await row.run();
        ok = row.expect === "allow";
      } catch (error) {
        code = typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "error";
        ok = (row.expect === "forbidden" && code === "FORBIDDEN")
          || (row.expect === "unauthorized" && code === "UNAUTHORIZED");
        outcomes.push({
          ok,
          code,
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      outcomes.push({ ok, code });
    }

    // eslint-disable-next-line no-console -- print-friendly matrix for CI artifacts
    console.log(formatMatrix(rows, outcomes));

    for (const [index, row] of rows.entries()) {
      expect(outcomes[index]?.ok, `${row.procedure} × ${row.role} [${outcomes[index]?.detail ?? outcomes[index]?.code}]`).toBe(true);
    }
  });
});