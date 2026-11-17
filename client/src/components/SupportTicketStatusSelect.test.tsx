import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SupportTicketStatusSelect } from "./SupportTicketStatusSelect";

describe("SupportTicketStatusSelect", () => {
  it("offers only server-permitted transitions from resolved", () => {
    const markup = renderToStaticMarkup(createElement(SupportTicketStatusSelect, {
      status: "resolved",
      disabled: false,
      onChange: vi.fn(),
    }));

    expect(markup).toContain('value="resolved"');
    expect(markup).toContain('value="open"');
    expect(markup).toContain('value="closed"');
    expect(markup).not.toContain('value="in_progress"');
  });

  it("shows a closed ticket's current status without invalid transition choices", () => {
    const markup = renderToStaticMarkup(createElement(SupportTicketStatusSelect, {
      status: "closed",
      disabled: false,
      onChange: vi.fn(),
    }));

    expect(markup).toContain("Closed");
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("<option");
  });
});
