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
  onlinePaymentQrPath?: string | null;
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

export function canAccessPaymentRecord(
  actor: Pick<OperationalUser, "id" | "role" | "cooperativeId">,
  payment: { buyerId: number; sellerId: number; cooperativeId: number | null },
) {
  if (actor.role === "superadmin") return true;
  if (actor.role === "buyer") return actor.id === payment.buyerId;
  if (actor.role === "seller") return actor.id === payment.sellerId;
  if (actor.role === "admin") {
    return actor.cooperativeId !== null
      && payment.cooperativeId !== null
      && actor.cooperativeId === payment.cooperativeId;
  }
  return false;
}

export function canVerifyPaymentRecord(
  actor: Pick<OperationalUser, "id" | "role" | "cooperativeId">,
  payment: { buyerId: number; sellerId: number; cooperativeId: number | null },
) {
  if (actor.id === payment.buyerId || actor.id === payment.sellerId) return false;
  if (actor.role === "superadmin") return true;
  if (actor.role !== "admin") return false;
  return actor.cooperativeId !== null
    && payment.cooperativeId !== null
    && actor.cooperativeId === payment.cooperativeId
}

export function canReviewPaymentProof(
  actor: Pick<OperationalUser, "id" | "role" | "cooperativeId">,
  order: { buyerId: number; sellerId: number; cooperativeId: number | null },
) {
  if (actor.role !== "admin" && actor.role !== "superadmin") return false;
  if (actor.id === order.buyerId || actor.id === order.sellerId) return false;
  if (actor.role === "superadmin") return true;
  return actor.cooperativeId !== null
    && order.cooperativeId !== null
    && actor.cooperativeId === order.cooperativeId;
}

export function canManagePaymentRecord(
  actor: Pick<OperationalUser, "id" | "role" | "cooperativeId">,
  payment: { buyerId: number; sellerId: number; cooperativeId: number | null },
) {
  return canAccessPaymentRecord(actor, payment) || canVerifyPaymentRecord(actor, payment);
}

export function canRecordCashReceipt(
  actor: Pick<OperationalUser, "id" | "role" | "cooperativeId">,
  payment: {
    buyerId: number;
    sellerId: number;
    cooperativeId: number | null;
    orderId: number;
    amountCents: number;
    paymentMethod: string;
    status: string;
  },
  order: {
    id: number;
    buyerId: number;
    sellerId: number;
    cooperativeId: number | null;
    totalCents: number;
    paymentMethod: string | null;
    paymentStatus: string;
    status: string;
  },
  transaction?: {
    orderId: number;
    buyerId: number;
    sellerId: number;
    amountCents: number;
    paymentMethod: string | null;
    status: string;
  },
) {
  return canManageCashReceipt(actor, payment)
    && isPaymentOrderConsistent(payment, order)
    && transaction !== undefined
    && isPaymentTransactionConsistent(payment, transaction)
    && (transaction.status === "recorded" || transaction.status === "payment_coordinated" || transaction.status === "pending")
    && payment.status === "pending"
    && order.status === "ready"
    && (order.paymentStatus === "pending" || order.paymentStatus === "F2F-pending-confirmation")
    && (payment.paymentMethod === "cash_pickup" || payment.paymentMethod === "cash_delivery");
}

export function isPaymentTransactionConsistent(
  payment: {
    buyerId: number;
    sellerId: number;
    orderId: number;
    amountCents: number;
    paymentMethod: string;
  },
  transaction: {
    orderId: number;
    buyerId: number;
    sellerId: number;
    amountCents: number;
    paymentMethod: string | null;
    status: string;
  },
) {
  return transaction.orderId === payment.orderId
    && transaction.buyerId === payment.buyerId
    && transaction.sellerId === payment.sellerId
    && transaction.amountCents === payment.amountCents
    && transaction.paymentMethod === payment.paymentMethod;
}

export function canManageCashReceipt(
  actor: Pick<OperationalUser, "id" | "role" | "cooperativeId">,
  payment: { buyerId: number; sellerId: number; cooperativeId: number | null },
) {
  if (actor.role === "seller") return actor.id === payment.sellerId;
  if (actor.id === payment.buyerId || actor.id === payment.sellerId) return false;
  if (actor.role === "superadmin") return true;
  return actor.role === "admin"
    && actor.cooperativeId !== null
    && payment.cooperativeId !== null
    && actor.cooperativeId === payment.cooperativeId;
}

export function isPaymentOrderConsistent(
  payment: {
    buyerId: number;
    sellerId: number;
    cooperativeId: number | null;
    orderId: number;
    amountCents: number;
    paymentMethod: string;
  },
  order: {
    id: number;
    buyerId: number;
    sellerId: number;
    cooperativeId: number | null;
    totalCents: number;
    paymentMethod: string | null;
  },
) {
  return payment.orderId === order.id
    && payment.buyerId === order.buyerId
    && payment.sellerId === order.sellerId
    && payment.cooperativeId === order.cooperativeId
    && Number.isSafeInteger(payment.amountCents)
    && payment.amountCents > 0
    && payment.amountCents === order.totalCents
    && payment.paymentMethod === order.paymentMethod;
}

export function canManageRefundRecord(
  actor: Pick<OperationalUser, "id" | "role" | "cooperativeId">,
  payment: { buyerId: number; sellerId: number; cooperativeId: number | null },
) {
  if (actor.id === payment.buyerId || actor.id === payment.sellerId) return false;
  if (actor.role === "superadmin") return true;
  return actor.role === "admin"
    && actor.cooperativeId !== null
    && payment.cooperativeId !== null
    && actor.cooperativeId === payment.cooperativeId;
}

export function canUpdateOrderStatus(
  actor: Pick<OperationalUser, "id" | "role" | "cooperativeId">,
  order: { sellerId: number; cooperativeId: number | null },
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
  orderCooperativeId: number | null,
) {
  if (actor.role === "superadmin") return true;
  if (actor.role !== "admin") return false;
  return actor.cooperativeId !== null && orderCooperativeId !== null && actor.cooperativeId === orderCooperativeId;
}

export function canManageCooperativeResource(
  actor: Pick<OperationalUser, "role" | "cooperativeId">,
  resourceCooperativeId: number | null,
) {
  return canAccessOrderForCooperative(actor, resourceCooperativeId);
}

export function adminOverviewCooperativeScope(actor: Pick<OperationalUser, "role" | "cooperativeId">) {
  return actor.role === "superadmin" ? undefined : actor.cooperativeId;
}

export function canUpdateCooperativeUser(
  actor: Pick<OperationalUser, "role" | "cooperativeId">,
  targetCooperativeId: number | null,
  requestedCooperativeId: number | null,
  requestedRole: AppRole,
  targetRole?: AppRole,
) {
  if (actor.role === "superadmin") return true;
  return actor.role === "admin"
    && actor.cooperativeId !== null
    && actor.cooperativeId === targetCooperativeId
    && actor.cooperativeId === requestedCooperativeId
    && targetRole !== "superadmin"
    && requestedRole !== "superadmin";
}

export function isSellerApproved(approvalStatus: OperationalUser["approvalStatus"] | undefined) {
  return approvalStatus === "approved";
}

export function canAccessConversation(
  actor: Pick<OperationalUser, "id" | "role" | "cooperativeId">,
  conversation: { buyerId: number; sellerId: number | null },
  sellerCooperativeId: number | null,
) {
  // Trade / order chats (seller assigned): participants only — officers do not read private buyer–seller threads.
  if (conversation.sellerId !== null && conversation.sellerId !== undefined) {
    return actor.id === conversation.buyerId || actor.id === conversation.sellerId;
  }
  // Platform support inquiries (no seller): requester + officers.
  if (actor.id === conversation.buyerId) return true;
  if (actor.role === "superadmin") return true;
  return actor.role === "admin" && (sellerCooperativeId === null || actor.cooperativeId === sellerCooperativeId);
}

export function canSubmitProfileVerification(user: Pick<OperationalUser, "role" | "verificationStatus">) {
  if (!hasRole(user.role, ["buyer", "seller"])) return false;
  return user.verificationStatus === "unverified" || user.verificationStatus === "rejected";
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
  if (user.role === "admin" && user.cooperativeId === null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "An Admin must be assigned to a cooperative before using operational features.",
    });
  }
  return user;
}
