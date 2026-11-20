import { fulfillmentTypeLabel, type FulfillmentType } from "../../../shared/fulfillment";

export function FulfillmentBadge({ type, prepTimeDays, className = "" }: { type?: string | null; prepTimeDays?: number | null; className?: string }) {
  const orderBased = type === "order_based";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${orderBased ? "bg-[#fdf3e3] text-[#8a5a1d]" : "bg-[#e8f1e4] text-[#315640]"} ${className}`}
      title={orderBased && prepTimeDays ? `Estimated preparation: ${prepTimeDays} day${prepTimeDays === 1 ? "" : "s"}` : undefined}
    >
      {fulfillmentTypeLabel(type)}
      {orderBased && prepTimeDays ? ` · ~${prepTimeDays}d` : ""}
    </span>
  );
}
