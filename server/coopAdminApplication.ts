import { createHmac, timingSafeEqual } from "node:crypto";
import {
  COOP_ADMIN_APPLICATION_BUCKET,
  COOP_ADMIN_APPLICATION_CONTENT_TYPES,
  COOP_ADMIN_APPLICATION_MAX_BYTES,
} from "../shared/coopAdminApplication";

export { COOP_ADMIN_APPLICATION_BUCKET };

const COOP_ADMIN_APPLICATION_INTENT_TTL_MS = 10 * 60 * 1000;

export type CoopAdminApplicationUploadIntent = {
  userId: number;
  openId: string;
  storagePath: string;
  mimeType: (typeof COOP_ADMIN_APPLICATION_CONTENT_TYPES)[number];
  fileSizeBytes: number;
  expiresAt: number;
};

function getIntentSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Cooperative admin application uploads require the server Storage configuration.");
  return secret;
}

function signPayload(payload: string) {
  return createHmac("sha256", getIntentSecret()).update(payload).digest();
}

export function createCoopAdminApplicationUploadIntent(
  intent: Omit<CoopAdminApplicationUploadIntent, "expiresAt">,
  now = Date.now(),
) {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    ...intent,
    expiresAt: now + COOP_ADMIN_APPLICATION_INTENT_TTL_MS,
  })).toString("base64url");
  return `${payload}.${signPayload(payload).toString("base64url")}`;
}

export function verifyCoopAdminApplicationUploadIntent(
  token: string,
  userId: number,
  openId: string,
  now = Date.now(),
): CoopAdminApplicationUploadIntent | null {
  const [payload, encodedSignature, extra] = token.split(".");
  if (!payload || !encodedSignature || extra !== undefined) return null;

  const actualSignature = Buffer.from(encodedSignature, "base64url");
  const expectedSignature = signPayload(payload);
  if (actualSignature.length !== expectedSignature.length
    || !timingSafeEqual(actualSignature, expectedSignature)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== 1
    || candidate.userId !== userId
    || candidate.openId !== openId
    || typeof candidate.storagePath !== "string"
    || !isCoopAdminApplicationStorageKey(candidate.storagePath, openId)
    || typeof candidate.mimeType !== "string"
    || !COOP_ADMIN_APPLICATION_CONTENT_TYPES.includes(candidate.mimeType as (typeof COOP_ADMIN_APPLICATION_CONTENT_TYPES)[number])
    || typeof candidate.fileSizeBytes !== "number"
    || !Number.isInteger(candidate.fileSizeBytes)
    || candidate.fileSizeBytes < 1
    || candidate.fileSizeBytes > COOP_ADMIN_APPLICATION_MAX_BYTES
    || typeof candidate.expiresAt !== "number"
    || !Number.isSafeInteger(candidate.expiresAt)
    || candidate.expiresAt <= now) {
    return null;
  }

  return {
    userId,
    openId,
    storagePath: candidate.storagePath,
    mimeType: candidate.mimeType as CoopAdminApplicationUploadIntent["mimeType"],
    fileSizeBytes: candidate.fileSizeBytes,
    expiresAt: candidate.expiresAt,
  };
}

export function isCoopAdminApplicationStorageKey(key: string, openId: string) {
  // Preferred: `{openId}/{uuid}.ext` (bucket-relative, user-id prefix).
  // Legacy Part 2 draft also accepted `{bucket}/{openId}/{uuid}.ext`.
  const preferred = `${openId}/`;
  const legacy = `${COOP_ADMIN_APPLICATION_BUCKET}/${openId}/`;
  const fileName = key.startsWith(preferred)
    ? key.slice(preferred.length)
    : key.startsWith(legacy)
      ? key.slice(legacy.length)
      : null;
  if (!fileName || fileName.includes("/")) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$/i.test(fileName);
}

export function coopAdminApplicationExtension(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "application/pdf") return "pdf";
  return null;
}