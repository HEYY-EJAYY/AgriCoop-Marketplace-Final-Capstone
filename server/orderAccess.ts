import type { AppRole } from "./authz";
import { isPaymentSettled } from "../shared/paymentMethods";

export type OrderAccessActor = {
  id: number;
  role: AppRole | string;
};

export function canViewOrder(
  actor: OrderAccessActor,
  order: { buyerId: number; sellerId: number },
): boolean {
  if (actor.role === "superadmin" || actor.role === "admin") return true;
  return actor.id === order.buyerId || actor.id === order.sellerId;
}

export function assertOrderPaidBeforeComplete(paymentStatus: string | null | undefined) {
  if (!isPaymentSettled(paymentStatus)) {
    throw new Error("Payment must be marked paid before this order can be completed.");
  }
}

export function isOnlinePaymentMethod(method: string | null | undefined): boolean {
  return method === "online" || method === "gcash";
}

/** Payment proof review is Admin / SuperAdmin only (sellers are read-only). */
export function canReviewOrderPaymentProof(
  actor: OrderAccessActor,
  order: { sellerId: number; cooperativeId: number | null },
  actorCooperativeId: number | null,
): boolean {
  if (actor.role === "superadmin") return true;
  if (actor.role === "admin" && actorCooperativeId !== null && order.cooperativeId === actorCooperativeId) {
    return true;
  }
  return false;
}

