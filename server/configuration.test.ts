import { describe, expect, it } from "vitest";
import { isStorageProxyUserAuthenticated } from "./_core/storageProxyAuth";
import { readSupabaseConfig } from "./supabaseConfig";
import { isProductImageSizeAllowed, MAX_PRODUCT_IMAGE_SIZE_BYTES } from "../shared/productOptions";
import { transactions } from "../drizzle/schema";

describe("product image upload limit", () => {
  it("allows files up to 5 MB and rejects larger or empty files", () => {
    expect(isProductImageSizeAllowed(MAX_PRODUCT_IMAGE_SIZE_BYTES)).toBe(true);
    expect(isProductImageSizeAllowed(MAX_PRODUCT_IMAGE_SIZE_BYTES + 1)).toBe(false);
    expect(isProductImageSizeAllowed(0)).toBe(false);
  });
});

describe("storage proxy authentication", () => {
  it("requires a Supabase identity matching a local account", () => {
    expect(isStorageProxyUserAuthenticated("user-1", "user-1")).toBe(true);
    expect(isStorageProxyUserAuthenticated("user-1", undefined)).toBe(false);
    expect(isStorageProxyUserAuthenticated("user-1", "user-2")).toBe(false);
    expect(isStorageProxyUserAuthenticated(undefined, "user-1")).toBe(false);
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

describe("transaction completion timestamp schema", () => {
  it("is nullable and has no creation-time default", () => {
    expect(transactions.completedAt.notNull).toBe(false);
    expect(transactions.completedAt.hasDefault).toBe(false);
  });
});
