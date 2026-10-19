import { describe, expect, it } from "vitest";
import { aggregateOrderItems, applyInventoryDeductions, assertInventorySufficient, assertNotSelfTransaction, canDecideBuyerQuotation, canPlaceAcceptedQuotationOrder, canTransitionOrder, isQuotationOpen, prepareOrder, priceOrderItems, transactionStatusFor } from "./marketplaceRules";

const products = [
  { id: 1, sellerId: 12, cooperativeId: 3, stockQty: 20, minOrderQty: 2, priceCents: 5500, unit: "kg", status: "published", name: "Fresh Cabbage" },
  { id: 2, sellerId: 12, cooperativeId: 3, stockQty: 12, minOrderQty: 1, priceCents: 4000, unit: "kg", status: "published", name: "Sweet Corn" },
];

describe("marketplace order rules", () => {
  it("normalizes a multi-product order from one farmer and calculates its total", () => {
    const order = prepareOrder(products, [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 3 }]);
    expect(order.orderType).toBe("bulk");
    expect(order.sellerId).toBe(12);
    expect(order.cooperativeId).toBe(3);
    expect(priceOrderItems(order.items, order.productMap).totalCents).toBe(23000);
  });

  it("rejects cross-farm and unavailable orders before records are created", () => {
    expect(() => prepareOrder([products[0], { ...products[1], id: 3, sellerId: 22 }], [{ productId: 1, quantity: 1 }, { productId: 3, quantity: 1 }])).toThrow("one seller");
    expect(() => prepareOrder([products[0]], [{ productId: 1, quantity: 1 }])).toThrow("minimum order of 2 kg");
    expect(() => prepareOrder([products[0]], [{ productId: 1, quantity: 21 }])).toThrow("only 20 kg available");
    expect(() => prepareOrder([{ ...products[0], status: "archived" }], [{ productId: 1, quantity: 1 }])).toThrow("no longer available");
  });

  it("sums duplicate product lines before checking stock and calculating the order total", () => {
    const items = [{ productId: 1, quantity: 2 }, { productId: 1, quantity: 3 }];
    expect(aggregateOrderItems(items)).toEqual([{ productId: 1, quantity: 5 }]);
    const prepared = prepareOrder(products.slice(0, 1), items);
    expect(priceOrderItems(prepared.items, prepared.productMap).totalCents).toBe(27500);
    expect(() => prepareOrder(products.slice(0, 1), [{ productId: 1, quantity: 15 }, { productId: 1, quantity: 6 }]))
      .toThrow("only 20 kg available");
  });

  it("uses the accepted quotation's unit price rather than the listing price", () => {
    const prepared = prepareOrder(products.slice(0, 1), [{ productId: 1, quantity: 3 }]);
    const pricing = priceOrderItems(prepared.items, prepared.productMap, 1234);

    expect(pricing.lines).toEqual([{ productId: 1, quantity: 3, unitPriceCents: 1234 }]);
    expect(pricing.totalCents).toBe(3702);
  });

  it("allows only the buyer to decide a responded quote and order its accepted quantity", () => {
    const quotation = { buyerId: 9, productId: 1, requestedQty: 3, quotedPriceCents: 1234, status: "responded" };
    expect(canDecideBuyerQuotation(9, quotation)).toBe(true);
    expect(canDecideBuyerQuotation(10, quotation)).toBe(false);
    expect(canDecideBuyerQuotation(9, { ...quotation, status: "accepted" })).toBe(false);
    expect(canPlaceAcceptedQuotationOrder(9, { ...quotation, status: "accepted" }, [{ productId: 1, quantity: 3 }])).toBe(true);
    expect(canPlaceAcceptedQuotationOrder(10, { ...quotation, status: "accepted" }, [{ productId: 1, quantity: 3 }])).toBe(false);
    expect(canPlaceAcceptedQuotationOrder(9, { ...quotation, status: "accepted" }, [{ productId: 1, quantity: 2 }])).toBe(false);
  });

  it("rolls back every stock deduction if any item is oversold", async () => {
    const stocks = new Map([[1, 10], [2, 2]]);

    await expect(applyInventoryDeductions(
      [{ productId: 1, quantity: 4 }, { productId: 2, quantity: 3 }],
      async applyDeduction => {
        const stagedStocks = new Map(stocks);
        await applyDeduction(async item => {
          const stock = stagedStocks.get(item.productId) ?? 0;
          if (stock < item.quantity) return false;
          stagedStocks.set(item.productId, stock - item.quantity);
          return true;
        });
        stocks.clear();
        for (const [productId, stock] of stagedStocks) stocks.set(productId, stock);
      },
    )).rejects.toThrow("Insufficient current inventory");

    expect(stocks).toEqual(new Map([[1, 10], [2, 2]]));
  });

  it("does not deduct inventory a second time when an order is already completed", async () => {
    const stocks = new Map([[1, 10]]);
    let orderStatus = "ready";
    const complete = async () => {
      if (!canTransitionOrder(orderStatus, "completed")) return false;
      await applyInventoryDeductions([{ productId: 1, quantity: 3 }], async applyDeduction => {
        const stagedStocks = new Map(stocks);
        await applyDeduction(async item => {
          const stock = stagedStocks.get(item.productId) ?? 0;
          if (stock < item.quantity) return false;
          stagedStocks.set(item.productId, stock - item.quantity);
          return true;
        });
        stocks.clear();
        for (const [productId, stock] of stagedStocks) stocks.set(productId, stock);
      });
      orderStatus = "completed";
      return true;
    };

    expect(await complete()).toBe(true);
    expect(await complete()).toBe(false);
    expect(stocks.get(1)).toBe(7);
  });

  it("protects the fulfillment workflow and transaction traceability", () => {
    expect(canTransitionOrder("submitted", "confirmed")).toBe(true);
    expect(canTransitionOrder("submitted", "completed")).toBe(false);
    expect(canTransitionOrder("completed", "ready")).toBe(false);
    expect(() => assertInventorySufficient(products, [{ productId: 2, quantity: 13 }])).toThrow("Insufficient current inventory");
    expect(transactionStatusFor()).toBe("recorded");
    expect(transactionStatusFor("Cash received at the cooperative office")).toBe("payment_coordinated");
  });
});

describe("quotation workflow rule", () => {
  it("allows a seller response only while a quotation is requested", () => {
    expect(isQuotationOpen("requested")).toBe(true);
    expect(isQuotationOpen("responded")).toBe(false);
    expect(isQuotationOpen("declined")).toBe(false);
  });

  it("prevents a farmer from creating a transaction against their own listing", () => {
    expect(() => assertNotSelfTransaction(12, 12)).toThrow("own listing");
    expect(() => assertNotSelfTransaction(12, 22)).not.toThrow();
  });
});
