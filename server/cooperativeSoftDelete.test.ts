import { describe, expect, it, vi } from "vitest";
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

function ctx(role: "buyer" | "seller" | "admin" | "superadmin" | null): TrpcContext {
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
      cooperativeId: role === "seller" ? 1 : null,
      name: role,
      email: `${role}@example.test`,
    } as TrpcContext["user"],
    authUserId: `${role}-auth`,
    authResolution: "resolved",
  };
}

describe("cooperative soft delete authorization", () => {
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
});
