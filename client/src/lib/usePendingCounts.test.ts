import { describe, expect, it } from "vitest";
import { adminNavBadges, centerNavBadges, mobileNavBadges, type PendingCounts } from "./usePendingCounts";

const counts = (pending: Partial<PendingCounts["pending"]>, top: Partial<Pick<PendingCounts, "unreadNotifications" | "unreadMessages" | "unreadTickets">> = {}): PendingCounts => ({
  unreadNotifications: 0,
  unreadMessages: 0,
  unreadTickets: 0,
  ...top,
  pending: {
    activeOrders: 0, awaitingVerification: 0, ordersToReview: 0, awaitingSellerConfirmation: 0,
    paymentsToReview: 0, openTickets: 0, newOrders: 0, awaitingMyResponse: 0, requestedQuotations: 0,
    productsPendingReview: 0, cooperativeApplications: 0, profileVerifications: 0, userApprovals: 0,
    buyers: 0, sellers: 0, associationRequests: 0, productReviews: 0, paymentReviews: 0,
    ...pending,
  },
});

describe("adminNavBadges", () => {
  it("maps OfficerAdmin pending counts to sidebar item ids", () => {
    const badges = adminNavBadges(counts({
      ordersToReview: 3, paymentReviews: 1, openTickets: 2, productReviews: 4,
      buyers: 1, sellers: 2, associationRequests: 1, profileVerifications: 1,
    }), "admin");
    expect(badges).toEqual({
      overview: 2, buyers: 1, sellers: 2, orders: 3, payments: 1,
      products: 4, support: 2,
    });
  });

  it("maps SuperAdmin pending counts to sidebar item ids without cooperative scoping keys", () => {
    const badges = adminNavBadges(counts({
      userApprovals: 5, cooperativeApplications: 2, productReviews: 3,
      profileVerifications: 1, associationRequests: 4, ordersToReview: 9,
    }), "superadmin");
    expect(badges).toEqual({
      overview: 5, users: 5, "officer-admins": 2, products: 3,
    });
    expect(badges.orders).toBeUndefined();
  });

  it("returns an empty map when all counts are zero", () => {
    expect(adminNavBadges(counts({}), "admin")).toEqual({});
    expect(adminNavBadges(counts({}), "superadmin")).toEqual({});
  });

  it("returns an empty map for non-admin roles", () => {
    expect(adminNavBadges(counts({ ordersToReview: 3 }), "buyer")).toEqual({});
    expect(adminNavBadges(counts({ ordersToReview: 3 }), "seller")).toEqual({});
    expect(adminNavBadges(counts({ ordersToReview: 3 }), null)).toEqual({});
  });
});

describe("centerNavBadges / mobileNavBadges admin paths", () => {
  it("aggregates OfficerAdmin counts onto /dashboard and /support-tickets", () => {
    const map = centerNavBadges(counts({
      buyers: 1, sellers: 1, associationRequests: 1, ordersToReview: 2,
      paymentReviews: 1, openTickets: 3, productReviews: 1, profileVerifications: 1,
    }), "admin");
    expect(map["/dashboard"]).toBe(11);
    expect(map["/support-tickets"]).toBe(3);
  });

  it("aggregates SuperAdmin counts onto /dashboard", () => {
    const map = centerNavBadges(counts({
      userApprovals: 2, cooperativeApplications: 1, productReviews: 3,
      profileVerifications: 1, associationRequests: 2,
    }), "superadmin");
    expect(map["/dashboard"]).toBe(9);
  });

  it("mobile nav surfaces dashboard, tickets, and messages for admins", () => {
    const map = mobileNavBadges(counts({ openTickets: 4 }, { unreadMessages: 2 }), "admin");
    expect(map.dashboard).toBeGreaterThan(0);
    expect(map.tickets).toBe(4);
    expect(map.messages).toBe(2);
  });
});
