import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { accountProfileInputSchema, appRouter } from "./routers";
import type { SupabaseAppUser } from "./supabaseProfiles";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function contextFor(
  approvalStatus: SupabaseAppUser["approvalStatus"]
): TrpcContext {
  const user: SupabaseAppUser = {
    id: USER_ID,
    email: "profile@example.com",
    name: "Profile Test",
    role: "buyer",
    approvalStatus,
    verificationStatus: "unverified",
    cooperativeId: null,
    cooperativeName: null,
    contactNumber: null,
    address: null,
  };
  return {
    user,
    supabaseUser: user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("Supabase account profile authorization", () => {
  it("accepts only the profile fields that exist in the live profiles table", () => {
    expect(() =>
      accountProfileInputSchema.parse({ name: "Updated Name" })
    ).not.toThrow();
    expect(() =>
      accountProfileInputSchema.parse({
        name: "Updated Name",
        contactNumber: "555-0100",
        address: "New address",
      })
    ).toThrow();
  });
});

describe("central Supabase protected-procedure approval gate", () => {
  it("rejects suspended users before commerce data access", async () => {
    const caller = appRouter.createCaller(contextFor("suspended"));
    const outcomes = await Promise.allSettled([
      caller.supabaseOrders.create({
        items: [{ productId: USER_ID, quantity: 1 }],
      }),
      caller.supabaseQuotations.request({
        productId: USER_ID,
        requestedQty: 1,
      }),
      caller.supabaseProducts.create({
        name: "Test produce",
        category: "Fruit",
        description: "Test product",
        unit: "kg",
        priceCents: 100,
        stockQty: 1,
      }),
    ]);

    expect(outcomes).toHaveLength(3);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected")
        expect(outcome.reason).toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("also rejects pending users before commerce data access", async () => {
    const caller = appRouter.createCaller(contextFor("pending"));
    await expect(
      caller.supabaseOrders.create({
        items: [{ productId: USER_ID, quantity: 1 }],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
