export const USER_FACING_LOAD_ERROR = "We could not load this data right now. Please try again.";
export const USER_FACING_SAVE_ERROR = "We could not save your changes right now. Please try again.";

/** Strip internal SQL / driver detail from messages shown in the UI. */
export function toUserFacingErrorMessage(
  message: string | null | undefined,
  fallback = "Something went wrong. Please try again.",
): string {
  const raw = (message ?? "").trim();
  if (!raw) return fallback;
  if (/^Failed query:/i.test(raw)) {
    return USER_FACING_LOAD_ERROR;
  }
  if (/select\s+.+\s+from\s+/i.test(raw) || /agricoop_app\./i.test(raw)) {
    return fallback === USER_FACING_SAVE_ERROR ? USER_FACING_SAVE_ERROR : USER_FACING_LOAD_ERROR;
  }
  if (/permission denied|42501/i.test(raw)) {
    return fallback === USER_FACING_SAVE_ERROR
      ? "We could not save your listing. Your account may be missing listing permissions."
      : USER_FACING_LOAD_ERROR;
  }
  if (raw.length > 280) return fallback;
  return raw;
}
