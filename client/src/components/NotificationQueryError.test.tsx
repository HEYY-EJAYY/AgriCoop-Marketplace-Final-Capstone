import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NotificationQueryError } from "./NotificationQueryError";

describe("NotificationQueryError", () => {
  it("shows a retry action when notification loading fails", () => {
    const markup = renderToStaticMarkup(createElement(NotificationQueryError, {
      message: "Notifications could not be loaded.",
      isRetrying: false,
      onRetry: vi.fn(),
    }));

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Notifications could not be loaded.");
    expect(markup).toContain(">Retry</button>");
  });

  it("disables retry while a request is in flight", () => {
    const markup = renderToStaticMarkup(createElement(NotificationQueryError, {
      message: "Notifications could not be loaded.",
      isRetrying: true,
      onRetry: vi.fn(),
    }));

    expect(markup).toContain('disabled=""');
    expect(markup).toContain("Retrying...");
  });
});
