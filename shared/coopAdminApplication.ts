export const COOP_ADMIN_APPLICATION_BUCKET = "coop-admin-applications";
export const COOP_ADMIN_APPLICATION_MAX_BYTES = 5 * 1024 * 1024;
export const COOP_ADMIN_APPLICATION_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

export const COOP_ADMIN_APPLICATION_STATUSES = [
  "awaiting_documents",
  "pending",
  "approved",
  "rejected",
] as const;

export type CoopAdminApplicationStatus = (typeof COOP_ADMIN_APPLICATION_STATUSES)[number];
export type CoopAdminApplicationContentType = (typeof COOP_ADMIN_APPLICATION_CONTENT_TYPES)[number];
