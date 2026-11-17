import { createHmac, timingSafeEqual } from "node:crypto";
import {
  PROFILE_VERIFICATION_BUCKET,
  PROFILE_VERIFICATION_CONTENT_TYPES,
  PROFILE_VERIFICATION_MAX_BYTES,
} from "../shared/profileVerification";

export { PROFILE_VERIFICATION_BUCKET };

const PROFILE_VERIFICATION_INTENT_TTL_MS = 10 * 60 * 1000;

export type ProfileVerificationUploadIntent = {
  userId: number;
  storagePath: string;
  mimeType: (typeof PROFILE_VERIFICATION_CONTENT_TYPES)[number];
  fileSizeBytes: number;
  expiresAt: number;
};

function getIntentSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Profile verification uploads require the server Storage configuration.");
  return secret;
}

function signPayload(payload: string) {
  return createHmac("sha256", getIntentSecret()).update(payload).digest();
}

export function createProfileVerificationUploadIntent(
  intent: Omit<ProfileVerificationUploadIntent, "expiresAt">,
  now = Date.now(),
) {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    ...intent,
    expiresAt: now + PROFILE_VERIFICATION_INTENT_TTL_MS,
  })).toString("base64url");
  return `${payload}.${signPayload(payload).toString("base64url")}`;
}

export function verifyProfileVerificationUploadIntent(
  token: string,
  userId: number,
  now = Date.now(),
): ProfileVerificationUploadIntent | null {
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
    || typeof candidate.storagePath !== "string"
    || !isProfileVerificationStorageKey(candidate.storagePath, userId)
    || typeof candidate.mimeType !== "string"
    || !PROFILE_VERIFICATION_CONTENT_TYPES.includes(candidate.mimeType as (typeof PROFILE_VERIFICATION_CONTENT_TYPES)[number])
    || typeof candidate.fileSizeBytes !== "number"
    || !Number.isInteger(candidate.fileSizeBytes)
    || candidate.fileSizeBytes < 1
    || candidate.fileSizeBytes > PROFILE_VERIFICATION_MAX_BYTES
    || typeof candidate.expiresAt !== "number"
    || !Number.isSafeInteger(candidate.expiresAt)
    || candidate.expiresAt <= now) {
    return null;
  }

  return {
    userId,
    storagePath: candidate.storagePath,
    mimeType: candidate.mimeType as ProfileVerificationUploadIntent["mimeType"],
    fileSizeBytes: candidate.fileSizeBytes,
    expiresAt: candidate.expiresAt,
  };
}

export function isProfileVerificationStorageKey(key: string, userId: number) {
  const prefix = `${PROFILE_VERIFICATION_BUCKET}/${userId}/`;
  if (!key.startsWith(prefix)) return false;
  const fileName = key.slice(prefix.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(fileName);
}

export function profileVerificationExtension(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return null;
}
