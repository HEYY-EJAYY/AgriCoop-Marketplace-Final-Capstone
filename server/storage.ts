// Server-side Supabase Storage helpers. Payment-proof uploads use a server-issued
// signed capability so file bytes do not pass through the application function.

import { supabaseAdmin } from "./clients";
import { PAYMENT_PROOF_BUCKET, PAYMENT_PROOF_MAX_BYTES, PAYMENT_PROOF_CONTENT_TYPES } from "../shared/paymentProofs";
import {
  PROFILE_VERIFICATION_BUCKET,
  PROFILE_VERIFICATION_CONTENT_TYPES,
  PROFILE_VERIFICATION_MAX_BYTES,
} from "../shared/profileVerification";
import { SELLER_PAYMENT_QR_BUCKET } from "./paymentProofs";

const DEFAULT_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const DEFAULT_SIGNED_URL_SECONDS = 300;

type StorageBucketOptions = {
  bucket?: string;
  public?: boolean;
  expiresIn?: number;
};

function assertConfigured() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Storage config missing: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }
}

function normalizeBucketOptions(
  bucketOrOptions?: string | StorageBucketOptions,
  fallbackPublic = true,
): Required<StorageBucketOptions> {
  if (typeof bucketOrOptions === "string") {
    return { bucket: bucketOrOptions || DEFAULT_BUCKET, public: fallbackPublic, expiresIn: DEFAULT_SIGNED_URL_SECONDS };
  }

  if (bucketOrOptions && typeof bucketOrOptions === "object") {
    return {
      bucket: bucketOrOptions.bucket || DEFAULT_BUCKET,
      public: bucketOrOptions.public ?? fallbackPublic,
      expiresIn: bucketOrOptions.expiresIn ?? DEFAULT_SIGNED_URL_SECONDS,
    };
  }

  return { bucket: DEFAULT_BUCKET, public: fallbackPublic, expiresIn: DEFAULT_SIGNED_URL_SECONDS };
}

async function ensureBucket(bucketName: string, isPublic: boolean) {
  const { data: existing, error: readError } = await supabaseAdmin.storage.getBucket(bucketName);
  if (readError && !/not found|does not exist/i.test(readError.message)) {
    throw new Error(`Storage bucket check failed: ${readError.message}`);
  }

  if (!existing) {
    throw new Error(`Storage bucket "${bucketName}" is not configured. Create it through the reviewed Supabase setup process.`);
  }

  if (existing.public !== isPublic) {
    throw new Error(`Storage bucket "${bucketName}" has an unexpected visibility configuration.`);
  }

  const expectedPrivateBucket: { maxBytes: number; contentTypes: readonly string[] } | null = bucketName === PAYMENT_PROOF_BUCKET
    ? { maxBytes: PAYMENT_PROOF_MAX_BYTES, contentTypes: PAYMENT_PROOF_CONTENT_TYPES }
    : bucketName === PROFILE_VERIFICATION_BUCKET
      ? { maxBytes: PROFILE_VERIFICATION_MAX_BYTES, contentTypes: PROFILE_VERIFICATION_CONTENT_TYPES }
      : bucketName === SELLER_PAYMENT_QR_BUCKET
        ? { maxBytes: PAYMENT_PROOF_MAX_BYTES, contentTypes: PAYMENT_PROOF_CONTENT_TYPES }
        : null;
  if (expectedPrivateBucket) {
    const allowedMimeTypes = existing.allowed_mime_types ?? [];
    if (existing.file_size_limit !== expectedPrivateBucket.maxBytes
      || expectedPrivateBucket.contentTypes.some(mimeType => !allowedMimeTypes.includes(mimeType))
      || allowedMimeTypes.some(mimeType => !expectedPrivateBucket.contentTypes.includes(mimeType))) {
      throw new Error(`Storage bucket "${bucketName}" has unexpected size or MIME restrictions.`);
    }
  }
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

async function publicUrl(bucketName: string, key: string): Promise<string> {
  const { data } = await supabaseAdmin.storage.from(bucketName).getPublicUrl(key);
  if (!data?.publicUrl) {
    throw new Error("Storage public URL failed: no URL returned");
  }
  return data.publicUrl;
}

async function signedUrl(bucketName: string, key: string, expiresIn: number): Promise<string> {
  const { data, error } = await supabaseAdmin.storage.from(bucketName).createSignedUrl(key, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(`Storage signed URL failed: ${error?.message ?? "no URL returned"}`);
  }
  return data.signedUrl;
}

async function resolveUrl(bucketName: string, key: string, isPublic: boolean, expiresIn: number): Promise<string> {
  if (isPublic) return publicUrl(bucketName, key);
  return signedUrl(bucketName, key, expiresIn);
}

export function isStoragePublicUrlWithinPrefix(
  publicUrlValue: string,
  allowedKeyPrefix: string,
  bucketOrOptions?: string | StorageBucketOptions,
): boolean {
  const options = normalizeBucketOptions(bucketOrOptions, true);
  let projectUrl: URL;
  let url: URL;
  try {
    projectUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    url = new URL(publicUrlValue);
  } catch {
    return false;
  }
  const objectPrefix = `/storage/v1/object/public/${options.bucket}/`;
  if (url.origin !== projectUrl.origin || !url.pathname.startsWith(objectPrefix)) {
    return false;
  }
  let key: string;
  try {
    key = decodeURIComponent(url.pathname.slice(objectPrefix.length));
  } catch {
    return false;
  }
  return Boolean(key)
    && !key.includes("\\")
    && !key.includes("\0")
    && !key.split("/").some(segment => segment === "." || segment === "..")
    && key.startsWith(allowedKeyPrefix);
}

export function storageKeyFromPublicUrlWithinPrefix(
  publicUrlValue: string,
  allowedKeyPrefix: string,
  bucketOrOptions?: string | StorageBucketOptions,
): string | null {
  if (!isStoragePublicUrlWithinPrefix(publicUrlValue, allowedKeyPrefix, bucketOrOptions)) return null;
  const options = normalizeBucketOptions(bucketOrOptions, true);
  const url = new URL(publicUrlValue);
  const objectPrefix = `/storage/v1/object/public/${options.bucket}/`;
  return decodeURIComponent(url.pathname.slice(objectPrefix.length));
}

export function isStorageKeyWithinPrefix(key: string, allowedKeyPrefix: string): boolean {
  const normalized = normalizeKey(key);
  return Boolean(normalized)
    && !normalized.includes("\\")
    && !normalized.includes("\0")
    && !normalized.split("/").some(segment => segment === "." || segment === "..")
    && normalized.startsWith(allowedKeyPrefix);
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
  bucketOrOptions?: string | StorageBucketOptions,
  fallbackPublic = true,
): Promise<{ key: string; url: string }> {
  assertConfigured();

  const options = normalizeBucketOptions(bucketOrOptions, fallbackPublic);
  await ensureBucket(options.bucket, options.public);

  const key = appendHashSuffix(normalizeKey(relKey));
  const body = typeof data === "string" ? Buffer.from(data) : data;

  const { error } = await supabaseAdmin.storage
    .from(options.bucket)
    .upload(key, body, { contentType, upsert: false });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  return { key, url: await resolveUrl(options.bucket, key, options.public, options.expiresIn) };
}

export async function storageGet(
  relKey: string,
  bucketOrOptions?: string | StorageBucketOptions,
  fallbackPublic = true,
): Promise<{ key: string; url: string }> {
  const options = normalizeBucketOptions(bucketOrOptions, fallbackPublic);
  const key = normalizeKey(relKey);
  return { key, url: await resolveUrl(options.bucket, key, options.public, options.expiresIn) };
}

export async function storageGetSignedUrl(
  relKey: string,
  bucketOrOptions?: string | StorageBucketOptions,
  fallbackPublic = false,
): Promise<string> {
  assertConfigured();
  const options = normalizeBucketOptions(bucketOrOptions, fallbackPublic);
  await ensureBucket(options.bucket, options.public);
  const key = normalizeKey(relKey);
  return signedUrl(options.bucket, key, options.expiresIn);
}

export async function storageCreateSignedUploadUrl(key: string, bucketName = PAYMENT_PROOF_BUCKET) {
  assertConfigured();
  if (bucketName !== PAYMENT_PROOF_BUCKET && bucketName !== PROFILE_VERIFICATION_BUCKET) {
    throw new Error("Signed upload capabilities are not enabled for this Storage bucket.");
  }
  await ensureBucket(bucketName, false);
  const normalizedKey = normalizeKey(key);
  const { data, error } = await supabaseAdmin.storage
    .from(bucketName)
    .createSignedUploadUrl(normalizedKey, { upsert: false });
  if (error || !data?.token || data.path !== normalizedKey) {
    throw new Error(`Storage upload authorization failed: ${error?.message ?? "unexpected object path returned"}`);
  }
  return { path: data.path, token: data.token };
}

export async function storageDownloadPrivateObject(key: string, bucketName: string) {
  assertConfigured();
  if (bucketName !== PAYMENT_PROOF_BUCKET && bucketName !== PROFILE_VERIFICATION_BUCKET) {
    throw new Error("Private evidence downloads are not enabled for this Storage bucket.");
  }
  await ensureBucket(bucketName, false);
  const { data, error } = await supabaseAdmin.storage.from(bucketName).download(normalizeKey(key));
  if (error || !data) {
    throw new Error(`Private Storage object could not be verified: ${error?.message ?? "no object returned"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function storageDownloadPrivateProof(key: string) {
  return storageDownloadPrivateObject(key, PAYMENT_PROOF_BUCKET);
}

export async function storageDeletePublicUrl(
  publicUrl: string,
  allowedKeyPrefix: string,
  bucketOrOptions?: string | StorageBucketOptions,
): Promise<boolean> {
  assertConfigured();
  const options = normalizeBucketOptions(bucketOrOptions, true);
  if (!options.public) {
    throw new Error("Public object deletion requires a public bucket.");
  }

  if (!isStoragePublicUrlWithinPrefix(publicUrl, allowedKeyPrefix, options)) {
    return false;
  }

  const url = new URL(publicUrl);
  const objectPrefix = `/storage/v1/object/public/${options.bucket}/`;
  const key = decodeURIComponent(url.pathname.slice(objectPrefix.length));
  await ensureBucket(options.bucket, true);
  const { error } = await supabaseAdmin.storage.from(options.bucket).remove([key]);
  if (error) {
    throw new Error(`Storage deletion failed: ${error.message}`);
  }
  return true;
}

export async function storageDeleteObject(
  key: string,
  allowedKeyPrefix: string,
  bucketOrOptions?: string | StorageBucketOptions,
): Promise<boolean> {
  assertConfigured();
  const options = normalizeBucketOptions(bucketOrOptions, true);
  if (!isStorageKeyWithinPrefix(key, allowedKeyPrefix)) return false;
  await ensureBucket(options.bucket, options.public);
  const { error } = await supabaseAdmin.storage.from(options.bucket).remove([normalizeKey(key)]);
  if (error) throw new Error(`Storage deletion failed: ${error.message}`);
  return true;
}