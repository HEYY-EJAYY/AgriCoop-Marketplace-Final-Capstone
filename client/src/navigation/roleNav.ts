import type { AppRole } from "@/lib/roleLabels";

export type NavItem = {
  label: string;
  href: string;
  /** Exact match unless ends with prefix match when matchPrefix true */
  matchPrefix?: boolean;
};

export const LOGGED_OUT_CENTER: NavItem[] = [
  { label: "Marketplace", href: "/marketplace", matchPrefix: true },
  { label: "How It Works", href: "/about" },
  { label: "Support", href: "/support" },
];

export const ROLE_CENTER_NAV: Record<AppRole, NavItem[]> = {
  buyer: [
    { label: "Marketplace", href: "/marketplace", matchPrefix: true },
    { label: "My Orders", href: "/activity", matchPrefix: true },
    { label: "Messages", href: "/messages", matchPrefix: true },
    { label: "Support", href: "/support", matchPrefix: true },
  ],
  seller: [
    { label: "Marketplace", href: "/marketplace", matchPrefix: true },
    { label: "Seller Center", href: "/dashboard", matchPrefix: true },
    { label: "Messages", href: "/messages", matchPrefix: true },
    { label: "Support", href: "/support", matchPrefix: true },
  ],
  admin: [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Moderation", href: "/dashboard#moderation" },
    { label: "Orders", href: "/dashboard#orders" },
    { label: "Users", href: "/dashboard#users" },
    { label: "Support & Tickets", href: "/support-tickets", matchPrefix: true },
  ],
  superadmin: [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Users & Roles", href: "/dashboard#users" },
    { label: "Moderation", href: "/dashboard#moderation" },
    { label: "Orders", href: "/dashboard#orders" },
    { label: "System", href: "/admin/payment-options", matchPrefix: true },
    { label: "Audit Logs", href: "/admin/audit-logs", matchPrefix: true },
  ],
};

export function centerNavForRole(role: string | null | undefined): NavItem[] {
  if (role === "buyer" || role === "seller" || role === "admin" || role === "superadmin") {
    return ROLE_CENTER_NAV[role];
  }
  return LOGGED_OUT_CENTER;
}

export function isNavActive(location: string, item: NavItem): boolean {
  const path = location.split("?")[0].split("#")[0];
  const hrefPath = item.href.split("?")[0].split("#")[0];
  if (item.matchPrefix) return path === hrefPath || path.startsWith(`${hrefPath}/`);
  return path === hrefPath;
}

export type MobileNavItem = {
  label: string;
  href: string;
  key: "home" | "browse" | "cart" | "orders" | "messages" | "account" | "tickets" | "dashboard";
};

/** Bottom nav for logged-in users; guests use Home / Browse / Join destinations. */
export function mobileBottomNav(role: string | null | undefined, loggedIn: boolean): MobileNavItem[] {
  if (!loggedIn) {
    return [
      { label: "Home", href: "/", key: "home" },
      { label: "Browse", href: "/marketplace", key: "browse" },
      { label: "Join", href: "/auth", key: "account" },
    ];
  }
  if (role === "buyer") {
    return [
      { label: "Home", href: "/", key: "home" },
      { label: "Browse", href: "/marketplace", key: "browse" },
      { label: "Cart", href: "/marketplace#order", key: "cart" },
      { label: "Orders", href: "/activity", key: "orders" },
      { label: "Account", href: "/dashboard", key: "account" },
    ];
  }
  if (role === "seller") {
    return [
      { label: "Home", href: "/", key: "home" },
      { label: "Browse", href: "/marketplace", key: "browse" },
      { label: "Center", href: "/dashboard", key: "dashboard" },
      { label: "Messages", href: "/messages", key: "messages" },
      { label: "Account", href: "/profile", key: "account" },
    ];
  }
  if (role === "admin" || role === "superadmin") {
    return [
      { label: "Home", href: "/", key: "home" },
      { label: "Dash", href: "/dashboard", key: "dashboard" },
      { label: "Tickets", href: "/support-tickets", key: "tickets" },
      { label: "Messages", href: "/messages", key: "messages" },
      { label: "Account", href: "/profile", key: "account" },
    ];
  }
  return [
    { label: "Home", href: "/", key: "home" },
    { label: "Browse", href: "/marketplace", key: "browse" },
    { label: "Account", href: "/dashboard", key: "account" },
  ];
}
