// Supabase Storage helpers. Signed upload tokens let the browser upload bytes
// directly without exposing the service-role key.

import { supabaseAdmin } from "./clients.js";
import { MAX_PRODUCT_IMAGE_SIZE_BYTES } from "../shared/productOptions.js";

const DEFAULT_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const DEFAULT_SIGNED_URL_SECONDS = 300;
const PRODUCT_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

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
  const bucketSettings = {
    public: isPublic,
    fileSizeLimit: MAX_PRODUCT_IMAGE_SIZE_BYTES,
    allowedMimeTypes: PRODUCT_IMAGE_CONTENT_TYPES,
  };
  const { data: existing, error: readError } = await supabaseAdmin.storage.getBucket(bucketName);
  if (readError && !/not found|does not exist/i.test(readError.message)) {
    throw new Error(`Storage bucket check failed: ${readError.message}`);
  }

  if (!existing) {
    const { error } = await supabaseAdmin.storage.createBucket(bucketName, bucketSettings);
    if (error && !/already exists|duplicate/i.test(error.message)) {
      throw new Error(`Storage bucket check failed: ${error.message}`);
    }
    return;
  }

  const allowedMimeTypes = [...(existing.allowed_mime_types ?? [])].sort();
  const expectedMimeTypes = [...PRODUCT_IMAGE_CONTENT_TYPES].sort();
  if (
    existing.public !== isPublic
    || existing.file_size_limit !== MAX_PRODUCT_IMAGE_SIZE_BYTES
    || allowedMimeTypes.join(",") !== expectedMimeTypes.join(",")
  ) {
    const { error } = await supabaseAdmin.storage.updateBucket(bucketName, bucketSettings);
    if (error) {
      throw new Error(`Storage bucket update failed: ${error.message}`);
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

export async function storageCreateSignedUpload(
  relKey: string,
): Promise<{ bucket: string; key: string; token: string; url: string }> {
  assertConfigured();

  const options = normalizeBucketOptions(undefined, true);
  await ensureBucket(options.bucket, options.public);
  const key = appendHashSuffix(normalizeKey(relKey));
  const { data, error } = await supabaseAdmin.storage
    .from(options.bucket)
    .createSignedUploadUrl(key, { upsert: false });

  if (error || !data?.token) {
    throw new Error(`Storage upload authorization failed: ${error?.message ?? "no upload token returned"}`);
  }

  return {
    bucket: options.bucket,
    key,
    token: data.token,
    url: await publicUrl(options.bucket, key),
  };
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
  const key = normalizeKey(relKey);
  return signedUrl(options.bucket, key, options.expiresIn);
}