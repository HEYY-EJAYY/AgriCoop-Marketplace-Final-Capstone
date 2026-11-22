import { trpc } from "@/lib/trpc";

export type PendingCounts = {
  unreadNotifications: number;
  unreadMessages: number;
  unreadTickets: number;
  pending: {
    activeOrders: number;
    awaitingVerification: number;
    ordersToReview: number;
    awaitingSellerConfirmation: number;
    paymentsToReview: number;
    openTickets: number;
    newOrders: number;
    awaitingMyResponse: number;
    requestedQuotations: number;
    productsPendingReview: number;
    cooperativeApplications: number;
    profileVerifications: number;
    userApprovals: number;
    buyers: number;
    sellers: number;
    associationRequests: number;
    productReviews: number;
    paymentReviews: number;
  };
};

const EMPTY: PendingCounts = {
  unreadNotifications: 0,
  unreadMessages: 0,
  unreadTickets: 0,
  pending: {
    activeOrders: 0, awaitingVerification: 0, ordersToReview: 0, awaitingSellerConfirmation: 0,
    paymentsToReview: 0, openTickets: 0, newOrders: 0, awaitingMyResponse: 0, requestedQuotations: 0,
    productsPendingReview: 0, cooperativeApplications: 0, profileVerifications: 0, userApprovals: 0,
    buyers: 0, sellers: 0, associationRequests: 0, productReviews: 0, paymentReviews: 0,
  },
};

/** Role-scoped pending activity counts; invalidated by RealtimeInvalidator. */
export function usePendingCounts(enabled = true) {
  const query = trpc.notifications.pendingCounts.useQuery(undefined, {
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  return { counts: query.data ?? EMPTY, isLoading: query.isLoading };
}

function put(map: Record<string, number>, key: string, value: number) {
  if (value > 0) map[key] = (map[key] ?? 0) + value;
}

/** Badge counts keyed by center-nav href (top header + mobile menu). */
export function centerNavBadges(counts: PendingCounts, role: string | null | undefined): Record<string, number> {
  const p = counts.pending;
  const map: Record<string, number> = {};
  if (counts.unreadMessages) put(map, "/messages", counts.unreadMessages);
  if (counts.unreadTickets) {
    put(map, "/support", counts.unreadTickets);
    put(map, "/support-tickets", counts.unreadTickets);
  }
  if (role === "buyer") {
    put(map, "/activity", p.activeOrders + p.awaitingVerification);
  } else if (role === "seller") {
    put(map, "/dashboard", p.newOrders + p.awaitingMyResponse + p.requestedQuotations);
  } else if (role === "admin") {
    const total = p.buyers + p.sellers + p.associationRequests + p.ordersToReview
      + p.paymentReviews + p.openTickets + p.productReviews + p.profileVerifications;
    put(map, "/dashboard", total);
    put(map, "/support-tickets", p.openTickets);
  } else if (role === "superadmin") {
    const total = p.userApprovals + p.cooperativeApplications + p.productReviews
      + p.profileVerifications + p.associationRequests;
    put(map, "/dashboard", total);
  }
  return map;
}

/** Badge counts keyed by AdminShell sidebar item id. */
export function adminNavBadges(counts: PendingCounts, role: string | null | undefined): Record<string, number> {
  const p = counts.pending;
  const map: Record<string, number> = {};
  if (role === "admin") {
    put(map, "overview", p.associationRequests + p.profileVerifications);
    put(map, "buyers", p.buyers);
    put(map, "sellers", p.sellers);
    put(map, "orders", p.ordersToReview);
    put(map, "payments", p.paymentReviews);
    put(map, "products", p.productReviews);
    put(map, "support", p.openTickets);
  } else if (role === "superadmin") {
    put(map, "overview", p.profileVerifications + p.associationRequests);
    put(map, "users", p.userApprovals);
    put(map, "officer-admins", p.cooperativeApplications);
    put(map, "products", p.productReviews);
  }
  return map;
}

/** Badge counts keyed by MobileNavItem.key for the bottom nav. */
export function mobileNavBadges(counts: PendingCounts, role: string | null | undefined): Record<string, number> {
  const map = centerNavBadges(counts, role);
  const byKey: Record<string, number> = {};
  if (role === "buyer") {
    put(byKey, "orders", (map["/activity"] ?? 0));
  } else if (role === "seller") {
    put(byKey, "dashboard", map["/dashboard"] ?? 0);
    put(byKey, "messages", counts.unreadMessages);
  } else if (role === "admin" || role === "superadmin") {
    put(byKey, "dashboard", map["/dashboard"] ?? 0);
    put(byKey, "tickets", counts.pending.openTickets);
    put(byKey, "messages", counts.unreadMessages);
  }
  return byKey;
}
