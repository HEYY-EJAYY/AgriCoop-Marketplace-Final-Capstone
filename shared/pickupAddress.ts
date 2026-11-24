/**
 * Structured cooperative pickup address helpers (client + server).
 *
 * Cooperatives store pickup address parts in dedicated nullable columns
 * (pickupProvince / pickupCity / pickupBarangay / pickupStreetAddress).
 * When any part is present the structured parts are the source of truth;
 * otherwise callers fall back to the legacy free-text `address` + `location`.
 */

export type CooperativePickupAddressParts = {
  pickupProvince?: string | null;
  pickupCity?: string | null;
  pickupBarangay?: string | null;
  pickupStreetAddress?: string | null;
};

export type CooperativePickupAddressInput = {
  pickupProvince?: string | null;
  pickupCity?: string | null;
  pickupBarangay?: string | null;
  pickupStreetAddress?: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function hasStructuredPickupAddress(parts: CooperativePickupAddressParts) {
  return Boolean(
    clean(parts.pickupProvince)
    || clean(parts.pickupCity)
    || clean(parts.pickupBarangay)
    || clean(parts.pickupStreetAddress),
  );
}

/** True when every required pickup address part is filled in. */
export function isPickupAddressComplete(parts: CooperativePickupAddressParts) {
  return Boolean(
    clean(parts.pickupProvince)
    && clean(parts.pickupCity)
    && clean(parts.pickupBarangay)
    && clean(parts.pickupStreetAddress),
  );
}

/** "Street, Barangay, City, Province" — only non-empty parts, in display order. */
export function formatPickupAddress(parts: CooperativePickupAddressParts) {
  return [
    clean(parts.pickupStreetAddress),
    clean(parts.pickupBarangay),
    clean(parts.pickupCity),
    clean(parts.pickupProvince),
  ].filter(Boolean).join(", ");
}

/**
 * Single-line pickup address for buyers. Prefers the structured pickup
 * address; falls back to the cooperative's legacy address + location so
 * existing cooperatives keep showing their recorded address.
 */
export function cooperativePickupAddressLine(cooperative: CooperativePickupAddressParts & {
  address?: string | null;
  location?: string | null;
}) {
  if (hasStructuredPickupAddress(cooperative)) {
    return formatPickupAddress(cooperative);
  }
  return [clean(cooperative.address), clean(cooperative.location)].filter(Boolean).join(", ");
}

/** Snapshot shape stored in orders.pickupDetails for new pickup orders. */
export function pickupAddressSnapshotFields(parts: CooperativePickupAddressInput) {
  return {
    province: clean(parts.pickupProvince) || null,
    city: clean(parts.pickupCity) || null,
    barangay: clean(parts.pickupBarangay) || null,
    streetAddress: clean(parts.pickupStreetAddress) || null,
  };
}
