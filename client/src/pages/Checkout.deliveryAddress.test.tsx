import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(import.meta.dirname, "Checkout.tsx"), "utf8");

describe("Checkout delivery-address enforcement", () => {
  it("requires a complete address before submit when any group uses delivery", () => {
    expect(source).toContain("needsDeliveryAddress");
    expect(source).toContain("deliveryAddressComplete");
    expect(source).toMatch(/canSubmit[\s\S]*!needsDeliveryAddress \|\| deliveryAddressComplete/);
    expect(source).toMatch(/disabled=\{!canSubmit \|\| createOrder\.isPending\}/);
  });

  it("validates every required address field with trim-based minimums", () => {
    for (const field of ["recipientName", "contactNumber", "province", "city", "barangay", "streetAddress"]) {
      expect(source).toContain(`delivery.${field}.trim()`);
    }
  });

  it("only sends deliveryDetails for delivery fulfillment and keeps address state across payment changes", () => {
    expect(source).toContain('choice.fulfillmentMethod === "delivery" ? deliveryPayload : undefined');
    // every setDelivery call is a spread update — the address is never reset on choice changes
    const updates = source.match(/setDelivery\(\{[^}]*\}\)/g) ?? [];
    expect(updates.length).toBeGreaterThan(0);
    for (const call of updates) expect(call).toContain("...delivery");
    expect(source).toMatch(/const \[delivery, setDelivery\] = useState/);
  });

  it("shows a visible warning while the address is incomplete", () => {
    expect(source).toContain("Complete all required address fields to place a delivery order.");
  });
});

describe("Checkout delivery minimum weight", () => {
  it("computes weight via the shared orderWeight utility and blocks delivery below 20 kg", () => {
    expect(source).toContain("orderWeightGrams");
    expect(source).toContain("DELIVERY_MIN_WEIGHT_GRAMS");
    expect(source).toContain("deliveryWeightBlockReason");
    expect(source).toContain("fulfillmentOptionsForCart");
    expect(source).toContain("Minimum order weight for Delivery is 20 kg.");
  });

  it("disables the Delivery radio and explains why instead of hiding it", () => {
    expect(source).toContain("deliveryBlockedReason");
    expect(source).toMatch(/disabled=\{blocked\}/);
    expect(source).toContain('option === "delivery" && Boolean(deliveryBlockedReason)');
  });

  it("keeps Pickup available and coerces stale delivery selections through fulfillmentOptionsForCart", () => {
    expect(source).toContain('base.filter(option => option !== "delivery")');
    expect(source).toContain('?? "pickup"');
  });
});
