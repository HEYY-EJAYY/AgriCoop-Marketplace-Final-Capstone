import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusPill } from "./StatusPill";
import { formatCombinedEnumLabels } from "../../../shared/enumLabels";

describe("enum labels", () => {
  it.each([
    ["in_progress", "In Progress"],
    ["awaiting_verification", "Awaiting Verification"],
    ["F2F-pending-confirmation", "F2F Pending Confirmation"],
  ])("renders %s as %s rather than a raw enum", (value, label) => {
    const markup = renderToStaticMarkup(React.createElement(StatusPill, { value }));
    expect(markup).toContain(`>${label}</span>`);
    expect(markup).not.toContain(`>${value}</span>`);
  });

  it("formats combined product states with the required separator", () => {
    expect(formatCombinedEnumLabels("published", "approved")).toBe("Published - Approved");
  });
});
