import {
  isProfileImageContentType,
  isProfileImageSizeAllowed,
  MAX_PROFILE_IMAGE_SIZE_BYTES,
  type ProfileImageContentType,
} from "@shared/profileImage";

const MAX_EDGE = 512;

export { isProfileImageContentType, isProfileImageSizeAllowed, MAX_PROFILE_IMAGE_SIZE_BYTES };
export type { ProfileImageContentType };

/** Client-side resize/compress before upload. Rejects if still over 2 MB. */
export async function prepareProfileImage(file: File): Promise<{
  blob: Blob;
  contentType: ProfileImageContentType;
  fileName: string;
  previewUrl: string;
}> {
  if (!isProfileImageContentType(file.type)) {
    throw new Error("Use a JPEG, PNG, or WebP image.");
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare the image for upload.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const contentType: ProfileImageContentType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      result => (result ? resolve(result) : reject(new Error("Could not compress the image."))),
      contentType,
      0.85,
    );
  });

  if (!isProfileImageSizeAllowed(blob.size)) {
    throw new Error("Profile photos must be 2 MB or less after compression.");
  }

  const ext = contentType === "image/png" ? "png" : "jpg";
  return {
    blob,
    contentType,
    fileName: `avatar.${ext}`,
    previewUrl: URL.createObjectURL(blob),
  };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}
