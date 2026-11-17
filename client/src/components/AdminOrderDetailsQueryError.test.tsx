import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminOrderDetailsQueryError } from "./AdminOrderDetailsQueryError";

describe("AdminOrderDetailsQueryError", () => {
  it("displays the order error and a working retry callback", () => {
    const onRetry = vi.fn();
    const element = AdminOrderDetailsQueryError({
      orderId: 42,
      message: "Request failed.",
      isRetrying: false,
      onRetry,
    });
    const children = React.Children.toArray(
      (element as React.ReactElement<{ children: React.ReactNode }>).props.children,
    );
    const retryButton = children[1] as React.ReactElement<{ onClick: () => void }>;

    expect(renderToStaticMarkup(element)).toContain("Could not load order #42: Request failed.");
    expect(renderToStaticMarkup(element)).toContain(">Retry</button>");
    retryButton.props.onClick();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("disables retry while the order query is refetching", () => {
    const markup = renderToStaticMarkup(React.createElement(AdminOrderDetailsQueryError, {
      orderId: 42,
      message: "Request failed.",
      isRetrying: true,
      onRetry: vi.fn(),
    }));

    expect(markup).toContain('disabled=""');
    expect(markup).toContain("Retrying...");
  });
});
