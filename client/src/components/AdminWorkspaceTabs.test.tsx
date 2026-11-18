import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminWorkspaceTabs, parseAdminWorkspaceTab } from "./AdminWorkspaceTabs";

const locationState = vi.hoisted(() => ({
  search: "",
  path: "/dashboard",
}));

vi.mock("wouter", () => ({
  useSearch: () => locationState.search,
  useLocation: () => [locationState.path, vi.fn()] as const,
}));

describe("parseAdminWorkspaceTab", () => {
  it("defaults to moderation and accepts known tabs", () => {
    expect(parseAdminWorkspaceTab("")).toBe("moderation");
    expect(parseAdminWorkspaceTab("?tab=orders")).toBe("orders");
    expect(parseAdminWorkspaceTab("tab=users")).toBe("users");
    expect(parseAdminWorkspaceTab("?tab=payments")).toBe("payments");
    expect(parseAdminWorkspaceTab("?tab=nope")).toBe("moderation");
  });
});

describe("AdminWorkspaceTabs", () => {
  it("renders ARIA tablist with Moderation selected by default", () => {
    locationState.search = "";
    const markup = renderToStaticMarkup(
      React.createElement(AdminWorkspaceTabs, {
        panels: {
          moderation: React.createElement("div", null, "Moderation body"),
          orders: React.createElement("div", null, "Orders body"),
          payments: React.createElement("div", null, "Payments body"),
          users: React.createElement("div", null, "Users body"),
        },
      }),
    );
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('role="tab"');
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("Moderation body");
    expect(markup).toContain('data-testid="admin-tab-moderation"');
    expect(markup).toContain('data-testid="admin-tab-orders"');
    expect(markup).toContain('data-testid="admin-tab-users"');
    expect(markup).not.toContain("Orders body");
  });

  it("shows the orders panel when ?tab=orders is in the URL", () => {
    locationState.search = "?tab=orders";
    const markup = renderToStaticMarkup(
      React.createElement(AdminWorkspaceTabs, {
        panels: {
          moderation: React.createElement("div", null, "Moderation body"),
          orders: React.createElement("div", null, "Orders body"),
          payments: React.createElement("div", null, "Payments body"),
          users: React.createElement("div", null, "Users body"),
        },
      }),
    );
    expect(markup).toContain("Orders body");
    expect(markup).toMatch(/aria-selected="true"[^>]*data-testid="admin-tab-orders"|data-testid="admin-tab-orders"[^>]*aria-selected="true"/);
    expect(markup).toContain('data-testid="admin-panel-orders"');
  });

  it("shows the users panel when ?tab=users is in the URL", () => {
    locationState.search = "?tab=users";
    const markup = renderToStaticMarkup(
      React.createElement(AdminWorkspaceTabs, {
        panels: {
          moderation: React.createElement("div", null, "Moderation body"),
          orders: React.createElement("div", null, "Orders body"),
          payments: React.createElement("div", null, "Payments body"),
          users: React.createElement("div", null, "Users body"),
        },
      }),
    );
    expect(markup).toContain("Users body");
    expect(markup).toMatch(/aria-selected="true"[^>]*data-testid="admin-tab-users"|data-testid="admin-tab-users"[^>]*aria-selected="true"/);
    expect(markup).toContain('data-testid="admin-panel-users"');
  });
});
