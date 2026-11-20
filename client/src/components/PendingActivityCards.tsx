import { Link } from "wouter";
import { usePendingCounts, type PendingCounts } from "@/lib/usePendingCounts";

/** Self-contained variant that fetches counts itself — drop into any dashboard. */
export function PendingActivitySection({ role }: { role: string }) {
  const { counts } = usePendingCounts();
  return <PendingActivityCards counts={counts} role={role} />;
}

type Card = { label: string; count: number; href: string };

/** Role-appropriate pending-activity cards. Only renders cards with count > 0. */
export function PendingActivityCards({ counts, role }: { counts: PendingCounts; role: string }) {
  const p = counts.pending;
  const cards: Card[] = [];
  if (role === "buyer") {
    if (p.activeOrders) cards.push({ label: "Active orders", count: p.activeOrders, href: "/activity" });
    if (p.awaitingVerification) cards.push({ label: "Payments awaiting verification", count: p.awaitingVerification, href: "/activity" });
  } else if (role === "seller") {
    if (p.newOrders) cards.push({ label: "New orders to fulfill", count: p.newOrders, href: "/dashboard" });
    if (p.awaitingMyResponse) cards.push({ label: "Awaiting your availability response", count: p.awaitingMyResponse, href: "/dashboard" });
    if (p.requestedQuotations) cards.push({ label: "Quotation requests", count: p.requestedQuotations, href: "/dashboard" });
  } else if (role === "admin") {
    if (p.ordersToReview) cards.push({ label: "Orders awaiting approval", count: p.ordersToReview, href: "/dashboard" });
    if (p.awaitingSellerConfirmation) cards.push({ label: "Awaiting seller confirmation", count: p.awaitingSellerConfirmation, href: "/dashboard" });
    if (p.paymentsToReview) cards.push({ label: "Payment proofs to review", count: p.paymentsToReview, href: "/dashboard" });
    if (p.openTickets) cards.push({ label: "Open support tickets", count: p.openTickets, href: "/support-tickets" });
  } else if (role === "superadmin") {
    if (p.productsPendingReview) cards.push({ label: "Listings pending review", count: p.productsPendingReview, href: "/dashboard" });
    if (p.cooperativeApplications) cards.push({ label: "Officer applications", count: p.cooperativeApplications, href: "/dashboard" });
    if (p.profileVerifications) cards.push({ label: "Profile verifications", count: p.profileVerifications, href: "/dashboard" });
    if (p.userApprovals) cards.push({ label: "Users awaiting approval", count: p.userApprovals, href: "/dashboard" });
  }
  if (!cards.length) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2" data-testid="pending-activity-cards">
      {cards.map(card => (
        <Link
          key={card.label}
          href={card.href}
          className="inline-flex items-center gap-2 rounded-xl border border-[#e2e9dd] bg-[#f7faf5] px-3 py-2 text-xs font-bold text-[#315640] no-underline hover:bg-[#edf3e9]"
        >
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#a34838] px-1 text-[10px] font-extrabold text-white">{card.count}</span>
          {card.label}
        </Link>
      ))}
    </div>
  );
}
