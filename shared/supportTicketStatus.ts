export const SUPPORT_TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

const allowedTransitions: Record<SupportTicketStatus, readonly SupportTicketStatus[]> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["open", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: [],
};

export function isSupportTicketStatus(value: string): value is SupportTicketStatus {
  return (SUPPORT_TICKET_STATUSES as readonly string[]).includes(value);
}

export function canTransitionSupportTicketStatus(
  current: SupportTicketStatus,
  next: SupportTicketStatus,
) {
  return allowedTransitions[current].includes(next);
}

export function getSupportTicketStatusOptions(current: SupportTicketStatus) {
  return SUPPORT_TICKET_STATUSES.filter(status => (
    status === current || canTransitionSupportTicketStatus(current, status)
  ));
}
