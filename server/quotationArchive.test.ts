import { describe, expect, it } from "vitest";
import { assertBuyerOwnsOrders } from "./orderArchive";

describe("per-user archive ownership", () => {
  it("rejects when another party's ids are included", () => {
    expect(() => assertBuyerOwnsOrders([1, 2], [{ id: 1 }])).toThrow();
  });

  it("accepts when every id is owned by the actor", () => {
    expect(() => assertBuyerOwnsOrders([7, 8], [{ id: 7 }, { id: 8 }])).not.toThrow();
  });
});
