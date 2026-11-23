import { describe, expect, it } from "vitest";
import {
  DELIVERY_MIN_WEIGHT_GRAMS,
  formatWeightKg,
  meetsDeliveryMinimumWeight,
  orderWeightGrams,
  unitWeightGrams,
} from "./orderWeight";

describe("orderWeightGrams", () => {
  it("converts kg and metric ton units to grams exactly", () => {
    expect(unitWeightGrams("kg")).toBe(1000);
    expect(unitWeightGrams("metric ton")).toBe(1_000_000);
    expect(unitWeightGrams(" Metric Ton ")).toBe(1_000_000);
  });

  it("returns null for units without a defined weight", () => {
    for (const unit of ["piece", "bunch", "sack", ""]) {
      expect(unitWeightGrams(unit)).toBeNull();
    }
  });

  it("sums mixed lines without floating-point error", () => {
    const weight = orderWeightGrams([
      { quantity: 10, unit: "kg" },
      { quantity: 5, unit: "kg" },
      { quantity: 1, unit: "metric ton" },
    ]);
    expect(weight.totalGrams).toBe(1_015_000);
    expect(weight.unknownUnits).toEqual([]);
  });

  it("flags unknown units instead of assuming a weight", () => {
    const weight = orderWeightGrams([
      { quantity: 30, unit: "kg" },
      { quantity: 4, unit: "piece" },
    ]);
    expect(weight.totalGrams).toBe(30_000);
    expect(weight.unknownUnits).toEqual(["piece"]);
  });
});

describe("meetsDeliveryMinimumWeight", () => {
  it.each([
    [2, false],
    [10, false],
    [19, false],
    [19.99, false],
    [20, true],
    [25, true],
    [50, true],
  ])("%s kg cart -> delivery %s", (kg, expected) => {
    expect(meetsDeliveryMinimumWeight([{ quantity: kg, unit: "kg" }])).toBe(expected);
  });

  it("combines quantities across products", () => {
    expect(meetsDeliveryMinimumWeight([
      { quantity: 12, unit: "kg" },
      { quantity: 8, unit: "kg" },
    ])).toBe(true);
    expect(meetsDeliveryMinimumWeight([
      { quantity: 12.5, unit: "kg" },
      { quantity: 7.4, unit: "kg" },
    ])).toBe(false); // 19.9 kg
  });

  it("never qualifies a cart containing unknown-weight units", () => {
    expect(meetsDeliveryMinimumWeight([
      { quantity: 100, unit: "kg" },
      { quantity: 1, unit: "sack" },
    ])).toBe(false);
  });
});

describe("formatWeightKg", () => {
  it("formats gram totals as kilograms", () => {
    expect(formatWeightKg(19_990)).toBe("19.99 kg");
    expect(formatWeightKg(20_000)).toBe("20 kg");
    expect(formatWeightKg(1_250_000)).toBe("1,250 kg");
    expect(DELIVERY_MIN_WEIGHT_GRAMS).toBe(20_000);
  });
});
