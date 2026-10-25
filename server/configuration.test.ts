import { describe, expect, it } from "vitest";
import { assertSupabaseServerEnvironment, readSupabaseConfig } from "./supabaseConfig";
import { assertProductionEnvironment } from "./productionConfig";
import { isProductImageSizeAllowed, MAX_PRODUCT_IMAGE_SIZE_BYTES } from "../shared/productOptions";
import { transactions } from "../drizzle/schema";

describe("product image upload limit", () => {
  it("allows files up to 5 MB and rejects larger or empty files", () => {
    expect(isProductImageSizeAllowed(MAX_PRODUCT_IMAGE_SIZE_BYTES)).toBe(true);
    expect(isProductImageSizeAllowed(MAX_PRODUCT_IMAGE_SIZE_BYTES + 1)).toBe(false);
    expect(isProductImageSizeAllowed(0)).toBe(false);
  });
});

describe("server Supabase configuration", () => {
  it("fails in production when any required URL or key is missing", () => {
    expect(() => readSupabaseConfig({ NODE_ENV: "production" }))
      .toThrow("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("checks the service-role key only for server-only operations", () => {
    expect(() => assertSupabaseServerEnvironment({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    })).toThrow("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("preserves localhost and dummy-key defaults outside production", () => {
    expect(readSupabaseConfig({ NODE_ENV: "development" })).toEqual({
      url: "http://localhost:54321",
      anonKey: "local-anon-key",
      serviceRoleKey: "",
    });
  });
});

describe("production configuration", () => {
  it("requires the server-side Supabase environment variables", () => {
    expect(() => assertProductionEnvironment({ NODE_ENV: "production" }))
      .toThrow("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("accepts Supabase production configuration and ignores requirements outside production", () => {
    expect(() => assertProductionEnvironment({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    })).not.toThrow();
    expect(() => assertProductionEnvironment({ NODE_ENV: "development" })).not.toThrow();
  });
});

describe("transaction completion timestamp schema", () => {
  it("is nullable and has no creation-time default", () => {
    expect(transactions.completedAt.notNull).toBe(false);
    expect(transactions.completedAt.hasDefault).toBe(false);
  });
});
