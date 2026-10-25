import { TRPCError } from "@trpc/server";

export const APP_ROLES = ["buyer", "seller", "admin", "superadmin"] as const;
export type AppRole = (typeof APP_ROLES)[number];

type VerificationStatus = "unverified" | "pending" | "approved" | "rejected";

type OperationalUser = {
  id: string | number;
  role: AppRole;
  approvalStatus: "approved" | "pending" | "suspended";
  verificationStatus?: VerificationStatus;
  cooperativeId: string | number | null;
};

export function hasRole(role: string, allowed: readonly AppRole[]) {
  return allowed.some(allowedRole => allowedRole === role);
}

export function canManageSellerOrder(
  actor: Pick<OperationalUser, "id" | "role">,
  sellerId: string | number,
) {
  return actor.role === "admin" || actor.role === "superadmin" || (actor.role === "seller" && actor.id === sellerId);
}

export function canUpdateOrderStatus(
  actor: Pick<OperationalUser, "id" | "role" | "cooperativeId">,
  order: { sellerId: string | number; cooperativeId: string | number | null },
  nextStatus: "confirmed" | "ready" | "completed" | "cancelled",
) {
  if (actor.role === "superadmin") return true;
  if (actor.role === "admin") {
    return canAccessOrderForCooperative(actor, order.cooperativeId);
  }
  return actor.role === "seller"
    && actor.id === order.sellerId
    && (nextStatus === "confirmed" || nextStatus === "ready");
}

export function canAccessOrderForCooperative(
  actor: Pick<OperationalUser, "role" | "cooperativeId">,
  orderCooperativeId: string | number | null,
) {
  if (actor.role === "superadmin") return true;
  if (actor.role !== "admin") return false;
  return actor.cooperativeId !== null && orderCooperativeId !== null && actor.cooperativeId === orderCooperativeId;
}

export function canManageCooperativeResource(
  actor: Pick<OperationalUser, "role" | "cooperativeId">,
  resourceCooperativeId: string | number | null,
) {
  return canAccessOrderForCooperative(actor, resourceCooperativeId);
}

export function adminOverviewCooperativeScope<T extends Pick<OperationalUser, "role" | "cooperativeId">>(actor: T): T["cooperativeId"] | undefined {
  return actor.role === "superadmin" ? undefined : actor.cooperativeId;
}

export function canUpdateCooperativeUser(
  actor: Pick<OperationalUser, "role" | "cooperativeId">,
  targetCooperativeId: string | number | null,
  requestedCooperativeId: string | number | null,
  requestedRole: AppRole,
) {
  if (actor.role === "superadmin") return true;
  return actor.role === "admin"
    && actor.cooperativeId !== null
    && actor.cooperativeId === targetCooperativeId
    && actor.cooperativeId === requestedCooperativeId
    && requestedRole !== "superadmin";
}

export function isSellerApproved(approvalStatus: OperationalUser["approvalStatus"] | undefined) {
  return approvalStatus === "approved";
}

export function canAccessConversation(
  actor: Pick<OperationalUser, "id" | "role" | "cooperativeId">,
  conversation: { buyerId: string | number; sellerId: string | number | null },
  sellerCooperativeId: string | number | null,
) {
  if (actor.role === "superadmin" || actor.id === conversation.buyerId || actor.id === conversation.sellerId) return true;
  return actor.role === "admin" && actor.cooperativeId !== null && actor.cooperativeId === sellerCooperativeId;
}

export function canSubmitProfileVerification(user: Pick<OperationalUser, "role" | "verificationStatus">) {
  if (!hasRole(user.role, ["buyer", "seller", "admin"])) return false;
  return user.verificationStatus !== "approved";
}

export function requireOperationalRole<T extends OperationalUser>(user: T | null, allowed: readonly AppRole[]): T {
  if (!user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Please sign in to continue." });
  }
  if (!hasRole(user.role, allowed)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Your AgriCoop role cannot access this area." });
  }
  if (user.role !== "superadmin") {
    if (user.approvalStatus === "suspended") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Your AgriCoop account has been suspended.",
      });
    }
    if (user.approvalStatus !== "approved") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Your role registration is pending cooperative approval.",
      });
    }
  }
  return user;
}
