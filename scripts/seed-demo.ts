import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { cooperatives, orderItems, orders, products, quotations, transactions, users } from "../drizzle/schema";

const db = await getDb();
if (!db) throw new Error("DATABASE_URL is required to seed demo data");

const existingCoop = (await db.select().from(cooperatives).where(eq(cooperatives.name, "AgriCoop Butuan Producers Cooperative")).limit(1))[0];
const coopId = existingCoop?.id ?? (await db.insert(cooperatives).values({ name: "AgriCoop Butuan Producers Cooperative", description: "A defense-demo cooperative connecting verified producers with institutional and household buyers.", location: "Butuan City, Agusan del Norte", status: "active" }).$returningId())[0].id;

const people = [
  { openId: "demo-buyer-001", name: "Mara Santos", email: "mara.buyer@agricoop.demo", role: "buyer" as const, approvalStatus: "approved" as const },
  { openId: "demo-farmer-001", name: "Rogelio Manalo", email: "rogelio.farmer@agricoop.demo", role: "seller" as const, approvalStatus: "approved" as const },
  { openId: "demo-farmer-002", name: "Lina Cabahug", email: "lina.farmer@agricoop.demo", role: "seller" as const, approvalStatus: "approved" as const },
  { openId: "demo-farmer-003", name: "Jun dela Cruz", email: "jun.farmer@agricoop.demo", role: "seller" as const, approvalStatus: "approved" as const },
  { openId: "demo-officer-001", name: "Celeste Navarro", email: "celeste.officer@agricoop.demo", role: "officer" as const, approvalStatus: "approved" as const },
];
const ids: Record<string, number> = {};
for (const person of people) {
  const found = (await db.select().from(users).where(eq(users.openId, person.openId)).limit(1))[0];
  ids[person.openId] = found?.id ?? (await db.insert(users).values({ ...person, cooperativeId: coopId, loginMethod: "demo" }).$returningId())[0].id;
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
  productIds.push(found?.id ?? (await db.insert(products).values({ sellerId, cooperativeId: coopId, name, category, unit, priceCents, stockQty, description, qualityGrade: i % 4 === 0 ? "premium" : "standard", status: "published" }).$returningId())[0].id);
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
const existingOrder = (await db.select().from(orders).where(eq(orders.buyerId, buyerId)).limit(1))[0];
if (!existingOrder) {
  const order1 = (await db.insert(orders).values({ buyerId, sellerId: farmer1, cooperativeId: coopId, orderType: "regular", status: "completed", paymentStatus: "paid", paymentMethod: "gcash", totalCents: 12500, buyerNote: "Demo completed GCash order", completedAt: new Date() }).$returningId())[0].id;
  await db.insert(orderItems).values({ orderId: order1, productId: productIds[0], quantity: 1, unitPriceCents: 12500 });
  await db.insert(transactions).values({ orderId: order1, buyerId, sellerId: farmer1, amountCents: 12500, paymentMethod: "paymongo", externalId: "pay_demo_gcash_001", status: "paid" });
  const order2 = (await db.insert(orders).values({ buyerId, sellerId: farmerIds[1], cooperativeId: coopId, orderType: "bulk", status: "confirmed", paymentStatus: "F2F-pending-confirmation", paymentMethod: "f2f", totalCents: 910000, buyerNote: "Demo bulk order for school canteen" }).$returningId())[0].id;
  await db.insert(orderItems).values({ orderId: order2, productId: productIds[4], quantity: 100, unitPriceCents: 9100 });
  await db.insert(transactions).values({ orderId: order2, buyerId, sellerId: farmerIds[1], amountCents: 910000, paymentMethod: "f2f", status: "payment_coordinated", paymentReferenceNote: "Meet at cooperative office" });
}
console.log(JSON.stringify({ cooperativeId: coopId, sellerIds: farmerIds, products: productIds.length, seeded: true }, null, 2));
