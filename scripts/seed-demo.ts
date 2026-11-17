import "dotenv/config";
import { assertLocalSeedTarget } from "../server/seedSafety";
import { and, eq, inArray, or } from "drizzle-orm";
import { normalizeCooperativeName } from "../server/cooperativeNames";
import { getAdminDb } from "../server/db";
import { conversationMessages, conversations, cooperatives, orderItems, orders, paymentAttempts, paymentEvents, payments, products, quotations, transactions, users } from "../drizzle/pg-schema";
import {
  assertDemoIdentity,
  assertDemoTransactionCompatible,
  DEMO_ORDER_SEED_KEYS,
  insertOrSelectDemoOrder,
  isMatchingLegacyDemoOrder,
} from "../server/demoSeedRules";

assertLocalSeedTarget(process.env);
const db = await getAdminDb();
if (!db) throw new Error("SEED_DATABASE_URL is required to seed demo data");

const coopName = "AgriCoop Butuan Producers Cooperative";
const coopNormalizedName = normalizeCooperativeName(coopName).normalizedName;
const coopDescription = "A defense-demo cooperative connecting verified producers with institutional and household buyers.";
const coopLocation = "Butuan City, Agusan del Norte";
const existingCoop = (await db.select().from(cooperatives).where(or(
  eq(cooperatives.name, coopName),
  eq(cooperatives.normalizedName, coopNormalizedName),
)).limit(1))[0];
if (existingCoop && (
  existingCoop.name !== coopName
  || existingCoop.normalizedName !== coopNormalizedName
  || existingCoop.description !== coopDescription
  || existingCoop.location !== coopLocation
  || existingCoop.status !== "active"
)) {
  throw new Error("Cooperative identity conflicts with the expected demo cooperative.");
}
const coopId = existingCoop?.id ?? (await db.insert(cooperatives).values({
  name: coopName,
  normalizedName: coopNormalizedName,
  description: coopDescription,
  location: coopLocation,
  status: "active",
}).returning({ id: cooperatives.id }))[0].id;

const people = [
  { openId: "demo-buyer-001", name: "Mara Santos", email: "mara.buyer@agricoop.demo", role: "buyer" as const, approvalStatus: "approved" as const },
  { openId: "demo-farmer-001", name: "Rogelio Manalo", email: "rogelio.farmer@agricoop.demo", role: "seller" as const, approvalStatus: "approved" as const },
  { openId: "demo-farmer-002", name: "Lina Cabahug", email: "lina.farmer@agricoop.demo", role: "seller" as const, approvalStatus: "approved" as const },
  { openId: "demo-farmer-003", name: "Jun dela Cruz", email: "jun.farmer@agricoop.demo", role: "seller" as const, approvalStatus: "approved" as const },
  { openId: "demo-admin-001", name: "Celeste Navarro", email: "celeste.admin@agricoop.demo", role: "admin" as const, approvalStatus: "approved" as const },
];
const ids: Record<string, number> = {};
for (const person of people) {
  const found = (await db.select().from(users).where(eq(users.openId, person.openId)).limit(1))[0];
  const expectedIdentity = {
    openId: person.openId,
    email: person.email,
    name: person.name,
    role: person.role,
    loginMethod: "demo",
    cooperativeId: coopId,
  };
  if (found) {
    assertDemoIdentity(found, expectedIdentity);
    ids[person.openId] = found.id;
  } else {
    ids[person.openId] = (await db.insert(users).values({
      ...person,
      cooperativeId: coopId,
      loginMethod: "demo",
    }).returning({ id: users.id }))[0].id;
  }
}
const farmerIds = [ids["demo-farmer-001"], ids["demo-farmer-002"], ids["demo-farmer-003"]];
const catalog = [
  ["Carabao Mango", "Fruits", "kg", 12500, 80, "Premium golden mangoes, harvested at proper maturity."], ["Lakatan Banana", "Fruits", "kg", 6800, 120, "Naturally sweet local lakatan bananas."], ["Pineapple", "Fruits", "piece", 8500, 60, "Sweet and fragrant Queen pineapples."], ["Calamansi", "Fruits", "kg", 7200, 90, "Bright, juicy calamansi for drinks and cooking."],
  ["Red Rice", "Grains", "kg", 9800, 200, "Nutty, stone-milled red rice from cooperative farms."], ["Premium Brown Rice", "Grains", "kg", 11200, 180, "Wholesome brown rice, cleaned and packed."], ["Fresh Ginger", "Root Crops", "kg", 14500, 55, "Aromatic fresh ginger roots."], ["Sweet Potato", "Root Crops", "kg", 5500, 100, "Fresh orange-fleshed sweet potatoes."],
  ["Tomato", "Vegetables", "kg", 9500, 75, "Firm red tomatoes for household and food-service use."], ["Eggplant", "Vegetables", "kg", 7600, 70, "Tender purple eggplant."], ["String Beans", "Vegetables", "kg", 8400, 65, "Crisp string beans harvested this week."], ["Peanut", "Legumes", "kg", 13800, 45, "Roasted-ready local peanuts."],
] as const;
const productIds: number[] = [];
for (let i = 0; i < catalog.length; i++) {
  const [name, category, unit, priceCents, stockQty, description] = catalog[i];
  const sellerId = farmerIds[i % farmerIds.length];
  const found = (await db.select().from(products).where(and(eq(products.name, name), eq(products.sellerId, sellerId))).limit(1))[0];
  productIds.push(found?.id ?? (await db.insert(products).values({ sellerId, cooperativeId: coopId, name, category, variety: name, unit, priceCents, stockQty, description, qualityGrade: i % 4 === 0 ? "premium" : "standard", status: "published", verificationStatus: "approved", visibility: "visible" }).returning({ id: products.id }))[0].id);
}

const demoPaymentNote = "DEMO ONLY: no payment was processed.";
const demoPaymentMetadata = (orderId: number, amountCents: number) => JSON.stringify({
  source: "seed-demo",
  demoData: true,
  orderId,
  amountCents,
});

async function seedDemoOrder(input: {
  seedKey: typeof DEMO_ORDER_SEED_KEYS[keyof typeof DEMO_ORDER_SEED_KEYS];
  buyerId: number;
  sellerId: number;
  orderType: "regular" | "bulk";
  status: "completed" | "confirmed";
  totalCents: number;
  buyerNote: string;
  previousBuyerNotes: string[];
  previousPaymentStatuses: string[];
  previousTransactionStatus: string;
  previousTransactionNote: string;
  productId: number;
  quantity: number;
  unitPriceCents: number;
  completedAt?: Date;
}) {
  return db.transaction(async tx => {
    const [keyedOrder] = await tx.select().from(orders)
      .where(eq(orders.demoSeedKey, input.seedKey))
      .for("update")
      .limit(1);
    let order = keyedOrder;
    let adoptingLegacyOrder = false;

    if (!order) {
      const legacyOrders = await tx.select().from(orders).where(and(
        eq(orders.buyerId, input.buyerId),
        inArray(orders.buyerNote, [input.buyerNote, ...input.previousBuyerNotes]),
      )).for("update");
      if (legacyOrders.length > 1) {
        throw new Error(`Multiple legacy orders match demo seed ${input.seedKey}.`);
      }

      const legacyOrder = legacyOrders[0];
      if (legacyOrder) {
        const matchesFixture = input.previousPaymentStatuses.some(paymentStatus =>
          isMatchingLegacyDemoOrder(legacyOrder, {
            buyerId: input.buyerId,
            sellerId: input.sellerId,
            cooperativeId: coopId,
            orderType: input.orderType,
            status: input.status,
            paymentStatus,
            paymentMethod: "f2f",
            totalCents: input.totalCents,
            buyerNote: legacyOrder.buyerNote,
          }),
        );
        if (!matchesFixture) {
          throw new Error(`Legacy order ${legacyOrder.id} conflicts with demo seed ${input.seedKey}.`);
        }
        order = legacyOrder;
        adoptingLegacyOrder = true;
      } else {
        order = await insertOrSelectDemoOrder(
          input.seedKey,
          async () => {
            await tx.insert(orders).values({
              buyerId: input.buyerId,
              sellerId: input.sellerId,
              cooperativeId: coopId,
              orderType: input.orderType,
              status: input.status,
              paymentStatus: "F2F-pending-confirmation",
              paymentMethod: "f2f",
              totalCents: input.totalCents,
              buyerNote: input.buyerNote,
              demoSeedKey: input.seedKey,
              completedAt: input.completedAt,
            }).onConflictDoUpdate({
              target: orders.demoSeedKey,
              set: { demoSeedKey: input.seedKey },
            });
          },
          async key => (await tx.select().from(orders)
            .where(eq(orders.demoSeedKey, key))
            .for("update")
            .limit(1))[0],
        );
      }
    }

    if (
      order.buyerId !== input.buyerId
      || order.sellerId !== input.sellerId
      || order.cooperativeId !== coopId
      || order.orderType !== input.orderType
      || order.paymentMethod !== "f2f"
      || order.totalCents !== input.totalCents
    ) {
      throw new Error(`Order ${order.id} conflicts with demo seed ${input.seedKey}.`);
    }

    const [legacyTransaction] = await tx.select().from(transactions)
      .where(eq(transactions.orderId, order.id))
      .for("update")
      .limit(1);
    assertDemoTransactionCompatible(legacyTransaction, {
      buyerId: input.buyerId,
      sellerId: input.sellerId,
      amountCents: input.totalCents,
      paymentMethod: "f2f",
      previousStatus: input.previousTransactionStatus,
      previousNote: input.previousTransactionNote,
      demoNote: demoPaymentNote,
    });

    let orderLines = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const expectedLineMatches = orderLines.length === 1
      && orderLines[0].productId === input.productId
      && orderLines[0].quantity === input.quantity
      && orderLines[0].unitPriceCents === input.unitPriceCents
      && input.quantity * input.unitPriceCents === input.totalCents;
    if (orderLines.length > 0 && !expectedLineMatches) {
      throw new Error(`Order ${order.id} items conflict with demo seed ${input.seedKey}.`);
    }

    if (adoptingLegacyOrder) {
      await tx.update(orders).set({
        demoSeedKey: input.seedKey,
        ...(order.paymentStatus === "paid" ? { paymentStatus: "F2F-pending-confirmation" as const } : {}),
      }).where(eq(orders.id, order.id));
      const [adoptedOrder] = await tx.select().from(orders)
        .where(eq(orders.demoSeedKey, input.seedKey))
        .for("update")
        .limit(1);
      if (!adoptedOrder) throw new Error(`Legacy order ${order.id} could not be adopted.`);
      order = adoptedOrder;
    }

    if (orderLines.length === 0) {
      await tx.insert(orderItems).values({
        orderId: order.id,
        productId: input.productId,
        quantity: input.quantity,
        unitPriceCents: input.unitPriceCents,
      });
      orderLines = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    }
    const lineTotalCents = orderLines.reduce((total, item) => total + item.quantity * item.unitPriceCents, 0);
    if (lineTotalCents !== order.totalCents) {
      throw new Error(`Demo order ${order.id} item total does not match its order total.`);
    }

    const orderId = order.id;
    let [payment] = await tx.select().from(payments)
      .where(eq(payments.orderId, orderId))
      .for("update")
      .limit(1);
    if (order.paymentStatus === "paid" && payment?.status !== "verified") {
      throw new Error(`Demo order ${orderId} has a paid order status without a verified canonical payment.`);
    }
    if (!payment) {
      const [newPayment] = await tx.insert(payments).values({
        orderId,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        cooperativeId: order.cooperativeId,
        amountCents: order.totalCents,
        paymentMethod: order.paymentMethod ?? "f2f",
        status: "pending",
      }).returning({ id: payments.id });
      [payment] = await tx.select().from(payments)
        .where(eq(payments.id, newPayment.id))
        .for("update")
        .limit(1);
      if (!payment) throw new Error(`Canonical payment for demo order ${orderId} could not be loaded.`);
      await tx.insert(paymentEvents).values({
        paymentId: payment.id,
        actorUserId: null,
        eventType: "created",
        fromStatus: null,
        toStatus: "pending",
        reason: "demo_order_seeded",
        metadata: demoPaymentMetadata(orderId, order.totalCents),
      });
    } else {
      if (
        payment.amountCents !== order.totalCents
        || payment.buyerId !== order.buyerId
        || payment.sellerId !== order.sellerId
        || payment.cooperativeId !== order.cooperativeId
      ) {
        throw new Error(`Canonical payment for demo order ${orderId} conflicts with the order.`);
      }
      const [initialEvent] = await tx.select({ id: paymentEvents.id }).from(paymentEvents).where(and(
        eq(paymentEvents.paymentId, payment.id),
        inArray(paymentEvents.eventType, ["created", "order_created"]),
      )).limit(1);
      if (!initialEvent) {
        if (payment.status !== "pending") {
          throw new Error(`Demo order ${orderId} has a non-pending payment without an initial event.`);
        }
        await tx.insert(paymentEvents).values({
          paymentId: payment.id,
          actorUserId: null,
          eventType: "created",
          fromStatus: null,
          toStatus: "pending",
          reason: "demo_order_seeded",
          metadata: demoPaymentMetadata(orderId, order.totalCents),
        });
      }
    }

    const [initialAttempt] = await tx.select({ id: paymentAttempts.id }).from(paymentAttempts).where(and(
      eq(paymentAttempts.paymentId, payment.id),
      eq(paymentAttempts.attemptNumber, 1),
    )).limit(1);
    if (!initialAttempt && payment.status === "pending") {
      await tx.insert(paymentAttempts).values({
        paymentId: payment.id,
        paymentMethod: payment.paymentMethod,
        attemptNumber: 1,
        status: "pending",
        metadata: demoPaymentMetadata(orderId, order.totalCents),
      });
    }

    if (!legacyTransaction) {
      await tx.insert(transactions).values({
        orderId,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        amountCents: order.totalCents,
        paymentReferenceNote: demoPaymentNote,
        status: "recorded",
        paymentMethod: order.paymentMethod ?? "f2f",
        completedAt: order.completedAt,
      });
    }

    return orderId;
  });
}

const buyerId = ids["demo-buyer-001"];
const farmer1 = farmerIds[0];
const existingQuote = (await db.select().from(quotations).where(eq(quotations.buyerId, buyerId)).limit(1))[0];
if (!existingQuote) {
  await db.insert(quotations).values([
    { productId: productIds[0], buyerId, sellerId: farmer1, requestedQty: 25, buyerNote: "For a weekend market stall.", status: "requested" },
    { productId: productIds[4], buyerId, sellerId: farmerIds[1], requestedQty: 100, buyerNote: "Please quote institutional volume.", quotedPriceCents: 9100, sellerNote: "Available for pickup Friday.", status: "responded", respondedAt: new Date() },
  ]);
}
const demoOrderOneId = await seedDemoOrder({
  seedKey: DEMO_ORDER_SEED_KEYS.completedF2f,
  buyerId,
  sellerId: farmer1,
  orderType: "regular",
  status: "completed",
  totalCents: 12500,
  buyerNote: "DEMO ONLY: completed F2F order; no payment was processed.",
  previousBuyerNotes: ["Demo completed F2F order"],
  previousPaymentStatuses: ["pending", "paid", "F2F-pending-confirmation"],
  previousTransactionStatus: "paid",
  previousTransactionNote: "Cash handed over at cooperative office",
  productId: productIds[0],
  quantity: 1,
  unitPriceCents: 12500,
  completedAt: new Date(),
});
await seedDemoOrder({
  seedKey: DEMO_ORDER_SEED_KEYS.bulkF2f,
  buyerId,
  sellerId: farmerIds[1],
  orderType: "bulk",
  status: "confirmed",
  totalCents: 910000,
  buyerNote: "DEMO ONLY: bulk F2F order; no payment was processed.",
  previousBuyerNotes: ["Demo bulk order for school canteen"],
  previousPaymentStatuses: ["pending", "paid", "F2F-pending-confirmation"],
  previousTransactionStatus: "payment_coordinated",
  previousTransactionNote: "Meet at cooperative office",
  productId: productIds[4],
  quantity: 100,
  unitPriceCents: 9100,
});
const existingConversation = (await db.select().from(conversations).where(eq(conversations.buyerId, buyerId)).limit(1))[0];
if (!existingConversation) {
  const [thread] = await db.insert(conversations).values({ buyerId, sellerId: farmer1, productId: productIds[0], subject: "Demo order handover", orderId: demoOrderOneId, status: "open" }).returning({ id: conversations.id });
  await db.insert(conversationMessages).values({ conversationId: thread.id, senderId: buyerId, body: "Please confirm the F2F pickup window at the cooperative office." });
}
console.log(JSON.stringify({ cooperativeId: coopId, sellerIds: farmerIds, products: productIds.length, seeded: true }, null, 2));
