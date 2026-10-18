import { describe, expect, it } from "vitest";
import { formatDateManila, formatDateTimeManila, formatRelativeTime, formatTimeManila } from "../client/src/lib/datetime";
import { buildCsv } from "../shared/reportCsv";

describe("Manila datetime helpers", () => {
  it("formats timestamps in Asia/Manila date and time", () => {
    const timestamp = new Date("2026-10-19T15:42:00Z");

    expect(formatDateManila(timestamp)).toBe("Oct 19, 2026");
    expect(formatTimeManila(timestamp)).toBe("11:42 PM");
    expect(formatDateTimeManila(timestamp)).toBe("Oct 19, 2026, 11:42 PM");
  });

  it("provides a relative-time string for secondary text", () => {
    const now = new Date("2026-10-19T15:42:00Z");
    const earlier = new Date("2026-10-19T15:40:00Z");

    expect(formatRelativeTime(earlier, now)).toBe("2 minutes ago");
  });
});

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

  it("splits CSV date and time columns in Manila time", () => {
    const timestamp = new Date("2026-10-19T15:42:00Z");
    const csv = buildCsv([
      ["Transaction ID", "Date (PH)", "Time (PH)", "Status"],
      [12, formatDateManila(timestamp), formatTimeManila(timestamp), "paid"],
    ]);

    expect(csv).toBe('"Transaction ID","Date (PH)","Time (PH)","Status"\n"12","Oct 19, 2026","11:42 PM","paid"');
  });
});
