import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getBucket: vi.fn(),
  createBucket: vi.fn(),
  updateBucket: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  getPublicUrl: vi.fn(),
  createSignedUrl: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  download: vi.fn(),
}));

vi.mock("./clients", () => ({
  supabaseAdmin: {
    storage: {
      getBucket: storageMocks.getBucket,
      createBucket: storageMocks.createBucket,
      updateBucket: storageMocks.updateBucket,
      from: () => ({
        upload: storageMocks.upload,
        remove: storageMocks.remove,
        getPublicUrl: storageMocks.getPublicUrl,
        createSignedUrl: storageMocks.createSignedUrl,
        createSignedUploadUrl: storageMocks.createSignedUploadUrl,
        download: storageMocks.download,
      }),
    },
  },
}));

import { isStorageKeyWithinPrefix, isStoragePublicUrlWithinPrefix, storageCreateSignedUploadUrl, storageDeleteObject, storageDeletePublicUrl, storageDownloadPrivateObject, storageDownloadPrivateProof, storageGetSignedUrl, storagePut } from "./storage";
import { PROFILE_VERIFICATION_BUCKET } from "../shared/profileVerification";

const privateProofBucket = {
  public: false,
  file_size_limit: 5 * 1024 * 1024,
  allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
};

describe("Supabase Storage upload setup", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
    storageMocks.getBucket.mockReset();
    storageMocks.createBucket.mockReset();
    storageMocks.updateBucket.mockReset();
    storageMocks.upload.mockReset();
    storageMocks.remove.mockReset();
    storageMocks.getPublicUrl.mockReset();
    storageMocks.createSignedUrl.mockReset();
    storageMocks.createSignedUploadUrl.mockReset();
    storageMocks.download.mockReset();
  });

  it("creates a signed upload capability only for the correctly restricted private proof bucket", async () => {
    storageMocks.getBucket.mockResolvedValue({ data: privateProofBucket, error: null });
    storageMocks.createSignedUploadUrl.mockResolvedValue({
      data: { path: "payment-proofs/7/19/receipt.png", token: "upload-token", signedUrl: "https://storage.test/upload" },
      error: null,
    });

    await expect(storageCreateSignedUploadUrl("payment-proofs/7/19/receipt.png"))
      .resolves.toEqual({ path: "payment-proofs/7/19/receipt.png", token: "upload-token" });
    expect(storageMocks.createSignedUploadUrl).toHaveBeenCalledWith(
      "payment-proofs/7/19/receipt.png",
      { upsert: false },
    );

    storageMocks.getBucket.mockResolvedValueOnce({ data: { ...privateProofBucket, file_size_limit: 3 * 1024 * 1024 }, error: null });
    await expect(storageCreateSignedUploadUrl("payment-proofs/7/19/other.png"))
      .rejects.toThrow("unexpected size or MIME restrictions");
  });

  it("downloads proof bytes only from the verified private bucket", async () => {
    storageMocks.getBucket.mockResolvedValue({ data: privateProofBucket, error: null });
    storageMocks.download.mockResolvedValue({ data: new Blob([Buffer.from("proof")]), error: null });

    await expect(storageDownloadPrivateProof("payment-proofs/7/19/receipt.png"))
      .resolves.toEqual(Buffer.from("proof"));
    expect(storageMocks.download).toHaveBeenCalledWith("payment-proofs/7/19/receipt.png");
  });

  it("creates verification upload capabilities only for the restricted private verification bucket", async () => {
    storageMocks.getBucket.mockResolvedValue({ data: privateProofBucket, error: null });
    storageMocks.createSignedUploadUrl.mockResolvedValue({
      data: { path: `${PROFILE_VERIFICATION_BUCKET}/7/550e8400-e29b-41d4-a716-446655440000.png`, token: "upload-token" },
      error: null,
    });

    await expect(storageCreateSignedUploadUrl(
      `${PROFILE_VERIFICATION_BUCKET}/7/550e8400-e29b-41d4-a716-446655440000.png`,
      PROFILE_VERIFICATION_BUCKET,
    )).resolves.toMatchObject({ token: "upload-token" });
    expect(storageMocks.getBucket).toHaveBeenCalledWith(PROFILE_VERIFICATION_BUCKET);

    storageMocks.getBucket.mockResolvedValueOnce({ data: { ...privateProofBucket, public: true }, error: null });
    await expect(storageCreateSignedUploadUrl(
      `${PROFILE_VERIFICATION_BUCKET}/7/550e8400-e29b-41d4-a716-446655440001.png`,
      PROFILE_VERIFICATION_BUCKET,
    )).rejects.toThrow("unexpected visibility configuration");
  });

  it("downloads verification evidence only from the correctly configured private bucket", async () => {
    storageMocks.getBucket.mockResolvedValue({ data: privateProofBucket, error: null });
    storageMocks.download.mockResolvedValue({ data: new Blob([Buffer.from("proof")]), error: null });

    await expect(storageDownloadPrivateObject(
      `${PROFILE_VERIFICATION_BUCKET}/7/550e8400-e29b-41d4-a716-446655440000.png`,
      PROFILE_VERIFICATION_BUCKET,
    )).resolves.toEqual(Buffer.from("proof"));
    expect(storageMocks.download).toHaveBeenCalledWith(`${PROFILE_VERIFICATION_BUCKET}/7/550e8400-e29b-41d4-a716-446655440000.png`);
  });

  it("uses an existing correctly configured bucket without mutating bucket settings", async () => {
    storageMocks.getBucket.mockResolvedValue({ data: { ...privateProofBucket, public: true }, error: null });
    storageMocks.upload.mockResolvedValue({ error: null });
    storageMocks.getPublicUrl.mockReturnValue({ data: { publicUrl: "https://storage.test/image.png" } });

    await expect(storagePut("products/1/image.png", Buffer.from("image"), "image/png"))
      .resolves.toMatchObject({ url: "https://storage.test/image.png" });

    expect(storageMocks.createBucket).not.toHaveBeenCalled();
    expect(storageMocks.updateBucket).not.toHaveBeenCalled();
  });

  it("fails explicitly when a bucket is missing instead of creating it", async () => {
    storageMocks.getBucket.mockResolvedValue({ data: null, error: { message: "Bucket not found" } });

    await expect(storagePut("products/1/image.png", Buffer.from("image"), "image/png"))
      .rejects.toThrow("is not configured");

    expect(storageMocks.createBucket).not.toHaveBeenCalled();
    expect(storageMocks.updateBucket).not.toHaveBeenCalled();
  });

  it("rejects a bucket with unexpected visibility instead of changing it", async () => {
    storageMocks.getBucket.mockResolvedValue({ data: privateProofBucket, error: null });

    await expect(storagePut("products/1/image.png", Buffer.from("image"), "image/png"))
      .rejects.toThrow("unexpected visibility configuration");

    expect(storageMocks.createBucket).not.toHaveBeenCalled();
    expect(storageMocks.updateBucket).not.toHaveBeenCalled();
  });

  it("creates private signed URLs only after confirming the bucket is private", async () => {
    storageMocks.getBucket.mockResolvedValue({ data: privateProofBucket, error: null });
    storageMocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.test/private-proof" },
      error: null,
    });

    await expect(storageGetSignedUrl(
      "7/19/receipt.png",
      { bucket: "payment-proofs", public: false },
    )).resolves.toBe("https://storage.test/private-proof");

    expect(storageMocks.getBucket).toHaveBeenCalledWith("payment-proofs");
    expect(storageMocks.createSignedUrl).toHaveBeenCalledWith("7/19/receipt.png", 300);
  });

  it("refuses to create a signed payment-proof URL when the bucket is public", async () => {
    storageMocks.getBucket.mockResolvedValue({ data: { public: true }, error: null });

    await expect(storageGetSignedUrl(
      "7/19/receipt.png",
      { bucket: "payment-proofs", public: false },
    )).rejects.toThrow("unexpected visibility configuration");

    expect(storageMocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it("deletes only public objects within the caller's allowed key prefix", async () => {
    storageMocks.getBucket.mockResolvedValue({ data: { public: true }, error: null });
    storageMocks.remove.mockResolvedValue({ error: null });
    const url = "https://storage.test/storage/v1/object/public/product-images/payment-options/cooperative-2/qr.png";

    await expect(storageDeletePublicUrl(
      url,
      "payment-options/cooperative-2/",
    )).resolves.toBe(true);

    expect(storageMocks.remove).toHaveBeenCalledWith([
      "payment-options/cooperative-2/qr.png",
    ]);
  });

  it("deletes private evidence only under the caller's buyer/order path", async () => {
    storageMocks.getBucket.mockResolvedValue({ data: privateProofBucket, error: null });
    storageMocks.remove.mockResolvedValue({ error: null });

    await expect(storageDeleteObject(
      "payment-proofs/7/19/receipt.png",
      "payment-proofs/7/19/",
      { bucket: "payment-proofs", public: false },
    )).resolves.toBe(true);

    await expect(storageDeleteObject(
      "payment-proofs/8/19/receipt.png",
      "payment-proofs/7/19/",
      { bucket: "payment-proofs", public: false },
    )).resolves.toBe(false);

    expect(storageMocks.remove).toHaveBeenCalledTimes(1);
    expect(storageMocks.remove).toHaveBeenCalledWith(["payment-proofs/7/19/receipt.png"]);
  });

  it("recognizes only same-project public URLs under the designated owner prefix", () => {
    expect(isStoragePublicUrlWithinPrefix(
      "https://storage.test/storage/v1/object/public/product-images/payment-options/cooperative-2/qr.png",
      "payment-options/cooperative-2/",
    )).toBe(true);
    expect(isStoragePublicUrlWithinPrefix(
      "https://storage.test/storage/v1/object/public/product-images/payment-options/cooperative-3/qr.png",
      "payment-options/cooperative-2/",
    )).toBe(false);
    expect(isStoragePublicUrlWithinPrefix(
      "https://other.test/storage/v1/object/public/product-images/payment-options/cooperative-2/qr.png",
      "payment-options/cooperative-2/",
    )).toBe(false);
    expect(isStorageKeyWithinPrefix(
      "payment-proofs/7/19/receipt.png",
      "payment-proofs/7/19/",
    )).toBe(true);
    expect(isStorageKeyWithinPrefix(
      "payment-proofs/7/20/receipt.png",
      "payment-proofs/7/19/",
    )).toBe(false);
  });

  it("does not delete an object outside the allowed key prefix or Supabase project", async () => {
    await expect(storageDeletePublicUrl(
      "https://storage.test/storage/v1/object/public/product-images/products/1/image.png",
      "payment-options/cooperative-2/",
    )).resolves.toBe(false);
    await expect(storageDeletePublicUrl(
      "https://other.test/storage/v1/object/public/product-images/payment-options/cooperative-2/qr.png",
      "payment-options/cooperative-2/",
    )).resolves.toBe(false);
    await expect(storageDeletePublicUrl(
      "https://storage.test/storage/v1/object/public/product-images/payment-options/cooperative-2/../../products/1/image.png",
      "payment-options/cooperative-2/",
    )).resolves.toBe(false);

    expect(storageMocks.remove).not.toHaveBeenCalled();
  });
});
