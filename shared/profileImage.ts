/** Max size after client-side compression for profile avatars. */
export const MAX_PROFILE_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;

export const PROFILE_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ProfileImageContentType = (typeof PROFILE_IMAGE_CONTENT_TYPES)[number];

export function isProfileImageSizeAllowed(size: number) {
  return size > 0 && size <= MAX_PROFILE_IMAGE_SIZE_BYTES;
}

export function isProfileImageContentType(type: string): type is ProfileImageContentType {
  return (PROFILE_IMAGE_CONTENT_TYPES as readonly string[]).includes(type);
}
