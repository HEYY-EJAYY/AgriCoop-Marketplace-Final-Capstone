import { TRPCError } from "@trpc/server";

export const APP_ROLES = ["buyer", "seller", "officer", "admin"] as const;
export type AppRole = (typeof APP_ROLES)[number];

type OperationalUser = {
  id: number;
  role: AppRole | "user";
  approvalStatus: "approved" | "pending" | "suspended";
  cooperativeId: number | null;
};

export function hasRole(role: string, allowed: readonly AppRole[]) {
  return allowed.some(allowedRole => allowedRole === role);
}

export function canManageSellerOrder(
  actor: Pick<OperationalUser, "id" | "role">,
  sellerId: number,
) {
  return actor.role === "admin" || (actor.role === "seller" && actor.id === sellerId);
}

export function requireOperationalRole(user: OperationalUser | null, allowed: readonly AppRole[]) {
  if (!user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Please sign in to continue." });
  }
  if (!hasRole(user.role, allowed)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Your AgriCoop role cannot access this area." });
  }
  if (user.role !== "admin" && user.approvalStatus !== "approved") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your role registration is pending cooperative approval.",
    });
  }
  return user;
}
