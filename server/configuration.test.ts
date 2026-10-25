import { describe, expect, it } from "vitest";
import { readSupabaseConfig } from "./supabaseConfig";
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
      .toThrow("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY");
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
  it("requires production database and Supabase environment variables", () => {
    expect(() => assertProductionEnvironment({ NODE_ENV: "production" }))
      .toThrow("DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY");
  });

  it("accepts a MySQL URL and ignores production requirements outside production", () => {
    expect(() => assertProductionEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "mysql://user:password@localhost/agricoop",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
    })).not.toThrow();
    expect(() => assertProductionEnvironment({ NODE_ENV: "development" })).not.toThrow();
  });

  it("rejects malformed and non-MySQL production URLs without printing their contents", () => {
    expect(() => assertProductionEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "not-a-url",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
    })).toThrow("DATABASE_URL must be a valid MySQL connection URL.");
    expect(() => assertProductionEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://localhost/db",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
    })).toThrow("DATABASE_URL must use the mysql:// protocol.");
  });
});

describe("transaction completion timestamp schema", () => {
  it("is nullable and has no creation-time default", () => {
    expect(transactions.completedAt.notNull).toBe(false);
    expect(transactions.completedAt.hasDefault).toBe(false);
  });
});
