import { describe, expect, it } from "vitest";
import {
  cooperativePickupAddressLine,
  formatPickupAddress,
  hasStructuredPickupAddress,
  isPickupAddressComplete,
  pickupAddressSnapshotFields,
} from "./pickupAddress";

const full = {
  pickupProvince: "Batangas",
  pickupCity: "Mabini",
  pickupBarangay: "San Isidro",
  pickupStreetAddress: "Brgy. Hall, Mabini St.",
};

describe("cooperative pickup address helpers", () => {
  it("detects whether any structured part exists", () => {
    expect(hasStructuredPickupAddress(full)).toBe(true);
    expect(hasStructuredPickupAddress({ pickupCity: "  " })).toBe(false);
    expect(hasStructuredPickupAddress({})).toBe(false);
  });

  it("requires all four parts for a complete address", () => {
    expect(isPickupAddressComplete(full)).toBe(true);
    expect(isPickupAddressComplete({ ...full, pickupBarangay: "" })).toBe(false);
  });

  it("formats parts in street → province order and skips blanks", () => {
    expect(formatPickupAddress(full)).toBe("Brgy. Hall, Mabini St., San Isidro, Mabini, Batangas");
    expect(formatPickupAddress({ pickupCity: "Mabini", pickupProvince: "Batangas" })).toBe("Mabini, Batangas");
    expect(formatPickupAddress({})).toBe("");
  });

  it("prefers structured parts and falls back to legacy address/location", () => {
    expect(cooperativePickupAddressLine({ ...full, address: "Old address", location: "Old, Place" }))
      .toBe("Brgy. Hall, Mabini St., San Isidro, Mabini, Batangas");
    expect(cooperativePickupAddressLine({ address: "123 Main St", location: "Mabini, Batangas" }))
      .toBe("123 Main St, Mabini, Batangas");
    expect(cooperativePickupAddressLine({})).toBe("");
  });

  it("builds null-safe snapshot fields", () => {
    expect(pickupAddressSnapshotFields({ pickupCity: " Mabini ", pickupProvince: null }))
      .toEqual({ province: null, city: "Mabini", barangay: null, streetAddress: null });
  });
});
