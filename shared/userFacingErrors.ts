export const USER_FACING_LOAD_ERROR = "We could not load this data right now. Please try again.";
export const USER_FACING_SAVE_ERROR = "We could not save your changes right now. Please try again.";
export const USER_FACING_DELETE_USER_ERROR = "We couldn't delete that user. Please try again.";
export const USER_FACING_DELETE_COOPERATIVE_ERROR = "We couldn't delete that cooperative. Please try again.";

/** Strip internal SQL / driver detail from messages shown in the UI. */
export function toUserFacingErrorMessage(
  message: string | null | undefined,
  fallback = USER_FACING_LOAD_ERROR,
): string {
  const raw = (message ?? "").trim();
  if (!raw) return fallback;
  if (raw === USER_FACING_LOAD_ERROR && fallback !== USER_FACING_LOAD_ERROR) return fallback;
  if (/^Failed query:/i.test(raw)) {
    return fallback;
  }
  if (/select\s+.+\s+from\s+/i.test(raw) || /agricoop_app\./i.test(raw)) {
    return fallback;
  }
  if (/permission denied|42501/i.test(raw)) {
    return fallback === USER_FACING_SAVE_ERROR
      ? "We could not save your listing. Your account may be missing listing permissions."
      : fallback;
  }
  if (raw.length > 280) return fallback;
  return raw;
}

export function mutationFailureFallback(path: string | undefined, input: unknown, reference: string) {
  const action = input && typeof input === "object" && "action" in input
    ? input.action
    : undefined;
  if ((path === "orders.updateArchive" || path === "orders.sellerUpdateArchive") && action === "delete") {
    return `We couldn't delete that order. Please try again. (ref: ${reference})`;
  }
  if (path === "quotations.updateState" && action === "delete") {
    return `We couldn't delete that quotation request. Please try again. (ref: ${reference})`;
  }
  if (path === "admin.softDeleteUser") {
    return `${USER_FACING_DELETE_USER_ERROR} (ref: ${reference})`;
  }
  if (path === "cooperatives.softDelete") {
    return `${USER_FACING_DELETE_COOPERATIVE_ERROR} (ref: ${reference})`;
  }
  return `We couldn't save your changes. Please try again. (ref: ${reference})`;
}
