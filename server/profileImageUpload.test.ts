import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PROFILE_IMAGE_SIZE_BYTES } from "../shared/profileImage";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  storagePut: vi.fn(),
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

vi.mock("./storage", async importOriginal => {
  const actual = await importOriginal<typeof import("./storage")>();
  return {
    ...actual,
    storagePut: mocks.storagePut,
  };
});

import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

/** Minimal JPEG bytes (SOI + EOI) that pass signature checks */
const JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

function callerFor(user: { id: number; openId: string; role: "buyer" | "seller" | "admin" | "superadmin" }) {
  return appRouter.createCaller({
    user: {
      id: user.id,
      openId: user.openId,
      role: user.role,
      name: "Tester",
      email: `${user.openId}@example.test`,
      approvalStatus: "approved",
      cooperativeId: 1,
    },
  } as TrpcContext);
}

describe("account.uploadProfileImage", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
    mocks.storagePut.mockReset();
    const update = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    }));
    mocks.getDb.mockResolvedValue({ update });
    mocks.storagePut.mockResolvedValue({
      key: "user-a/avatar.jpg",
      url: "https://cdn.example/avatars/user-a/avatar.jpg",
    });
  });

  it("uploads under the caller's own openId folder into the avatars bucket", async () => {
    const caller = callerFor({ id: 11, openId: "user-a", role: "buyer" });
    const result = await caller.account.uploadProfileImage({
      fileName: "me.jpg",
      contentType: "image/jpeg",
      base64: JPEG_BASE64,
    });
    expect(result.url).toContain("avatars/user-a/");
    expect(mocks.storagePut).toHaveBeenCalledOnce();
    const [key, , contentType, options] = mocks.storagePut.mock.calls[0]!;
    expect(String(key).startsWith("user-a/")).toBe(true);
    expect(String(key).startsWith("user-b/")).toBe(false);
    expect(contentType).toBe("image/jpeg");
    expect(options).toMatchObject({ bucket: "avatars", public: true });
  });

  it("rejects oversized payloads before storage", async () => {
    const caller = callerFor({ id: 11, openId: "user-a", role: "seller" });
    const oversized = Buffer.alloc(MAX_PROFILE_IMAGE_SIZE_BYTES + 1, 0xff).toString("base64");
    await expect(
      caller.account.uploadProfileImage({
        fileName: "big.jpg",
        contentType: "image/jpeg",
        base64: oversized,
      }),
    ).rejects.toThrow(/2 MB or less/i);
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("rejects non-image content types", async () => {
    const caller = callerFor({ id: 11, openId: "user-a", role: "admin" });
    await expect(
      caller.account.uploadProfileImage({
        fileName: "notes.txt",
        contentType: "image/png",
        base64: Buffer.from("not-an-image").toString("base64"),
      }),
    ).rejects.toThrow(/JPEG, PNG, or WebP/i);
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("never writes into another user's avatar path prefix", async () => {
    const attacker = callerFor({ id: 99, openId: "attacker", role: "superadmin" });
    await attacker.account.uploadProfileImage({
      fileName: "steal.jpg",
      contentType: "image/jpeg",
      base64: JPEG_BASE64,
    });
    const [key] = mocks.storagePut.mock.calls[0]!;
    expect(String(key).startsWith("attacker/")).toBe(true);
    expect(String(key)).not.toMatch(/^victim\//);
    expect(String(key)).not.toContain("user-a/");
  });
});
