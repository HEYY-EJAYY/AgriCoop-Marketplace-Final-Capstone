import { canTransitionSupportTicketStatus, type SupportTicketStatus } from "../shared/supportTicketStatus";

export { canTransitionSupportTicketStatus } from "../shared/supportTicketStatus";
export type { SupportTicketStatus } from "../shared/supportTicketStatus";

type SupportActor = {
  id: number;
  role: string;
  cooperativeId: number | null;
};

type SupportTicketScope = {
  userId: number;
  cooperativeId: number | null;
};

type SupportAssignmentTarget = {
  id: number;
  role: string;
  cooperativeId: number | null;
  approvalStatus: string;
};

export function resolveSupportTicketCooperativeId(
  userCooperativeId: number | null,
  requestedCooperativeId: number | null | undefined,
  activeCooperativeIds: ReadonlySet<number>,
) {
  if (requestedCooperativeId === undefined) return userCooperativeId;
  if (requestedCooperativeId === null) return null;
  if (!Number.isSafeInteger(requestedCooperativeId) || requestedCooperativeId <= 0) {
    throw new Error("Choose a valid cooperative support queue.");
  }
  if (!activeCooperativeIds.has(requestedCooperativeId)) {
    throw new Error("The selected cooperative support queue is unavailable.");
  }
  return requestedCooperativeId;
}

export function canAccessSupportTicket(actor: SupportActor, ticket: SupportTicketScope) {
  if (actor.role === "superadmin") return true;
  if (actor.role === "admin") {
    return actor.cooperativeId !== null && actor.cooperativeId === ticket.cooperativeId;
  }
  return actor.id === ticket.userId;
}

export function canAssignSupportTicket(
  actor: SupportActor,
  ticket: SupportTicketScope,
  target: SupportAssignmentTarget | null,
) {
  if ((actor.role !== "admin" && actor.role !== "superadmin") || !canAccessSupportTicket(actor, ticket)) {
    return false;
  }
  if (target === null) return true;
  if (target.approvalStatus !== "approved") return false;
  if (ticket.cooperativeId === null) {
    return actor.role === "superadmin" && target.role === "superadmin";
  }
  if (target.role === "admin") {
    return target.cooperativeId === ticket.cooperativeId;
  }
  return actor.role === "superadmin" && target.role === "superadmin";
}

export function supportTicketStatusAfterReply(
  current: SupportTicketStatus,
  actorRole: string,
): SupportTicketStatus | null {
  if (current === "closed") return null;
  if (actorRole !== "admin" && actorRole !== "superadmin" && current === "resolved") return "open";
  return current;
}
