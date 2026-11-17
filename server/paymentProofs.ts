import { createHmac, timingSafeEqual } from "node:crypto";
import {
  PAYMENT_PROOF_BUCKET,
  PAYMENT_PROOF_CONTENT_TYPES,
  PAYMENT_PROOF_MAX_BYTES,
} from "../shared/paymentProofs";

export { PAYMENT_PROOF_BUCKET };

const PAYMENT_PROOF_UPLOAD_INTENT_TTL_MS = 10 * 60 * 1000;

export type PaymentProofUploadIntent = {
  buyerId: number;
  orderId: number;
  storagePath: string;
  originalFileName: string;
  mimeType: (typeof PAYMENT_PROOF_CONTENT_TYPES)[number];
  fileSizeBytes: number;
  expiresAt: number;
};

function getUploadIntentSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Payment proof uploads require the server Storage configuration.");
  return secret;
}

function signPayload(payload: string) {
  return createHmac("sha256", getUploadIntentSecret()).update(payload).digest();
}

export function createPaymentProofUploadIntent(
  intent: Omit<PaymentProofUploadIntent, "expiresAt">,
  now = Date.now(),
) {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    ...intent,
    expiresAt: now + PAYMENT_PROOF_UPLOAD_INTENT_TTL_MS,
  })).toString("base64url");
  return `${payload}.${signPayload(payload).toString("base64url")}`;
}

export function verifyPaymentProofUploadIntent(
  token: string,
  buyerId: number,
  orderId: number,
  now = Date.now(),
): PaymentProofUploadIntent | null {
  const [payload, encodedSignature, extra] = token.split(".");
  if (!payload || !encodedSignature || extra !== undefined) return null;

  let actualSignature: Buffer;
  try {
    actualSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    return null;
  }
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
    || candidate.buyerId !== buyerId
    || candidate.orderId !== orderId
    || typeof candidate.storagePath !== "string"
    || !isPaymentProofStorageKey(candidate.storagePath, buyerId, orderId)
    || typeof candidate.originalFileName !== "string"
    || !candidate.originalFileName
    || candidate.originalFileName.length > 255
    || typeof candidate.mimeType !== "string"
    || !PAYMENT_PROOF_CONTENT_TYPES.includes(candidate.mimeType as (typeof PAYMENT_PROOF_CONTENT_TYPES)[number])
    || typeof candidate.fileSizeBytes !== "number"
    || !Number.isInteger(candidate.fileSizeBytes)
    || candidate.fileSizeBytes < 1
    || candidate.fileSizeBytes > PAYMENT_PROOF_MAX_BYTES
    || typeof candidate.expiresAt !== "number"
    || !Number.isSafeInteger(candidate.expiresAt)
    || candidate.expiresAt <= now) {
    return null;
  }

  return {
    buyerId,
    orderId,
    storagePath: candidate.storagePath,
    originalFileName: candidate.originalFileName,
    mimeType: candidate.mimeType as PaymentProofUploadIntent["mimeType"],
    fileSizeBytes: candidate.fileSizeBytes,
    expiresAt: candidate.expiresAt,
  };
}

export function isPaymentProofStorageKey(key: string, buyerId: number, orderId: number) {
  const prefix = `${PAYMENT_PROOF_BUCKET}/${buyerId}/${orderId}/`;
  if (!key.startsWith(prefix)) return false;
  const fileName = key.slice(prefix.length);
  return Boolean(fileName)
    && !fileName.includes("/")
    && !fileName.includes("\\")
    && !fileName.includes("\0")
    && fileName !== "."
    && fileName !== "..";
}

export function sanitizePaymentProofFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "payment-proof";
}
