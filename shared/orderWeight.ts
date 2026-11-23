/**
 * Shared order-weight rules for the 20 kg delivery minimum.
 *
 * Weight is derived from the product's selling unit — there is no separate
 * weight column. Only mass units convert to kilograms; piece/bunch/sack and
 * any unknown unit yield `null` (unknown weight) so they can never silently
 * qualify an order for delivery.
 */

export const DELIVERY_MIN_WEIGHT_GRAMS = 20_000;

const UNIT_GRAMS: Record<string, number> = {
  kg: 1_000,
  "metric ton": 1_000_000,
};

export function unitWeightGrams(unit: string): number | null {
  const grams = UNIT_GRAMS[unit.trim().toLowerCase()];
  return grams ?? null;
}

export type OrderWeightBreakdown = {
  /** Exact integer grams across all lines with a known weight. */
  totalGrams: number;
  /** Distinct units whose weight cannot be determined. */
  unknownUnits: string[];
};

export function orderWeightGrams(
  items: ReadonlyArray<{ quantity: number; unit: string }>,
): OrderWeightBreakdown {
  let totalGrams = 0;
  const unknown = new Set<string>();
  for (const item of items) {
    const grams = unitWeightGrams(item.unit);
    if (grams === null) {
      unknown.add(item.unit);
      continue;
    }
    totalGrams += item.quantity * grams;
  }
  return { totalGrams, unknownUnits: Array.from(unknown) };
}

/** True when every line has a known weight and the total meets the delivery minimum. */
export function meetsDeliveryMinimumWeight(
  items: ReadonlyArray<{ quantity: number; unit: string }>,
): boolean {
  const weight = orderWeightGrams(items);
  return weight.unknownUnits.length === 0 && weight.totalGrams >= DELIVERY_MIN_WEIGHT_GRAMS;
}

/** Human-readable kg value, e.g. 19.99 kg / 20 kg / 1,250 kg. */
export function formatWeightKg(totalGrams: number): string {
  const kg = totalGrams / 1000;
  const rounded = Math.round(kg * 100) / 100;
  return `${rounded.toLocaleString("en-US", { maximumFractionDigits: 2 })} kg`;
}
