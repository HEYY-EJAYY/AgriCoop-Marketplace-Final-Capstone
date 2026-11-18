import { describe, expect, it } from "vitest";
import { aggregateOrderItems, applyInventoryDeductions, assertInventorySufficient, assertNotSelfTransaction, assertPaymentConfirmed, availableStockAfterReservations, canCancelOrderPayment, canDecideBuyerQuotation, canPlaceAcceptedQuotationOrder, canTransitionOrder, isQuotationOpen, prepareOrder, prepareOrderCompletion, prepareProductReview, prepareProductUpdateReviewState, priceOrderItems, productPurchaseBlockReason, reconcilePaymentAmount, STOCK_RESERVING_ORDER_STATUSES, transactionStatusFor } from "./marketplaceRules";

const products = [
  { id: 1, sellerId: 12, cooperativeId: 3, stockQty: 20, minOrderQty: 2, priceCents: 5500, unit: "kg", status: "published", name: "Fresh Cabbage" },
  { id: 2, sellerId: 12, cooperativeId: 3, stockQty: 12, minOrderQty: 1, priceCents: 4000, unit: "kg", status: "published", name: "Sweet Corn" },
];

describe("marketplace order rules", () => {
  it("uses the same listing and seller eligibility rule across purchase surfaces", () => {
    const listing = {
      name: "Fresh Cabbage",
      unit: "kg",
      status: "published",
      verificationStatus: "approved",
      visibility: "visible",
      deletedAt: null,
      stockQty: 4,
      minOrderQty: 2,
      allowsPickup: true,
      allowsDelivery: true,
    };
    const seller = { approvalStatus: "approved", deletedAt: null };

    expect(productPurchaseBlockReason(listing, seller)).toBeNull();
    expect(productPurchaseBlockReason({ ...listing, stockQty: 1 }, seller)).toContain("minimum order is 2 kg");
    expect(productPurchaseBlockReason(listing, { ...seller, approvalStatus: "suspended" })).toContain("seller is not currently approved");
    expect(productPurchaseBlockReason({ ...listing, status: "archived" }, seller)).toContain("not currently listed");
    expect(productPurchaseBlockReason({ ...listing, allowsPickup: false, allowsDelivery: false }, seller))
      .toContain("no pickup or delivery option");
  });

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
      if (!canTransitionOrder(orderStatus, "completed")) throw new Error("This order is already completed or cancelled.");
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

    await expect(complete()).resolves.toBe(true);
    await expect(complete()).rejects.toThrow("already completed or cancelled");
    expect(stocks.get(1)).toBe(7);
  });

  it("uses edited delivered quantities to calculate the final amount and stock deduction", async () => {
    const orderedItems = [{ id: 101, productId: 1, quantity: 5, unitPriceCents: 5500 }];
    const completed = prepareOrderCompletion(
      orderedItems,
      [{ orderItemId: 101, quantity: 3 }],
    );
    const stocks = new Map([[1, 20]]);

    await applyInventoryDeductions(completed.items, async applyDeduction => {
      await applyDeduction(async deduction => {
        const stock = stocks.get(deduction.productId) ?? 0;
        if (stock < deduction.quantity) return false;
        stocks.set(deduction.productId, stock - deduction.quantity);
        return true;
      });
    });

    expect(completed.totalCents).toBe(16500);
    expect(stocks.get(1)).toBe(17);
  });

  it("rejects completion quantities that exceed the order quantity", () => {
    const orderedItems = [
      { id: 101, productId: 1, quantity: 5, unitPriceCents: 5500 },
      { id: 102, productId: 2, quantity: 4, unitPriceCents: 4000 },
    ];
    expect(() => prepareOrderCompletion(orderedItems, [
      { orderItemId: 101, quantity: 6 },
      { orderItemId: 102, quantity: 4 },
    ])).toThrow("cannot exceed the quantity ordered");
  });

  it("reserves availability across open orders without changing on-hand stock", () => {
    expect(availableStockAfterReservations(10, 7)).toBe(3);
    expect(availableStockAfterReservations(10, 11)).toBe(0);
    expect(STOCK_RESERVING_ORDER_STATUSES).toEqual(["submitted", "confirmed", "ready"]);
  });

  it("rejects insufficient current stock without deducting any item", async () => {
    const completed = prepareOrderCompletion(
      [
        { id: 101, productId: 1, quantity: 5, unitPriceCents: 5500 },
        { id: 102, productId: 2, quantity: 4, unitPriceCents: 4000 },
      ],
      [
        { orderItemId: 101, quantity: 3 },
        { orderItemId: 102, quantity: 4 },
      ],
    );
    const stocks = new Map([[1, 10], [2, 2]]);

    await expect(applyInventoryDeductions(completed.items, async applyDeduction => {
      const stagedStocks = new Map(stocks);
      await applyDeduction(async deduction => {
        const stock = stagedStocks.get(deduction.productId) ?? 0;
        if (stock < deduction.quantity) return false;
        stagedStocks.set(deduction.productId, stock - deduction.quantity);
        return true;
      });
      stocks.clear();
      for (const [productId, stock] of stagedStocks) stocks.set(productId, stock);
    })).rejects.toThrow("Insufficient current inventory");

    expect(stocks).toEqual(new Map([[1, 10], [2, 2]]));
  });

  it("rejects a completion when every delivered quantity is zero", () => {
    expect(() => prepareOrderCompletion(
      [{ id: 101, productId: 1, quantity: 5, unitPriceCents: 5500 }],
      [{ orderItemId: 101, quantity: 0 }],
    )).toThrow("At least one final delivered quantity");
  });

  it("does not deduct stock when an order is cancelled", () => {
    const stocks = new Map([[1, 20]]);
    expect(canTransitionOrder("ready", "cancelled")).toBe(true);
    expect(canTransitionOrder("cancelled", "completed")).toBe(false);
    expect(stocks.get(1)).toBe(20);
  });

  it("protects the fulfillment workflow and transaction traceability", () => {
    expect(canTransitionOrder("submitted", "confirmed")).toBe(true);
    expect(canTransitionOrder("submitted", "completed")).toBe(false);
    expect(canTransitionOrder("completed", "ready")).toBe(false);
    expect(() => assertInventorySufficient(products, [{ productId: 2, quantity: 13 }])).toThrow("Insufficient current inventory");
    expect(transactionStatusFor()).toBe("recorded");
    expect(transactionStatusFor("Cash received at the cooperative office")).toBe("payment_coordinated");
    expect(transactionStatusFor(undefined, "paid")).toBe("paid");
    expect(transactionStatusFor(undefined, "refunded")).toBe("paid");
    expect(transactionStatusFor(undefined, "failed")).toBe("failed");
    expect(transactionStatusFor(undefined, "awaiting_verification")).toBe("pending");
  });

  it("only permits cancellation when payment, order, and transaction states agree", () => {
    expect(canCancelOrderPayment("pending", "pending", "payment_coordinated")).toBe(true);
    expect(canCancelOrderPayment("awaiting_verification", "pending", "payment_coordinated")).toBe(true);
    expect(canCancelOrderPayment("verified", "paid", "paid")).toBe(false);
    expect(canCancelOrderPayment("refunded", "refunded", "paid")).toBe(true);
    expect(canCancelOrderPayment("pending", "paid", "payment_coordinated")).toBe(false);
    expect(canCancelOrderPayment("refunded", "paid", "paid")).toBe(false);
    expect(canCancelOrderPayment("pending", "verified", "payment_coordinated")).toBe(false);
  });

  it("reconciles an unpaid payment amount and blocks changes to non-pending payments", () => {
    expect(reconcilePaymentAmount({ amountCents: 1000, status: "pending" }, 800)).toEqual({
      previousAmountCents: 1000,
      amountCents: 800,
    });
    expect(reconcilePaymentAmount({ amountCents: 1000, status: "pending" }, 1000)).toBeNull();
    expect(() => reconcilePaymentAmount({ amountCents: 1000, status: "verified" }, 800))
      .toThrow("payment is no longer pending");
    expect(() => reconcilePaymentAmount({ amountCents: 1000, status: "awaiting_verification" }, 800))
      .toThrow("payment is no longer pending");
  });

  it("requires a verified payment before order completion", () => {
    expect(() => assertPaymentConfirmed({ status: "verified" })).not.toThrow();
    for (const status of ["pending", "awaiting_verification", "failed", "cancelled", "refunded", "expired"]) {
      expect(() => assertPaymentConfirmed({ status }))
        .toThrow("Payment must be verified before the order can be completed.");
    }
  });
});

describe("quotation workflow rule", () => {
  it("allows a seller response only while a quotation is requested", () => {
    expect(isQuotationOpen("requested")).toBe(true);
    expect(isQuotationOpen("responded")).toBe(false);
    expect(isQuotationOpen("declined")).toBe(false);
  });

  describe("product review rules", () => {
    const currentProduct = {
      verificationStatus: "approved",
      name: "Fresh Cabbage",
      category: "Vegetables",
      variety: "Green",
      description: "Harvested this week",
      unit: "kg",
      priceCents: 5500,
      minOrderQty: 2,
      qualityGrade: "standard",
      primaryImageUrl: "seller-image-1",
    };

    it("only reviews pending submissions and requires a reason for rejection", () => {
      expect(prepareProductReview("pending", "approved")).toEqual({
        verificationStatus: "approved",
        visibility: "visible",
        status: "published",
        rejectionReason: null,
      });
      expect(() => prepareProductReview("approved", "rejected", "Needs correction")).toThrow("Only a pending");
      expect(() => prepareProductReview("pending", "rejected", "  ")).toThrow("rejection reason");
      expect(prepareProductReview("pending", "rejected", "  Missing quality details  ").rejectionReason)
        .toBe("Missing quality details");
    });

    it("requires re-review when approved listing content or its image gallery changes", () => {
      expect(prepareProductUpdateReviewState(
        currentProduct,
        { description: "Updated harvest details" },
        ["seller-image-1"],
        ["seller-image-1"],
        "seller-image-1",
      )).toEqual({
        reviewRequired: true,
        moderationUpdate: {
          verificationStatus: "pending",
          visibility: "hidden",
          rejectionReason: null,
        },
      });
      expect(prepareProductUpdateReviewState(
        currentProduct,
        {},
        ["seller-image-1", "seller-image-2"],
        ["seller-image-2", "seller-image-1"],
        "seller-image-2",
      ).reviewRequired).toBe(true);
    });

    it("does not require moderation for inventory or archive-only changes", () => {
      expect(prepareProductUpdateReviewState(
        currentProduct,
        { stockQty: 0, status: "archived" },
        ["seller-image-1"],
        ["seller-image-1"],
        "seller-image-1",
      )).toEqual({
        reviewRequired: false,
        moderationUpdate: {},
      });
    });

    it("leaves unapproved edits in their existing review workflow", () => {
      expect(prepareProductUpdateReviewState(
        { ...currentProduct, verificationStatus: "pending" },
        { description: "Updated before review" },
        ["seller-image-1"],
        ["seller-image-1"],
        "seller-image-1",
      )).toEqual({ reviewRequired: false, moderationUpdate: {} });
    });
  });

  it("prevents a farmer from creating a transaction against their own listing", () => {
    expect(() => assertNotSelfTransaction(12, 12)).toThrow("own listing");
    expect(() => assertNotSelfTransaction(12, 22)).not.toThrow();
  });
});
