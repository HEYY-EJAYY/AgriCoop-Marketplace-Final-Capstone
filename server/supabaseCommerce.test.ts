import { describe, expect, it } from "vitest";
import { isPublicSupabaseProductStatus, isUuid } from "./supabaseData";
import { validateSupabaseProductWrite } from "./supabaseCommerce";
import { canAdvanceSupabaseOrder } from "./supabaseOperations";

describe("Supabase commerce boundaries", () => {
  it("accepts UUID identifiers and rejects numeric legacy IDs", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUuid("12")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
  });

  it("only treats known public product statuses as marketplace listings", () => {
    expect(isPublicSupabaseProductStatus("available")).toBe(true);
    expect(isPublicSupabaseProductStatus("PUBLISHED")).toBe(true);
    expect(isPublicSupabaseProductStatus("pending")).toBe(false);
    expect(isPublicSupabaseProductStatus("archived")).toBe(false);
    expect(isPublicSupabaseProductStatus(undefined)).toBe(false);
  });

  it("rejects invalid seller product and inventory writes before database access", () => {
    expect(() => validateSupabaseProductWrite({
      sellerId: "11111111-1111-4111-8111-111111111111",
      name: "Rice",
      category: "Grains",
      description: "Fresh rice",
      unit: "kg",
      priceCents: 0,
      stockQty: 5,
    })).toThrow("positive whole number");
    expect(() => validateSupabaseProductWrite({
      sellerId: "not-a-uuid",
      name: "Rice",
      category: "Grains",
      description: "Fresh rice",
      unit: "kg",
      priceCents: 8500,
      stockQty: -1,
    })).toThrow("Seller identity");
  });

  it("enforces officer order state transitions", () => {
    expect(canAdvanceSupabaseOrder("submitted", "confirmed")).toBe(true);
    expect(canAdvanceSupabaseOrder("confirmed", "completed")).toBe(false);
    expect(canAdvanceSupabaseOrder("ready", "completed")).toBe(true);
    expect(canAdvanceSupabaseOrder("completed", "cancelled")).toBe(false);
  });
});
