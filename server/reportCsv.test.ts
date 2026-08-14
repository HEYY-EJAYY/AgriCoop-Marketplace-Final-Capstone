import { describe, expect, it } from "vitest";
import { buildCsv } from "../shared/reportCsv";

describe("CSV report serialization", () => {
  it("preserves report columns and safely escapes payment-reference notes", () => {
    const csv = buildCsv([
      ["Transaction ID", "Payment reference", "Status"],
      [12, 'Cash "received" at cooperative office', "payment_coordinated"],
    ]);

    expect(csv).toBe('"Transaction ID","Payment reference","Status"\n"12","Cash ""received"" at cooperative office","payment_coordinated"');
  });

  it("renders missing report fields as empty cells without losing column structure", () => {
    expect(buildCsv([["Quotation", null, undefined, 0]])).toBe('"Quotation","","","0"');
  });
});
