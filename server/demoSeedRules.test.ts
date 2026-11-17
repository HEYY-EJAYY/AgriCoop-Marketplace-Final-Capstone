import { describe, expect, it } from "vitest";
import {
  assertDemoIdentity,
  assertDemoTransactionCompatible,
  DEMO_ORDER_SEED_KEYS,
  insertOrSelectDemoOrder,
  isMatchingLegacyDemoOrder,
} from "./demoSeedRules";

const demoUser = {
  openId: "demo-buyer-001",
  email: "mara.buyer@agricoop.demo",
  name: "Mara Santos",
  role: "buyer",
  loginMethod: "demo",
  cooperativeId: 7,
};

const legacyOrder = {
  buyerId: 1,
  sellerId: 2,
  cooperativeId: 7,
  orderType: "regular",
  status: "completed",
  paymentStatus: "paid",
  paymentMethod: "f2f",
  totalCents: 12500,
  buyerNote: "Demo completed F2F order",
};

describe("demo seed safety rules", () => {
  it("uses explicit stable order keys independent of mutable notes", () => {
    expect(DEMO_ORDER_SEED_KEYS.completedF2f).toBe("agricoop-demo:order:completed-f2f:v1");
    expect(DEMO_ORDER_SEED_KEYS.bulkF2f).not.toBe(DEMO_ORDER_SEED_KEYS.completedF2f);
  });

  it("accepts only the expected demo account identity", () => {
    expect(() => assertDemoIdentity(demoUser, demoUser)).not.toThrow();
    expect(() => assertDemoIdentity({ ...demoUser, loginMethod: "supabase" }, demoUser))
      .toThrow("Demo account identity conflict");
    expect(() => assertDemoIdentity({ ...demoUser, email: "real@example.com" }, demoUser))
      .toThrow("Demo account identity conflict");
  });

  it("adopts only an exact known legacy demo order signature", () => {
    expect(isMatchingLegacyDemoOrder(legacyOrder, legacyOrder)).toBe(true);
    expect(isMatchingLegacyDemoOrder({ ...legacyOrder, sellerId: 99 }, legacyOrder)).toBe(false);
    expect(isMatchingLegacyDemoOrder({ ...legacyOrder, totalCents: 1 }, legacyOrder)).toBe(false);
  });

  it("accepts known prior demo transactions without changing them and rejects conflicts", () => {
    const expected = {
      buyerId: 1,
      sellerId: 2,
      amountCents: 12500,
      paymentMethod: "f2f",
      previousStatus: "paid",
      previousNote: "Cash handed over at cooperative office",
      demoNote: "DEMO ONLY: no payment was processed.",
    };

    expect(() => assertDemoTransactionCompatible({
      buyerId: 1,
      sellerId: 2,
      amountCents: 12500,
      paymentMethod: "f2f",
      status: "paid",
      paymentReferenceNote: "Cash handed over at cooperative office",
    }, expected)).not.toThrow();
    expect(() => assertDemoTransactionCompatible({
      buyerId: 1,
      sellerId: 2,
      amountCents: 12500,
      paymentMethod: "f2f",
      status: "paid",
      paymentReferenceNote: "Buyer says cash was received",
    }, expected)).toThrow("Existing transaction conflicts");
  });

  it("reuses the same order across sequential and concurrent upserts", async () => {
    const orders = new Map<string, { id: number }>();
    let nextId = 1;
    const upsert = () => insertOrSelectDemoOrder(
      DEMO_ORDER_SEED_KEYS.completedF2f,
      async () => {
        if (!orders.has(DEMO_ORDER_SEED_KEYS.completedF2f)) {
          orders.set(DEMO_ORDER_SEED_KEYS.completedF2f, { id: nextId++ });
        }
      },
      async key => orders.get(key),
    );

    const first = await upsert();
    const second = await upsert();
    const [third, fourth] = await Promise.all([upsert(), upsert()]);

    expect(first.id).toBe(second.id);
    expect(third.id).toBe(first.id);
    expect(fourth.id).toBe(first.id);
    expect(orders.size).toBe(1);
  });
});
