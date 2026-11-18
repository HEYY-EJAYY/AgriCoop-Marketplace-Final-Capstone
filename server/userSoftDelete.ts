import type { AppRole } from "./authz";

const ACCOUNT_INACTIVE_MESSAGE =
  "This account is no longer active. Please contact an administrator.";

export function accountInactiveMessage() {
  return ACCOUNT_INACTIVE_MESSAGE;
}

/** SuperAdmin: buyer/seller/admin. Admin: buyer/seller only. Never SuperAdmin or self. */
export function canSoftDeleteTargetUser(
  actor: { id: number; role: AppRole },
  target: { id: number; role: AppRole },
) {
  if (actor.id === target.id) return false;
  if (target.role === "superadmin") return false;
  if (actor.role === "superadmin") {
    return target.role === "buyer" || target.role === "seller" || target.role === "admin";
  }
  if (actor.role === "admin") {
    return target.role === "buyer" || target.role === "seller";
  }
  return false;
}
