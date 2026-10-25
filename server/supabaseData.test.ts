import { describe, expect, it } from "vitest";
import type { SupabaseProductRow } from "./supabaseData";

describe("Supabase UUID data model", () => {
  it("keeps business identifiers as UUID strings and money as numeric values", () => {
    const product: SupabaseProductRow = {
      product_id: "11111111-1111-4111-8111-111111111111",
      seller_id: "22222222-2222-4222-8222-222222222222",
      product_name: "Rice",
      category: "Grains",
      price: 85.5,
      unit: "kg",
      description: null,
      status: "available",
      created_at: "2026-10-25T00:00:00Z",
    };

    expect(product.product_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof product.seller_id).toBe("string");
    expect(product.price).toBe(85.5);
  });
});
