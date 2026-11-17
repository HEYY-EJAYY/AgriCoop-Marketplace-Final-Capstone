import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserByVerifiedAuthId: vi.fn(),
  withRequestDatabaseScope: vi.fn(),
  getDb: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("../clients", () => ({
  supabaseAdmin: { auth: { getUser: mocks.getUser } },
}));

vi.mock("../db", () => ({
  getUserByVerifiedAuthId: mocks.getUserByVerifiedAuthId,
  getDb: mocks.getDb,
  withRequestDatabaseScope: mocks.withRequestDatabaseScope,
}));

vi.mock("./env", () => ({
  ENV: { forgeApiUrl: "https://storage.example.test", forgeApiKey: "server-only" },
}));

import express from "express";
import { registerStorageProxy } from "./storageProxy";

const requestFetch = globalThis.fetch.bind(globalThis);

const productImage = {
  sellerId: 7,
  cooperativeId: 2,
  status: "published",
  verificationStatus: "approved",
  visibility: "visible",
  sellerApprovalStatus: "approved",
  primaryImageUrl: "/manus-storage/products/7/harvest.png",
  galleryImageUrl: null,
};

function actor(role: "buyer" | "seller" | "admin" | "superadmin", values: Partial<{
  id: number;
  openId: string;
  approvalStatus: "approved" | "pending" | "suspended";
  cooperativeId: number | null;
}> = {}) {
  return {
    id: values.id ?? 14,
    openId: values.openId ?? "test-auth-id",
    role,
    approvalStatus: values.approvalStatus ?? "approved",
    cooperativeId: values.cooperativeId ?? null,
  };
}

describe("legacy storage proxy route authorization", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  let baseUrl: string;

  beforeEach(() => {
    mocks.getUser.mockReset().mockResolvedValue({
      data: { user: { id: "test-auth-id", email_confirmed_at: "2026-01-01T00:00:00Z" } },
      error: null,
    });
    mocks.getUserByVerifiedAuthId.mockReset().mockResolvedValue({ user: actor("buyer") });
    mocks.withRequestDatabaseScope.mockReset().mockImplementation((_authUserId, callback) => callback());
    mocks.fetch.mockReset().mockResolvedValue(new Response(
      JSON.stringify({ url: "https://cdn.example.test/signed-product-image" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.getDb.mockReset().mockImplementation(() => {
      const query = {
        from: vi.fn(() => query),
        innerJoin: vi.fn(() => query),
        leftJoin: vi.fn(() => query),
        where: vi.fn().mockResolvedValue([productImage]),
      };
      return { select: vi.fn(() => query) };
    });
    const app = express();
    registerStorageProxy(app);
    server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected an ephemeral TCP listener.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close(error => error ? reject(error) : resolve());
      });
      server = undefined;
    }
  });

  it("rejects requests without an Auth bearer token", async () => {
    const response = await requestFetch(`${baseUrl}/manus-storage/products/7/harvest.png`);

    expect(response.status).toBe(401);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("denies an Admin outside the product cooperative", async () => {
    mocks.getUserByVerifiedAuthId.mockResolvedValue({
      user: actor("admin", { id: 21, openId: "test-auth-id", cooperativeId: 3 }),
    });
    const response = await requestFetch(`${baseUrl}/manus-storage/products/7/harvest.png`, {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(404);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not sign arbitrary paths or private payment-proof keys", async () => {
    mocks.getDb.mockImplementation(() => {
      const query = {
        from: vi.fn(() => query),
        innerJoin: vi.fn(() => query),
        leftJoin: vi.fn(() => query),
        where: vi.fn().mockResolvedValue([]),
      };
      return { select: vi.fn(() => query) };
    });
    const arbitraryResponse = await requestFetch(`${baseUrl}/manus-storage/private/another-user.png`, {
      headers: { Authorization: "Bearer test-token" },
    });
    const paymentProofResponse = await requestFetch(`${baseUrl}/manus-storage/payment-proofs/7/receipt.png`, {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(arbitraryResponse.status).toBe(404);
    expect(paymentProofResponse.status).toBe(404);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("redirects an operational user only for a product image referenced by an accessible product", async () => {
    const response = await requestFetch(`${baseUrl}/manus-storage/products/7/harvest.png`, {
      headers: { Authorization: "Bearer test-token" },
      redirect: "manual",
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://cdn.example.test/signed-product-image");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
