import { describe, expect, it, vi } from "vitest";
import {
  canAccessLegacyProductImage,
  normalizeLegacyProductImagePath,
  type LegacyProductImage,
  type StorageProxyActor,
} from "./_core/storageProxyAuth";
import { readSupabaseConfig } from "./supabaseConfig";
import { isProductImageSizeAllowed, MAX_PRODUCT_IMAGE_SIZE_BYTES, MAX_PRODUCT_IMAGES, moveProductImage } from "../shared/productOptions";
import { transactions } from "../drizzle/pg-schema";
import { assertProductImageUpdateInput, newProductSchema, updateProductSchema, validateProductImageUrls } from "./routers";

describe("product image upload limit", () => {
  it("allows files up to 3 MB and rejects larger or empty files", () => {
    expect(isProductImageSizeAllowed(MAX_PRODUCT_IMAGE_SIZE_BYTES)).toBe(true);
    expect(isProductImageSizeAllowed(MAX_PRODUCT_IMAGE_SIZE_BYTES + 1)).toBe(false);
    expect(isProductImageSizeAllowed(0)).toBe(false);
  });

  it("accepts up to ten image URLs and rejects larger galleries", () => {
    const product = {
      name: "Test produce",
      category: "Fruit",
      variety: "Test variety",
      description: "Test description",
      unit: "kg",
      priceCents: 100,
      stockQty: 10,
      minOrderQty: 1,
      imageUrls: Array.from({ length: MAX_PRODUCT_IMAGES }, (_, index) => `https://example.test/${index}.png`),
    };

    expect(newProductSchema.safeParse(product).success).toBe(true);
    expect(newProductSchema.safeParse({ ...product, imageUrls: [...product.imageUrls, "https://example.test/overflow.png"] }).success).toBe(false);
  });

  it("reorders product images without moving them past the gallery boundaries", () => {
    const images = ["first", "second", "third"];
    expect(moveProductImage(images, 1, -1)).toEqual(["second", "first", "third"]);
    expect(moveProductImage(images, 2, 1)).toEqual(images);
    expect(images).toEqual(["first", "second", "third"]);
  });

  it("limits newly submitted image URLs to the seller's Storage prefix", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.test");
    vi.stubEnv("SUPABASE_STORAGE_BUCKET", "product-images");
    const sellerImage = "https://storage.test/storage/v1/object/public/product-images/products/7/harvest.png";

    expect(() => validateProductImageUrls([sellerImage], 7)).not.toThrow();
    expect(() => validateProductImageUrls([
      "https://storage.test/storage/v1/object/public/product-images/products/8/harvest.png",
    ], 7)).toThrow("authorized AgriCoop Storage location");
    expect(() => validateProductImageUrls(["https://legacy.test/old.png"], 7, ["https://legacy.test/old.png"])).not.toThrow();
    expect(() => validateProductImageUrls(["https://legacy.test/new.png"], 7)).toThrow();
  });

  it("prevents primary-image updates from bypassing the validated gallery", () => {
    expect(() => assertProductImageUpdateInput(undefined, "https://other.example/image.png"))
      .toThrow("through the image gallery");
    expect(() => assertProductImageUpdateInput(["seller-image.png"], "https://other.example/image.png"))
      .toThrow("first image in the gallery");
    expect(() => assertProductImageUpdateInput(["seller-image.png"], "seller-image.png")).not.toThrow();
    expect(() => assertProductImageUpdateInput(undefined, undefined)).not.toThrow();
  });

  it("allows sellers to mark existing inventory as zero without allowing negative stock", () => {
    const update = {
      id: 1,
      name: "Test produce",
      category: "Fruit",
      variety: "Test variety",
      description: "Test description",
      unit: "kg",
      priceCents: 100,
      stockQty: 0,
      minOrderQty: 1,
      qualityGrade: "standard",
      status: "published",
    };

    expect(updateProductSchema.safeParse(update).success).toBe(true);
    expect(updateProductSchema.safeParse({ ...update, stockQty: -1 }).success).toBe(false);
    expect(newProductSchema.safeParse(update).success).toBe(false);
  });
});

describe("legacy storage proxy authorization", () => {
  const imagePath = "/manus-storage/products/7/harvest.png";
  const seller: StorageProxyActor = {
    id: 7,
    openId: "seller-auth-id",
    role: "seller",
    approvalStatus: "approved",
    cooperativeId: 2,
  };
  const publicProduct: LegacyProductImage = {
    sellerId: 7,
    cooperativeId: 2,
    status: "published",
    verificationStatus: "approved",
    visibility: "visible",
    sellerApprovalStatus: "approved",
    imagePaths: [imagePath],
  };

  it("rejects unauthenticated, mismatched, pending, and suspended users", () => {
    expect(canAccessLegacyProductImage(undefined, seller, publicProduct, imagePath)).toBe(false);
    expect(canAccessLegacyProductImage("another-auth-id", seller, publicProduct, imagePath)).toBe(false);
    expect(canAccessLegacyProductImage("seller-auth-id", { ...seller, approvalStatus: "pending" }, publicProduct, imagePath)).toBe(false);
    expect(canAccessLegacyProductImage("seller-auth-id", { ...seller, approvalStatus: "suspended" }, publicProduct, imagePath)).toBe(false);
  });

  it("rejects an Admin from a different cooperative", () => {
    const admin: StorageProxyActor = {
      id: 12,
      openId: "admin-auth-id",
      role: "admin",
      approvalStatus: "approved",
      cooperativeId: 3,
    };

    expect(canAccessLegacyProductImage("admin-auth-id", admin, publicProduct, imagePath)).toBe(false);
    expect(canAccessLegacyProductImage("admin-auth-id", { ...admin, cooperativeId: 2 }, publicProduct, imagePath)).toBe(true);
  });

  it("rejects arbitrary paths and private payment-proof paths", () => {
    expect(canAccessLegacyProductImage("seller-auth-id", seller, publicProduct, "/manus-storage/private/other-user.png")).toBe(false);
    expect(normalizeLegacyProductImagePath("../payment-proofs/7/receipt.png")).toBeNull();
    expect(normalizeLegacyProductImagePath("products/7/%2e%2e/receipt.png")).toBeNull();
    expect(normalizeLegacyProductImagePath("products/7/payment-proofs/receipt.png")).toBeNull();
  });

  it("allows an owner or an operational user to access a linked public product image", () => {
    expect(canAccessLegacyProductImage("seller-auth-id", seller, publicProduct, imagePath)).toBe(true);
    expect(canAccessLegacyProductImage("buyer-auth-id", {
      id: 14,
      openId: "buyer-auth-id",
      role: "buyer",
      approvalStatus: "approved",
      cooperativeId: null,
    }, publicProduct, imagePath)).toBe(true);

    const unpublishedProduct = { ...publicProduct, status: "archived" };
    expect(canAccessLegacyProductImage("seller-auth-id", seller, unpublishedProduct, imagePath)).toBe(true);
    expect(canAccessLegacyProductImage("buyer-auth-id", {
      id: 14,
      openId: "buyer-auth-id",
      role: "buyer",
      approvalStatus: "approved",
      cooperativeId: null,
    }, unpublishedProduct, imagePath)).toBe(false);
  });
});

describe("server Supabase configuration", () => {
  it("fails in production when any required URL or key is missing", () => {
    expect(() => readSupabaseConfig({ NODE_ENV: "production" }))
      .toThrow("APP_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY");
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
