type ListingOptionBadgesProps = {
  allowsPickup?: boolean | null;
  allowsDelivery?: boolean | null;
  acceptsOnlinePayment?: boolean | null;
  className?: string;
};

const badgeClass =
  "rounded-full bg-[#edf3e9] px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-[#487249]";

/** Small soft badges for listing fulfillment / online payment options. Renders only available options. */
export function ListingOptionBadges({
  allowsPickup,
  allowsDelivery,
  acceptsOnlinePayment,
  className = "",
}: ListingOptionBadgesProps) {
  const badges: string[] = [];
  if (allowsPickup) badges.push("Pickup");
  if (allowsDelivery) badges.push("Delivery");
  if (acceptsOnlinePayment) badges.push("Online payment");
  if (!badges.length) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`.trim()}>
      {badges.map(label => (
        <span key={label} className={badgeClass}>{label}</span>
      ))}
    </div>
  );
}
