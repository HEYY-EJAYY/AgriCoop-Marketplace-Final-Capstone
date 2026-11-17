import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ROLE_CENTER_NAV, LOGGED_OUT_CENTER } from "@/navigation/roleNav";
import { describe, expect, it, vi } from "vitest";
import { MobileMenuOverlay } from "./MobileMenuOverlay";

vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
    onClick,
    className,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
    [key: string]: unknown;
  }) => (
    <a href={href} onClick={onClick} className={className} {...rest}>
      {children}
    </a>
  ),
  useLocation: () => ["/", vi.fn()] as const,
}));

vi.mock("@/const", () => ({
  goToAuth: vi.fn(),
}));

function markupFor(
  props: Partial<React.ComponentProps<typeof MobileMenuOverlay>> = {},
) {
  return renderToStaticMarkup(
    React.createElement(MobileMenuOverlay, {
      open: true,
      onClose: vi.fn(),
      navItems: LOGGED_OUT_CENTER,
      user: null,
      toggleRef: { current: null },
      ...props,
    }),
  );
}

describe("MobileMenuOverlay role menus", () => {
  it("logged-out menu shows guest nav and no logout", () => {
    const markup = markupFor({ navItems: LOGGED_OUT_CENTER, user: null });
    for (const item of LOGGED_OUT_CENTER) {
      expect(markup).toContain(`data-testid="mobile-menu-link-${item.label}"`);
    }
    expect(markup).toContain(">Login</a>");
    expect(markup).toContain(">Join AgriCoop</button>");
    expect(markup).not.toContain(">Log Out</button>");
  });

  for (const role of ["buyer", "seller", "admin", "superadmin"] as const) {
    it(`${role} menu lists ROLE_CENTER_NAV labels and account chip`, () => {
      const markup = markupFor({
        navItems: ROLE_CENTER_NAV[role],
        user: { name: `${role} User`, role },
        onLogout: vi.fn(),
      });
      for (const item of ROLE_CENTER_NAV[role]) {
        expect(markup).toContain(`>${item.label.replace(/&/g, "&amp;")}</a>`);
      }
      expect(markup).toContain('data-testid="mobile-menu-user-chip"');
      expect(markup).toContain(">Log Out</button>");
      expect(markup).toMatch(new RegExp(`${role} User`, "i"));
    });
  }

  it("renders a fixed overlay panel covering the viewport band", () => {
    const markup = markupFor({});
    expect(markup).toContain('data-testid="mobile-menu-panel"');
    expect(markup).toContain('data-testid="mobile-menu-backdrop"');
    expect(markup).toContain("100dvh");
  });
});
