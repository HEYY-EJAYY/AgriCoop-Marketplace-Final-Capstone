import { describe, expect, it } from "vitest";
import { getAccountAccessRestriction } from "../shared/accountAccess";
import { adminOverviewCooperativeScope, canAccessConversation, canAccessOrderForCooperative, canManageCooperativeResource, canManageRefundRecord, canManageSellerOrder, canRecordCashReceipt, canSubmitProfileVerification, canUpdateCooperativeUser, canUpdateOrderStatus, hasRole, isSellerApproved, requireOperationalRole } from "./authz";

describe("AgriCoop role authorization", () => {
  it("admits only explicitly allowed marketplace roles", () => {
    expect(hasRole("buyer", ["buyer"])).toBe(true);
    expect(hasRole("buyer", ["seller", "admin"])).toBe(false);
    expect(hasRole("seller", ["buyer", "seller"])).toBe(true);
    expect(hasRole("superadmin", ["buyer", "seller"])).toBe(false);
    expect(hasRole("admin", ["admin"])).toBe(true);
  });

  it("allows a seller only to manage their own orders, while admins retain oversight", () => {
    expect(canManageSellerOrder({ id: 9, role: "seller" }, 9)).toBe(true);
    expect(canManageSellerOrder({ id: 9, role: "seller" }, 10)).toBe(false);
    expect(canManageSellerOrder({ id: 1, role: "admin" }, 10)).toBe(true);
    expect(canManageSellerOrder({ id: 1, role: "superadmin" }, 10)).toBe(true);
  });

  it("lets in-scope staff record only a matching pending cash receipt", () => {
    const payment = {
      buyerId: 10,
      sellerId: 20,
      cooperativeId: 2,
      orderId: 5,
      amountCents: 5000,
      paymentMethod: "cash_pickup",
      status: "pending",
    };
    const order = {
      id: 5,
      buyerId: 10,
      sellerId: 20,
      cooperativeId: 2,
      totalCents: 5000,
      paymentMethod: "cash_pickup",
      paymentStatus: "pending",
      status: "ready",
    };
    const transaction = {
      orderId: 5,
      buyerId: 10,
      sellerId: 20,
      amountCents: 5000,
      paymentMethod: "cash_pickup",
      status: "payment_coordinated",
    };

    expect(canRecordCashReceipt({ id: 20, role: "seller", cooperativeId: 2 }, payment, order, transaction)).toBe(false);
    expect(canRecordCashReceipt({ id: 30, role: "admin", cooperativeId: 2 }, payment, order, transaction)).toBe(true);
    expect(canRecordCashReceipt({ id: 31, role: "admin", cooperativeId: 3 }, payment, order, transaction)).toBe(false);
    expect(canRecordCashReceipt({ id: 1, role: "superadmin", cooperativeId: null }, payment, order, transaction)).toBe(true);
    expect(canRecordCashReceipt({ id: 21, role: "seller", cooperativeId: 2 }, payment, order, transaction)).toBe(false);
    expect(canRecordCashReceipt({ id: 10, role: "admin", cooperativeId: 2 }, payment, order, transaction)).toBe(false);
    expect(canRecordCashReceipt({ id: 20, role: "superadmin", cooperativeId: null }, payment, order, transaction)).toBe(false);
    expect(canRecordCashReceipt({ id: 30, role: "admin", cooperativeId: 2 }, payment, { ...order, totalCents: 5001 }, transaction)).toBe(false);
    expect(canRecordCashReceipt({ id: 30, role: "admin", cooperativeId: 2 }, payment, { ...order, buyerId: 11 }, transaction)).toBe(false);
    expect(canRecordCashReceipt({ id: 30, role: "admin", cooperativeId: 2 }, payment, { ...order, cooperativeId: 3 }, transaction)).toBe(false);
    expect(canRecordCashReceipt({ id: 30, role: "admin", cooperativeId: 2 }, payment, { ...order, paymentMethod: "gcash" }, transaction)).toBe(false);
    expect(canRecordCashReceipt({ id: 30, role: "admin", cooperativeId: 2 }, { ...payment, paymentMethod: "f2f" }, order, transaction)).toBe(false);
    expect(canRecordCashReceipt({ id: 30, role: "admin", cooperativeId: 2 }, { ...payment, status: "verified" }, order, transaction)).toBe(false);
    expect(canRecordCashReceipt({ id: 30, role: "admin", cooperativeId: 2 }, payment, { ...order, status: "confirmed" }, transaction)).toBe(false);
    expect(canRecordCashReceipt({ id: 30, role: "admin", cooperativeId: 2 }, payment, { ...order, paymentStatus: "paid" }, transaction)).toBe(false);
    expect(canRecordCashReceipt({ id: 30, role: "admin", cooperativeId: 2 }, payment, order, { ...transaction, buyerId: 11 })).toBe(false);
    expect(canRecordCashReceipt({ id: 30, role: "admin", cooperativeId: 2 }, payment, order, { ...transaction, amountCents: 5001 })).toBe(false);
    expect(canRecordCashReceipt({ id: 30, role: "admin", cooperativeId: 2 }, payment, order, { ...transaction, status: "paid" })).toBe(false);
  });

  it("limits refunds to non-participant Admins in their cooperative and platform SuperAdmins", () => {
    const payment = { buyerId: 10, sellerId: 20, cooperativeId: 2 };
    expect(canManageRefundRecord({ id: 30, role: "admin", cooperativeId: 2 }, payment)).toBe(true);
    expect(canManageRefundRecord({ id: 31, role: "admin", cooperativeId: 3 }, payment)).toBe(false);
    expect(canManageRefundRecord({ id: 32, role: "admin", cooperativeId: null }, payment)).toBe(false);
    expect(canManageRefundRecord({ id: 1, role: "superadmin", cooperativeId: null }, payment)).toBe(true);
    expect(canManageRefundRecord({ id: 10, role: "superadmin", cooperativeId: null }, payment)).toBe(false);
    expect(canManageRefundRecord({ id: 20, role: "admin", cooperativeId: 2 }, payment)).toBe(false);
    expect(canManageRefundRecord({ id: 40, role: "seller", cooperativeId: 2 }, payment)).toBe(false);
    expect(canManageRefundRecord({ id: 41, role: "buyer", cooperativeId: null }, payment)).toBe(false);
  });

  it("keeps public Admin Officer registrations pending until approval and blocks suspended accounts", () => {
    const pendingAdmin = { id: 7, role: "admin" as const, approvalStatus: "pending" as const, cooperativeId: 2 };
    expect(() => requireOperationalRole(pendingAdmin, ["admin"])).toThrow("pending cooperative approval");
    expect(() => requireOperationalRole({ ...pendingAdmin, approvalStatus: "suspended" }, ["admin"])).toThrow("suspended");
    expect(requireOperationalRole({ ...pendingAdmin, approvalStatus: "approved" }, ["admin"]).role).toBe("admin");
    expect(() => requireOperationalRole({
      ...pendingAdmin,
      approvalStatus: "approved",
      cooperativeId: null,
    }, ["admin"])).toThrow("must be assigned to a cooperative");
    expect(() => requireOperationalRole({ ...pendingAdmin, approvalStatus: "approved" }, ["superadmin"]))
      .toThrow("cannot access this area");
    expect(requireOperationalRole({ ...pendingAdmin, role: "superadmin" as const }, ["superadmin"]).role).toBe("superadmin");
  });

  it("blocks protected workspace rendering for pending, suspended, or unassigned Admin accounts", () => {
    expect(getAccountAccessRestriction({
      role: "seller",
      approvalStatus: "pending",
      cooperativeId: null,
    })).toBe("pending");
    expect(getAccountAccessRestriction({
      role: "buyer",
      approvalStatus: "suspended",
      cooperativeId: null,
    })).toBe("suspended");
    expect(getAccountAccessRestriction({
      role: "admin",
      approvalStatus: "approved",
      cooperativeId: null,
    })).toBe("cooperative_assignment_required");
    expect(getAccountAccessRestriction({
      role: "superadmin",
      approvalStatus: "pending",
      cooperativeId: null,
    })).toBeNull();
    expect(getAccountAccessRestriction({
      role: "buyer",
      approvalStatus: "approved",
      cooperativeId: null,
    })).toBeNull();
  });

  it("limits officer order access to their own cooperative while letting SuperAdmin see everything", () => {
    expect(canAccessOrderForCooperative({ role: "admin", cooperativeId: 2 }, 2)).toBe(true);
    expect(canAccessOrderForCooperative({ role: "admin", cooperativeId: 2 }, 3)).toBe(false);
    expect(canAccessOrderForCooperative({ role: "superadmin", cooperativeId: null }, 3)).toBe(true);
  });

  it("limits completion and cancellation to the seller's cooperative Admin Officer or SuperAdmin", () => {
    const order = { sellerId: 20, cooperativeId: 2 };
    const seller = { id: 20, role: "seller" as const, cooperativeId: 2 };
    const officer = { id: 30, role: "admin" as const, cooperativeId: 2 };
    const otherOfficer = { id: 31, role: "admin" as const, cooperativeId: 3 };
    const superAdmin = { id: 1, role: "superadmin" as const, cooperativeId: null };

    expect(canUpdateOrderStatus(seller, order, "confirmed")).toBe(true);
    expect(canUpdateOrderStatus(seller, order, "ready")).toBe(true);
    expect(canUpdateOrderStatus(seller, order, "completed")).toBe(false);
    expect(canUpdateOrderStatus(seller, order, "cancelled")).toBe(false);
    expect(canUpdateOrderStatus(officer, order, "completed")).toBe(true);
    expect(canUpdateOrderStatus(otherOfficer, order, "completed")).toBe(false);
    expect(canUpdateOrderStatus(superAdmin, order, "completed")).toBe(true);
  });

  it("limits Officer product, user, and order operations to their cooperative", () => {
    const officer = { id: 4, role: "admin" as const, cooperativeId: 2 };
    const superAdmin = { id: 1, role: "superadmin" as const, cooperativeId: null };
    expect(canManageCooperativeResource(officer, 2)).toBe(true);
    expect(canManageCooperativeResource(officer, 3)).toBe(false);
    expect(canAccessOrderForCooperative(officer, 3)).toBe(false);
    expect(canManageCooperativeResource(superAdmin, 3)).toBe(true);
    expect(canAccessOrderForCooperative(superAdmin, 3)).toBe(true);
    expect(adminOverviewCooperativeScope(officer)).toBe(2);
    expect(adminOverviewCooperativeScope(superAdmin)).toBeUndefined();
  });

  it("prevents Officers from moving users or assigning SuperAdmin", () => {
    const officer = { role: "admin" as const, cooperativeId: 2 };
    expect(canUpdateCooperativeUser(officer, 2, 2, "seller")).toBe(true);
    expect(canUpdateCooperativeUser(officer, 3, 2, "seller")).toBe(false);
    expect(canUpdateCooperativeUser(officer, 2, 3, "seller")).toBe(false);
    expect(canUpdateCooperativeUser(officer, 2, 2, "superadmin")).toBe(false);
    expect(canUpdateCooperativeUser(officer, 2, 2, "seller", "superadmin")).toBe(false);
    expect(canUpdateCooperativeUser({ role: "superadmin", cooperativeId: null }, 3, 2, "superadmin")).toBe(true);
  });

  it("requires the Seller's current approval to be approved for sales", () => {
    expect(isSellerApproved("approved")).toBe(true);
    expect(isSellerApproved("pending")).toBe(false);
    expect(isSellerApproved("suspended")).toBe(false);
    expect(isSellerApproved(undefined)).toBe(false);
  });

  it("limits order chats to buyer and seller participants only", () => {
    const thread = { buyerId: 10, sellerId: 20 };
    expect(canAccessConversation({ id: 10, role: "buyer", cooperativeId: null }, thread, 2)).toBe(true);
    expect(canAccessConversation({ id: 20, role: "seller", cooperativeId: 2 }, thread, 2)).toBe(true);
    expect(canAccessConversation({ id: 30, role: "admin", cooperativeId: 2 }, thread, 2)).toBe(false);
    expect(canAccessConversation({ id: 40, role: "superadmin", cooperativeId: null }, thread, 2)).toBe(false);
    expect(canAccessConversation({ id: 50, role: "buyer", cooperativeId: null }, thread, 2)).toBe(false);
    expect(canAccessConversation({ id: 60, role: "admin", cooperativeId: 3 }, thread, 2)).toBe(false);
  });

  it("allows platform support inquiries for requester and officers", () => {
    const supportThread = { buyerId: 10, sellerId: null as number | null };
    expect(canAccessConversation({ id: 10, role: "buyer", cooperativeId: null }, supportThread, null)).toBe(true);
    expect(canAccessConversation({ id: 30, role: "admin", cooperativeId: 2 }, supportThread, null)).toBe(true);
    expect(canAccessConversation({ id: 40, role: "superadmin", cooperativeId: null }, supportThread, null)).toBe(true);
    expect(canAccessConversation({ id: 50, role: "buyer", cooperativeId: null }, supportThread, null)).toBe(false);
  });

  it("allows Buyers and Sellers to submit verification only when unverified or rejected", () => {
    expect(canSubmitProfileVerification({ role: "buyer", verificationStatus: "unverified" })).toBe(true);
    expect(canSubmitProfileVerification({ role: "seller", verificationStatus: "rejected" })).toBe(true);
    expect(canSubmitProfileVerification({ role: "seller", verificationStatus: "pending" })).toBe(false);
    expect(canSubmitProfileVerification({ role: "seller", verificationStatus: "approved" })).toBe(false);
    expect(canSubmitProfileVerification({ role: "admin", verificationStatus: "unverified" })).toBe(false);
    expect(canSubmitProfileVerification({ role: "superadmin", verificationStatus: "unverified" })).toBe(false);
  });
});
