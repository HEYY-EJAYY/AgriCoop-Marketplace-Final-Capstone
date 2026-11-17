import { formatUserRoleChip } from "@/lib/roleLabels";
import { isNavActive, type NavItem } from "@/navigation/roleNav";
import { goToAuth } from "@/const";
import React, { useEffect, useId, useRef } from "react";
import { Link, useLocation } from "wouter";

const MENU_ID = "agri-mobile-menu";

export type MobileMenuUser = {
  name: string | null;
  role: string | null;
} | null;

type MobileMenuOverlayProps = {
  open: boolean;
  onClose: () => void;
  navItems: NavItem[];
  user: MobileMenuUser;
  onLogout?: () => void;
  /** Header toggle button — used for focus return and aria-controls pairing */
  toggleRef: React.RefObject<HTMLButtonElement | null>;
};

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(el => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true");
}

/** Scroll lock that preserves layout width when the scrollbar disappears. */
function lockBodyScroll() {
  const scrollY = window.scrollY;
  const scrollbarGap = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
  const body = document.body;
  body.dataset.agriScrollY = String(scrollY);
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  if (scrollbarGap > 0) {
    body.style.paddingRight = `${scrollbarGap}px`;
    document.documentElement.style.setProperty("--agri-scrollbar-gap", `${scrollbarGap}px`);
  }
}

function unlockBodyScroll() {
  const body = document.body;
  const scrollY = Number(body.dataset.agriScrollY || "0");
  body.style.position = "";
  body.style.top = "";
  body.style.left = "";
  body.style.right = "";
  body.style.width = "";
  body.style.paddingRight = "";
  document.documentElement.style.removeProperty("--agri-scrollbar-gap");
  delete body.dataset.agriScrollY;
  window.scrollTo(0, scrollY);
}

const itemClass =
  "flex min-h-11 w-full max-w-sm items-center justify-center rounded-2xl px-4 text-base font-bold text-[#163b2a] no-underline transition-colors hover:bg-[#edf3e9] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#eab75d]";

/**
 * Shared mobile nav overlay for all roles.
 * Root cause of prior CLS: menu was an in-flow block under the header.
 */
export function MobileMenuOverlay({
  open,
  onClose,
  navItems,
  user,
  onLogout,
  toggleRef,
}: MobileMenuOverlayProps) {
  const [location] = useLocation();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const openRef = useRef(open);
  const onCloseRef = useRef(onClose);
  openRef.current = open;
  onCloseRef.current = onClose;
  // Close on route change while open (location-only; open/onClose refs avoid self-close)
  useEffect(() => {
    if (openRef.current) onCloseRef.current();
  }, [location]);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    lockBodyScroll();

    const main = document.querySelector("main");
    const footer = document.querySelector("footer");
    const bottomNav = document.querySelector('[aria-label="Mobile primary"]');
    const marked: HTMLElement[] = [];
    for (const el of [main, footer, bottomNav]) {
      if (el instanceof HTMLElement) {
        el.setAttribute("aria-hidden", "true");
        el.inert = true;
        marked.push(el);
      }
    }

    const focusFirst = () => {
      const panel = panelRef.current;
      const focusables = panel ? getFocusable(panel) : [];
      focusables[0]?.focus();
    };
    const focusTimer = window.setTimeout(focusFirst, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      const panel = panelRef.current;
      if (event.key !== "Tab" || !panel) return;
      const items = getFocusable(panel);
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    const onResize = () => {
      if (window.matchMedia("(min-width: 1024px)").matches) onCloseRef.current();
    };

    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      unlockBodyScroll();
      for (const el of marked) {
        el.removeAttribute("aria-hidden");
        el.inert = false;
      }
      const restore = toggleRef.current ?? previouslyFocused.current;
      restore?.focus();
    };
  }, [open, toggleRef]);

  if (!open) return null;

  return (
    <div className="lg:hidden" data-testid="mobile-menu-root">
      <button
        type="button"
        className="fixed inset-0 z-[45] bg-[#102c1e]/45 backdrop-blur-[2px]"
        style={{ height: "100dvh" }}
        aria-label="Close menu"
        data-testid="mobile-menu-backdrop"
        onClick={onClose}
      />
      <div
        id={MENU_ID}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="mobile-menu-panel"
        className="fixed inset-x-0 bottom-0 z-[46] flex flex-col overflow-y-auto border-t border-[#dce4d6] bg-[#fffdf8]/96 shadow-[0_-12px_40px_rgba(22,59,42,0.12)] supports-[backdrop-filter]:bg-[#fffdf8]/88 supports-[backdrop-filter]:backdrop-blur-md"
        style={{ top: "4rem", height: "calc(100dvh - 4rem)" }}
      >
        <h2 id={titleId} className="sr-only">
          Site menu
        </h2>
        <nav
          aria-label="Mobile site"
          className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-2 px-6 py-8"
          data-testid="mobile-menu-nav"
        >
          {navItems.map(item => (
            <Link
              key={item.href + item.label}
              href={item.href}
              onClick={onClose}
              className={`${itemClass} ${isNavActive(location, item) ? "bg-[#e7f1df] text-[#1f5a3c]" : ""}`}
              data-testid={`mobile-menu-link-${item.label}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div
          className="mx-auto flex w-full max-w-lg flex-col items-center gap-2 border-t border-[#e3e9de] px-6 py-6"
          data-testid="mobile-menu-account"
        >
          {user ? (
            <>
              <p className="text-center text-sm font-bold text-[#315640]" data-testid="mobile-menu-user-chip">
                {formatUserRoleChip(user.name, user.role)}
              </p>
              <Link href="/profile" onClick={onClose} className={itemClass}>
                My Profile
              </Link>
              <Link href="/dashboard" onClick={onClose} className={itemClass}>
                My Workspace
              </Link>
              <Link href="/messages" onClick={onClose} className={itemClass}>
                Messages
              </Link>
              <Link href="/support" onClick={onClose} className={itemClass}>
                Support
              </Link>
              <button
                type="button"
                className={`${itemClass} text-[#a34838]`}
                onClick={() => {
                  onClose();
                  onLogout?.();
                }}
              >
                Log Out
              </button>
            </>
          ) : (
            <>
              <Link href="/auth" onClick={onClose} className={itemClass}>
                Login
              </Link>
              <button
                type="button"
                className="flex min-h-11 w-full max-w-sm items-center justify-center rounded-2xl bg-[#1f4f36] px-4 text-base font-bold text-[#fffdf8] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#eab75d]"
                onClick={() => {
                  onClose();
                  goToAuth("PublicHeader.drawer");
                }}
              >
                Join AgriCoop
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export const MOBILE_MENU_ID = MENU_ID;

export function MobileMenuToggle({
  open,
  onToggle,
  toggleRef,
}: {
  open: boolean;
  onToggle: () => void;
  toggleRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={toggleRef}
      type="button"
      className="grid h-11 w-11 place-items-center rounded-xl text-[#1f5a3c] hover:bg-[#edf3e9] lg:hidden"
      onClick={onToggle}
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      aria-controls={MENU_ID}
      data-testid="mobile-menu-toggle"
    >
      <MobileMenuIcon open={open} />
    </button>
  );
}

function MobileMenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
      className="transition-transform duration-200 ease-out motion-reduce:transition-none"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
    >
      {open ? (
        <>
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="6" y1="18" x2="18" y2="6" />
        </>
      ) : (
        <>
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </>
      )}
    </svg>
  );
}
