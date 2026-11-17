export type EmailVerificationReturn = "none" | "success" | "expired";

export function getEmailVerificationReturn(search: string, hash: string): EmailVerificationReturn {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const type = query.get("type") ?? fragment.get("type");
  if (type === "recovery") return "none";

  const errorCode = query.get("error_code") ?? fragment.get("error_code");
  const error = query.get("error") ?? fragment.get("error");
  if (errorCode || error) return "expired";
  if (query.get("verification") === "success" || type === "signup") return "success";
  return "none";
}
