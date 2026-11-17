import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserByVerifiedAuthId: vi.fn(),
  withRequestDatabaseScope: vi.fn(),
  getDb: vi.fn(),
  subscribeConversation: vi.fn(),
}));

vi.mock("../clients", () => ({
  supabaseAdmin: { auth: { getUser: mocks.getUser } },
}));

vi.mock("../db", () => ({
  getUserByVerifiedAuthId: mocks.getUserByVerifiedAuthId,
  getDb: mocks.getDb,
  withRequestDatabaseScope: mocks.withRequestDatabaseScope,
}));

vi.mock("../realtime", () => ({
  subscribeConversation: mocks.subscribeConversation,
}));

import express from "express";
import { registerConversationStreamRoute } from "./conversationStream";

const authUser = { id: "buyer-auth-id", email_confirmed_at: "2026-01-01T00:00:00Z" };
const buyer = {
  id: 10,
  openId: "buyer-auth-id",
  role: "buyer",
  approvalStatus: "approved",
  cooperativeId: null,
};
const conversation = {
  id: 7,
  subject: "Order question",
  buyerId: 10,
  sellerId: 20,
  productId: null,
  orderId: null,
  quotationId: null,
  status: "open",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("conversation stream authorization", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  let baseUrl: string;
  const controllers = new Set<AbortController>();

  beforeEach(() => {
    mocks.getUser.mockReset().mockResolvedValue({ data: { user: authUser }, error: null });
    mocks.getUserByVerifiedAuthId.mockReset().mockResolvedValue({ user: buyer });
    mocks.withRequestDatabaseScope.mockReset().mockImplementation((_authUserId, callback) => callback());
    mocks.subscribeConversation.mockReset().mockReturnValue(vi.fn());
    const conversationQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([conversation]),
    };
    const sellerQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ cooperativeId: 2 }]),
    };
    mocks.getDb.mockReset().mockResolvedValue({
      select: vi.fn((selection?: unknown) => selection ? sellerQuery : conversationQuery),
    });

    const app = express();
    registerConversationStreamRoute(app);
    server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected an ephemeral TCP listener.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const controller of controllers) controller.abort();
    controllers.clear();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close(error => error ? reject(error) : resolve());
      });
      server = undefined;
    }
  });

  it("rejects unverified Auth identities before application mapping", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { ...authUser, email_confirmed_at: null } },
      error: null,
    });
    const response = await fetch(`${baseUrl}/api/conversations/7/stream`, {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(401);
    expect(mocks.getUserByVerifiedAuthId).not.toHaveBeenCalled();
  });

  it("returns an explicit service error when Supabase Auth lookup throws", async () => {
    mocks.getUser.mockRejectedValue(new Error("auth provider unavailable"));
    const response = await fetch(`${baseUrl}/api/conversations/7/stream`, {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(503);
  });

  it.each([
    { status: 401, expected: 401 },
    { status: 500, expected: 503 },
  ])("maps Supabase Auth error status $status to HTTP $expected", async ({ status, expected }) => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { status },
    });
    const response = await fetch(`${baseUrl}/api/conversations/7/stream`, {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(expected);
    expect(mocks.getUserByVerifiedAuthId).not.toHaveBeenCalled();
  });

  it("returns an explicit service error when database authorization fails", async () => {
    mocks.getDb.mockRejectedValue(new Error("database unavailable"));
    const response = await fetch(`${baseUrl}/api/conversations/7/stream`, {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(503);
  });

  it.each(["pending", "suspended"] as const)("rejects an operationally blocked account (%s)", async approvalStatus => {
    mocks.getUserByVerifiedAuthId.mockResolvedValue({
      user: { ...buyer, approvalStatus },
    });
    const response = await fetch(`${baseUrl}/api/conversations/7/stream`, {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(403);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("denies an Admin outside the seller cooperative", async () => {
    mocks.getUserByVerifiedAuthId.mockResolvedValue({
      user: { ...buyer, id: 30, role: "admin", cooperativeId: 3 },
    });
    const response = await fetch(`${baseUrl}/api/conversations/7/stream`, {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(403);
  });

  it("streams only after a verified operational conversation participant is authorized", async () => {
    const controller = new AbortController();
    controllers.add(controller);
    const response = await fetch(`${baseUrl}/api/conversations/7/stream`, {
      headers: { Authorization: "Bearer test-token" },
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    const firstChunk = await reader?.read();

    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(firstChunk?.value)).toContain("event: ready");
    expect(mocks.subscribeConversation).toHaveBeenCalledWith(7, expect.any(Function));
    await reader?.cancel();
  });
});
