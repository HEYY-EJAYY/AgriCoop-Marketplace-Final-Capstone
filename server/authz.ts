import { TRPCError } from "@trpc/server";

export const APP_ROLES = ["buyer", "seller", "admin", "superadmin"] as const;
export type AppRole = (typeof APP_ROLES)[number];

type VerificationStatus = "unverified" | "pending" | "approved" | "rejected";

type OperationalUser = {
  id: number;
  role: AppRole;
  approvalStatus: "approved" | "pending" | "suspended";
  verificationStatus?: VerificationStatus;
  cooperativeId: number | null;
};

export function hasRole(role: string, allowed: readonly AppRole[]) {
  return allowed.some(allowedRole => allowedRole === role);
}

export function canManageSellerOrder(
  actor: Pick<OperationalUser, "id" | "role">,
  sellerId: number,
) {
  return actor.role === "admin" || actor.role === "superadmin" || (actor.role === "seller" && actor.id === sellerId);
}

export function canAccessOrderForCooperative(
  actor: Pick<OperationalUser, "role" | "cooperativeId">,
  orderCooperativeId: number | null,
) {
  if (actor.role === "superadmin") return true;
  if (actor.role !== "admin") return false;
  return actor.cooperativeId !== null && orderCooperativeId !== null && actor.cooperativeId === orderCooperativeId;
}

export function canSubmitProfileVerification(user: Pick<OperationalUser, "role" | "verificationStatus">) {
  if (!hasRole(user.role, ["buyer", "seller", "admin"])) return false;
  return user.verificationStatus !== "approved";
}

export function requireOperationalRole(user: OperationalUser | null, allowed: readonly AppRole[]) {
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
