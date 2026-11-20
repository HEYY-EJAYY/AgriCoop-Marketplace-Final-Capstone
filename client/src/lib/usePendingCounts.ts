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
