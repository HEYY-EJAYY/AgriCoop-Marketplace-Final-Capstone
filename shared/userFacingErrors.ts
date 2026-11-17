/** Strip internal SQL / driver detail from messages shown in the UI. */
export function toUserFacingErrorMessage(
  message: string | null | undefined,
  fallback = "Something went wrong. Please try again.",
): string {
  const raw = (message ?? "").trim();
  if (!raw) return fallback;
  if (/^Failed query:/i.test(raw)) {
    return "We could not load this data right now. Please try again.";
  }
  if (/select\s+.+\s+from\s+/i.test(raw) || /agricoop_app\./i.test(raw)) {
    return "We could not load this data right now. Please try again.";
  }
  if (raw.length > 280) return fallback;
  return raw;
}
