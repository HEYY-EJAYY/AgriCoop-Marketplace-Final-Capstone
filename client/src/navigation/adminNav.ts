import {
  BadgeCheck,
  BarChart3,
  ClipboardList,
  HeartPulse,
  LayoutDashboard,
  LifeBuoy,
  Package,
  QrCode,
  ScrollText,
  Settings,
  ShieldCheck,
  Store,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

export type AdminNavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Section key rendered inside /dashboard via ?section= */
  section?: string;
  /** Direct route for shared standalone pages */
  href?: string;
};

/** OfficerAdmin (role "admin"): daily cooperative marketplace operations. */
export const OFFICER_ADMIN_NAV: AdminNavItem[] = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard, section: "overview" },
  { id: "buyers", label: "Buyer Management", icon: Users, section: "buyers" },
  { id: "sellers", label: "Seller Management", icon: Store, section: "sellers" },
  { id: "orders", label: "Order Management", icon: ClipboardList, section: "orders" },
  { id: "payments", label: "Payment Verification", icon: BadgeCheck, section: "payments" },
  { id: "payment-options", label: "Cooperative Payment Options", icon: QrCode, href: "/admin/payment-options" },
  { id: "cooperative", label: "My Cooperative", icon: Store, section: "cooperative" },
  { id: "products", label: "Products & Listings", icon: Package, section: "products" },
  { id: "reports", label: "Reports & Transactions", icon: BarChart3, href: "/reports" },
  { id: "support", label: "Support & Messages", icon: LifeBuoy, href: "/support-tickets" },
  { id: "profile", label: "Profile", icon: UserRound, href: "/profile" },
];

/** SuperAdmin (role "superadmin"): platform ownership, not daily cooperative ops. */
export const SUPERADMIN_NAV: AdminNavItem[] = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard, section: "overview" },
  { id: "users", label: "User Management", icon: Users, section: "users" },
  { id: "officer-admins", label: "OfficerAdmin Management", icon: ShieldCheck, section: "applications" },
  { id: "cooperatives", label: "Cooperative Management", icon: Store, section: "cooperatives" },
  { id: "products", label: "Product Management", icon: Package, section: "products" },
  { id: "settings", label: "Website & Platform Settings", icon: Settings, section: "settings" },
  { id: "health", label: "System Health", icon: HeartPulse, section: "health" },
  { id: "audit", label: "Security & Audit Logs", icon: ScrollText, href: "/admin/audit-logs" },
  { id: "profile", label: "Profile", icon: UserRound, href: "/profile" },
];

export function adminNavForRole(role: string | null | undefined): AdminNavItem[] {
  if (role === "superadmin") return SUPERADMIN_NAV;
  if (role === "admin") return OFFICER_ADMIN_NAV;
  return [];
}

/** Legacy ?tab= ids mapped onto sidebar section ids. */
const LEGACY_TAB_TO_SECTION: Record<string, string> = {
  moderation: "products",
  orders: "orders",
  quotations: "orders",
  payments: "payments",
  users: "users",
  applications: "applications",
};

/** Resolve the active dashboard section from the query string. */
export function adminSectionFromSearch(search: string, role?: string | null): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const section = params.get("section");
  if (section) return section;
  const legacy = params.get("tab");
  if (legacy) {
    const mapped = LEGACY_TAB_TO_SECTION[legacy] ?? legacy;
    // Officers never had a platform-wide "users" tab; land them on buyers instead.
    if (mapped === "users" && role === "admin") return "buyers";
    return mapped;
  }
  return "overview";
}

export function adminNavItemForLocation(
  items: AdminNavItem[],
  location: string,
  search: string,
): AdminNavItem | undefined {
  const path = location.split("?")[0];
  const section = adminSectionFromSearch(search);
  return items.find(item => {
    if (item.section) {
      return path === "/dashboard" && item.section === section;
    }
    if (item.href) {
      const hrefPath = item.href.split("?")[0];
      return path === hrefPath || path.startsWith(`${hrefPath}/`);
    }
    return false;
  });
}
