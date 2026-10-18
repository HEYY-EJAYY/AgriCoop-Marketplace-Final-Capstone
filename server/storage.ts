// Supabase Storage helpers (replaces the Manus Forge/S3 storage layer).
// Uploads go through the server using the service-role key, so that key
// never reaches the browser. Files are stored in a public bucket.

import { supabaseAdmin } from "./clients";

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";

let bucketReady = false;

function assertConfigured() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Storage config missing: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }
}

async function ensureBucket() {
  if (bucketReady) return;
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: true });
  // "already exists" is fine; anything else is a real problem.
  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw new Error(`Storage bucket check failed: ${error.message}`);
  }
  bucketReady = true;
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

function publicUrl(key: string): string {
  return supabaseAdmin.storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  assertConfigured();
  await ensureBucket();

  const key = appendHashSuffix(normalizeKey(relKey));
  const body = typeof data === "string" ? Buffer.from(data) : data;

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(key, body, { contentType, upsert: false });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  return { key, url: publicUrl(key) };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: publicUrl(key) };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  assertConfigured();
  const key = normalizeKey(relKey);
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(key, 3600);
  if (error || !data?.signedUrl) {
    throw new Error(`Storage signed URL failed: ${error?.message ?? "no URL returned"}`);
  }
  return data.signedUrl;
}