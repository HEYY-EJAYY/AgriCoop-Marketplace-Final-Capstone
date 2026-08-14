import { describe, expect, it } from "vitest";
import { canManageSellerOrder, hasRole } from "./authz";

describe("AgriCoop role authorization", () => {
  it("admits only explicitly allowed marketplace roles", () => {
    expect(hasRole("buyer", ["buyer"])).toBe(true);
    expect(hasRole("buyer", ["seller", "officer"])).toBe(false);
    expect(hasRole("seller", ["buyer", "seller"])).toBe(true);
    expect(hasRole("officer", ["buyer", "seller"])).toBe(false);
  });

  it("allows a seller only to manage their own orders, while admins retain oversight", () => {
    expect(canManageSellerOrder({ id: 9, role: "seller" }, 9)).toBe(true);
    expect(canManageSellerOrder({ id: 9, role: "seller" }, 10)).toBe(false);
    expect(canManageSellerOrder({ id: 1, role: "admin" }, 10)).toBe(true);
  });
});
