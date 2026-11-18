import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { SystemPaymentAvailability } from "../shared/paymentMethods";
import { systemOnlinePaymentAccounts, systemPaymentSettings, systemPaymentSettingsAudit } from "../drizzle/pg-schema";

export const SYSTEM_PAYMENT_QR_BUCKET = "system-payment-qr";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = any;

const REQUEST_SCOPED_ROLES = new Set(["anon", "authenticated"]);

function roleNameFromExecute(result: unknown): string | null {
  if (!result) return null;
  const rows = Array.isArray(result)
    ? result
    : (typeof result === "object" && result !== null && "rows" in result && Array.isArray((result as { rows: unknown[] }).rows)
      ? (result as { rows: unknown[] }).rows
      : null);
  const first = rows?.[0];
  if (!first || typeof first !== "object") return null;
  const role = (first as { role?: unknown }).role;
  return typeof role === "string" && role.length > 0 ? role : null;
}

/**
 * Buyer/anon requests run as `authenticated`/`anon`, and these tables are staff-RLS only.
 * The connection user (typically postgres) bypasses RLS. Switch for the read, then restore.
 * Mocks without `execute` run the read directly.
 */
async function withSystemPaymentRead<T>(db: DbLike, read: () => Promise<T>): Promise<T> {
  if (typeof db?.execute !== "function") return read();
  let previousRole: string | null = null;
  try {
    previousRole = roleNameFromExecute(await db.execute(sql`select current_user::text as role`));
  } catch {
    return read();
  }
  if (!previousRole || !REQUEST_SCOPED_ROLES.has(previousRole)) return read();
  await db.execute(sql`select set_config('role', session_user::text, true)`);
  try {
    return await read();
  } finally {
    await db.execute(sql`select set_config('role', ${previousRole}, true)`);
  }
}

export type SystemPaymentSettingsRow = {
  cashPickupEnabled: boolean;
  cashDeliveryEnabled: boolean;
  onlineEnabled: boolean;
};

export async function ensureSystemPaymentSettings(db: DbLike): Promise<SystemPaymentSettingsRow> {
  const [existing] = await db.select({
    cashPickupEnabled: systemPaymentSettings.cashPickupEnabled,
    cashDeliveryEnabled: systemPaymentSettings.cashDeliveryEnabled,
    onlineEnabled: systemPaymentSettings.onlineEnabled,
  }).from(systemPaymentSettings).where(eq(systemPaymentSettings.id, 1)).limit(1);
  if (existing) return existing;
  await db.insert(systemPaymentSettings).values({ id: 1 }).onConflictDoNothing();
  return {
    cashPickupEnabled: true,
    cashDeliveryEnabled: true,
    onlineEnabled: false,
  };
}

export async function getActiveOnlineAccount(db: DbLike) {
  return withSystemPaymentRead(db, async () => {
    const [account] = await db.select().from(systemOnlinePaymentAccounts)
      .where(and(
        eq(systemOnlinePaymentAccounts.isActive, true),
        isNull(systemOnlinePaymentAccounts.archivedAt),
      ))
      .orderBy(desc(systemOnlinePaymentAccounts.updatedAt))
      .limit(1);
    return account ?? null;
  });
}

export async function getSystemPaymentAvailability(db: DbLike): Promise<SystemPaymentAvailability> {
  return withSystemPaymentRead(db, async () => {
    const settings = await ensureSystemPaymentSettings(db);
    const account = await readActiveOnlineAccount(db);
    const onlineAccountReady = Boolean(account?.qrImagePath && account.qrImagePath.trim().length > 0);
    return {
      cashPickupEnabled: settings.cashPickupEnabled,
      cashDeliveryEnabled: settings.cashDeliveryEnabled,
      onlineEnabled: settings.onlineEnabled,
      onlineAccountReady,
    };
  });
}

async function readActiveOnlineAccount(db: DbLike) {
  const [account] = await db.select().from(systemOnlinePaymentAccounts)
    .where(and(
      eq(systemOnlinePaymentAccounts.isActive, true),
      isNull(systemOnlinePaymentAccounts.archivedAt),
    ))
    .orderBy(desc(systemOnlinePaymentAccounts.updatedAt))
    .limit(1);
  return account ?? null;
}

export async function recordSystemPaymentAudit(
  db: DbLike,
  input: {
    actorUserId: number;
    actorRole: string;
    action: string;
    details?: Record<string, unknown>;
  },
) {
  await db.insert(systemPaymentSettingsAudit).values({
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: input.action,
    details: input.details ? JSON.stringify(input.details) : null,
  });
}

export function systemPaymentQrPrefix() {
  return "system/";
}

export function isSystemPaymentQrKey(key: string) {
  return key.startsWith(systemPaymentQrPrefix()) || key.startsWith(`${SYSTEM_PAYMENT_QR_BUCKET}/`);
}
