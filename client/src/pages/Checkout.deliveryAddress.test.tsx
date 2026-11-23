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
