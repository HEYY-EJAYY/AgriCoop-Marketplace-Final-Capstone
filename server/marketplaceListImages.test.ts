import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMarketplace: vi.fn(),
  withRequestDatabaseScope: vi.fn((_authUserId: string | null, callback: () => Promise<unknown>) => callback()),
}));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getMarketplace: mocks.getMarketplace,
    withRequestDatabaseScope: mocks.withRequestDatabaseScope,
  };
});

import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

describe("marketplace.list image fields", () => {
  beforeEach(() => {
    mocks.getMarketplace.mockReset();
  });

  it("returns each listing's own primaryImageUrl / imageUrls from the procedure", async () => {
    mocks.getMarketplace.mockResolvedValue([
      {
        sellerName: "Ana",
        cooperativeName: "Coop A",
        product: {
          id: 1,
          name: "Rice",
          primaryImageUrl: "https://cdn.example/product-images/products/1/rice.jpg",
          imageUrls: ["https://cdn.example/product-images/products/1/rice.jpg"],
        },
      },
      {
        sellerName: "Ben",
        cooperativeName: "Coop B",
        product: {
          id: 2,
          name: "Corn",
          primaryImageUrl: "https://cdn.example/product-images/products/2/corn.jpg",
          imageUrls: ["https://cdn.example/product-images/products/2/corn.jpg"],
        },
      },
    ]);

    const caller = appRouter.createCaller({
      user: null,
      req: { protocol: "https", headers: {} },
      res: {},
    } as TrpcContext);
    const listings = await caller.marketplace.list();
    expect(mocks.getMarketplace).toHaveBeenCalled();
    expect(listings).toHaveLength(2);
    expect(listings[0]!.product.primaryImageUrl).toContain("/products/1/");
    expect(listings[1]!.product.primaryImageUrl).toContain("/products/2/");
    expect(listings[0]!.product.primaryImageUrl).not.toBe(listings[1]!.product.primaryImageUrl);
    expect(listings.every(row => !String(row.product.primaryImageUrl).includes("hero-banner"))).toBe(true);
    expect(listings.every(row => row.product.imageUrls[0] === row.product.primaryImageUrl)).toBe(true);
  });
});
