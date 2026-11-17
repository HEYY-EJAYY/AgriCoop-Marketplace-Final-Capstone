import { describe, expect, it } from "vitest";
import { canAccessSupportTicket, canAssignSupportTicket, canTransitionSupportTicketStatus, resolveSupportTicketCooperativeId, supportTicketStatusAfterReply } from "./supportTickets";

describe("support ticket access and status rules", () => {
  const ticket = { userId: 10, cooperativeId: 4 };

  it("limits customers to their own tickets and Admins to their cooperative", () => {
    expect(canAccessSupportTicket({ id: 10, role: "buyer", cooperativeId: null }, ticket)).toBe(true);
    expect(canAccessSupportTicket({ id: 11, role: "buyer", cooperativeId: null }, ticket)).toBe(false);
    expect(canAccessSupportTicket({ id: 20, role: "admin", cooperativeId: 4 }, ticket)).toBe(true);
    expect(canAccessSupportTicket({ id: 21, role: "admin", cooperativeId: 5 }, ticket)).toBe(false);
    expect(canAccessSupportTicket({ id: 22, role: "superadmin", cooperativeId: null }, ticket)).toBe(true);
  });

  it("routes an unassigned buyer to a validated cooperative and preserves strict queue isolation", () => {
    const activeCooperatives = new Set([4, 6]);
    expect(resolveSupportTicketCooperativeId(null, 4, activeCooperatives)).toBe(4);
    expect(resolveSupportTicketCooperativeId(4, undefined, activeCooperatives)).toBe(4);
    expect(resolveSupportTicketCooperativeId(null, null, activeCooperatives)).toBeNull();
    expect(() => resolveSupportTicketCooperativeId(null, 99, activeCooperatives))
      .toThrow("selected cooperative support queue is unavailable");

    const assignedTicket = { userId: 10, cooperativeId: 4 };
    expect(canAccessSupportTicket({ id: 20, role: "admin", cooperativeId: 4 }, assignedTicket)).toBe(true);
    expect(canAccessSupportTicket({ id: 21, role: "admin", cooperativeId: 6 }, assignedTicket)).toBe(false);
    expect(canAccessSupportTicket({ id: 22, role: "superadmin", cooperativeId: null }, assignedTicket)).toBe(true);
    expect(canAccessSupportTicket({ id: 10, role: "buyer", cooperativeId: null }, assignedTicket)).toBe(true);
    const platformTicket = { userId: 10, cooperativeId: null };
    expect(canAccessSupportTicket({ id: 20, role: "admin", cooperativeId: 4 }, platformTicket)).toBe(false);
    expect(canAccessSupportTicket({ id: 22, role: "superadmin", cooperativeId: null }, platformTicket)).toBe(true);
  });

  it("allows explicit status transitions and reopens resolved tickets on customer reply", () => {
    expect(canTransitionSupportTicketStatus("open", "in_progress")).toBe(true);
    expect(canTransitionSupportTicketStatus("resolved", "open")).toBe(true);
    expect(canTransitionSupportTicketStatus("closed", "open")).toBe(false);
    expect(supportTicketStatusAfterReply("resolved", "buyer")).toBe("open");
    expect(supportTicketStatusAfterReply("resolved", "admin")).toBe("resolved");
    expect(supportTicketStatusAfterReply("closed", "buyer")).toBe(null);
  });

  it("limits ticket assignment to approved staff in the ticket's support scope", () => {
    const assignedTicket = { userId: 10, cooperativeId: 4 };
    const cooperativeAdmin = { id: 21, role: "admin", cooperativeId: 4, approvalStatus: "approved" };
    const otherCooperativeAdmin = { ...cooperativeAdmin, id: 22, cooperativeId: 5 };
    const unapprovedAdmin = { ...cooperativeAdmin, approvalStatus: "pending" };
    const platformSuperAdmin = { id: 23, role: "superadmin", cooperativeId: null, approvalStatus: "approved" };

    expect(canAssignSupportTicket({ id: 30, role: "admin", cooperativeId: 4 }, assignedTicket, cooperativeAdmin)).toBe(true);
    expect(canAssignSupportTicket({ id: 30, role: "admin", cooperativeId: 4 }, assignedTicket, otherCooperativeAdmin)).toBe(false);
    expect(canAssignSupportTicket({ id: 30, role: "admin", cooperativeId: 4 }, assignedTicket, unapprovedAdmin)).toBe(false);
    expect(canAssignSupportTicket({ id: 31, role: "admin", cooperativeId: 5 }, assignedTicket, cooperativeAdmin)).toBe(false);
    expect(canAssignSupportTicket({ id: 32, role: "superadmin", cooperativeId: null }, { userId: 10, cooperativeId: null }, platformSuperAdmin)).toBe(true);
    expect(canAssignSupportTicket({ id: 32, role: "superadmin", cooperativeId: null }, { userId: 10, cooperativeId: null }, cooperativeAdmin)).toBe(false);
    expect(canAssignSupportTicket({ id: 30, role: "admin", cooperativeId: 4 }, assignedTicket, null)).toBe(true);
  });
});
