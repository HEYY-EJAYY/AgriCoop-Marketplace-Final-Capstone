import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { accountProfileInputSchema, appRouter } from "./routers";
import { PRODUCT_UNITS } from "../shared/productOptions";

function contextFor(approvalStatus: "approved" | "pending" | "suspended"): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "profile-test",
      email: "profile@example.com",
      name: "Profile Test",
      loginMethod: "test",
      role: "buyer",
      approvalStatus,
      verificationStatus: "unverified",
      cooperativeId: null,
      contactNumber: null,
      address: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("account profile authorization", () => {
  it("rejects profile updates carrying role, approval, or cooperative fields without changing suspension", async () => {
    const ctx = contextFor("suspended");
    const caller = appRouter.createCaller(ctx);

    await expect(caller.account.updateProfile({
      name: "Changed Name",
      contactNumber: "555-0100",
      address: "New address",
      role: "buyer",
      approvalStatus: "approved",
      cooperativeId: 10,
    } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(ctx.user?.approvalStatus).toBe("suspended");
  });

  it("accepts only display name, contact number, and address in profile input", () => {
    expect(() => accountProfileInputSchema.parse({
      name: "Updated Name",
      contactNumber: "555-0100",
      address: "New address",
      role: "buyer",
      approvalStatus: "approved",
      cooperativeId: 10,
    })).toThrow();
  });
});

describe("central protected-procedure suspension gate", () => {
  it("rejects suspended users on conversation, order, quotation, and product mutations", async () => {
    const caller = appRouter.createCaller(contextFor("suspended"));

    const outcomes = await Promise.allSettled([
      caller.conversations.create({ subject: "Test conversation", body: "Test message" }),
      caller.conversations.send({ conversationId: 1, body: "Test message" }),
      caller.orders.create({ items: [{ productId: 1, quantity: 1 }] }),
      caller.quotations.request({ productId: 1, requestedQty: 1 }),
      caller.products.create({
        name: "Test produce",
        category: "Fruit",
        variety: "Test variety",
        description: "Test product",
        unit: PRODUCT_UNITS[0],
        priceCents: 100,
        stockQty: 1,
        minOrderQty: 1,
        imageUrls: [],
        submitForVerification: true,
      }),
    ]);

    expect(outcomes).toHaveLength(5);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") expect(outcome.reason).toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("also rejects pending users on protected procedures", async () => {
    const caller = appRouter.createCaller(contextFor("pending"));

    await expect(caller.conversations.create({ subject: "Test conversation", body: "Test message" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
