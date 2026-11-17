export const DEMO_ORDER_SEED_KEYS = {
  completedF2f: "agricoop-demo:order:completed-f2f:v1",
  bulkF2f: "agricoop-demo:order:bulk-f2f:v1",
} as const;

export type DemoOrderSeedKey = (typeof DEMO_ORDER_SEED_KEYS)[keyof typeof DEMO_ORDER_SEED_KEYS];

type DemoIdentity = {
  openId: string;
  email: string | null;
  name: string | null;
  role: string;
  loginMethod: string | null;
  cooperativeId: number | null;
};

export function assertDemoIdentity(
  user: DemoIdentity,
  expected: DemoIdentity,
) {
  if (
    user.openId !== expected.openId
    || user.email !== expected.email
    || user.name !== expected.name
    || user.role !== expected.role
    || user.loginMethod !== "demo"
    || user.cooperativeId !== expected.cooperativeId
  ) {
    throw new Error(`Demo account identity conflict for ${expected.openId}.`);
  }
}

export type LegacyDemoOrderSignature = {
  buyerId: number;
  sellerId: number;
  cooperativeId: number | null;
  orderType: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  totalCents: number;
  buyerNote: string | null;
};

export function isMatchingLegacyDemoOrder(
  order: LegacyDemoOrderSignature,
  expected: LegacyDemoOrderSignature,
) {
  return order.buyerId === expected.buyerId
    && order.sellerId === expected.sellerId
    && order.cooperativeId === expected.cooperativeId
    && order.orderType === expected.orderType
    && order.status === expected.status
    && order.paymentStatus === expected.paymentStatus
    && order.paymentMethod === expected.paymentMethod
    && order.totalCents === expected.totalCents
    && order.buyerNote === expected.buyerNote;
}

type DemoTransactionSignature = {
  buyerId: number;
  sellerId: number;
  amountCents: number;
  paymentMethod: string | null;
  status: string;
  paymentReferenceNote: string | null;
};

export function assertDemoTransactionCompatible(
  transaction: DemoTransactionSignature | undefined,
  expected: {
    buyerId: number;
    sellerId: number;
    amountCents: number;
    paymentMethod: string;
    previousStatus: string;
    previousNote: string;
    demoNote: string;
  },
) {
  if (!transaction) return;

  const identityAndAmountMatch = transaction.buyerId === expected.buyerId
    && transaction.sellerId === expected.sellerId
    && transaction.amountCents === expected.amountCents
    && transaction.paymentMethod === expected.paymentMethod;
  const isKnownPreviousSeed = transaction.status === expected.previousStatus
    && transaction.paymentReferenceNote === expected.previousNote;
  const isCurrentDemoSeed = transaction.status === "recorded"
    && transaction.paymentReferenceNote === expected.demoNote;

  if (!identityAndAmountMatch || (!isKnownPreviousSeed && !isCurrentDemoSeed)) {
    throw new Error("Existing transaction conflicts with the expected demo seed record.");
  }
}

export async function insertOrSelectDemoOrder<T>(
  seedKey: DemoOrderSeedKey,
  insertOnConflict: () => Promise<void>,
  selectBySeedKey: (key: DemoOrderSeedKey) => Promise<T | undefined>,
) {
  await insertOnConflict();
  const order = await selectBySeedKey(seedKey);
  if (!order) throw new Error(`Demo order ${seedKey} was not available after upsert.`);
  return order;
}
