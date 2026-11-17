import { useAuth } from "@/_core/hooks/useAuth";
import { goToAuth } from "@/const";
import { Button } from "@/components/ui/button";
import { NotificationQueryError } from "@/components/NotificationQueryError";
import { formatUserRoleChip, roleDisplayLabel } from "@/lib/roleLabels";
import { trpc } from "@/lib/trpc";
import {
  LOGGED_OUT_CENTER,
  centerNavForRole,
  isNavActive,
  mobileBottomNav,
  type MobileNavItem,
  type NavItem,
} from "@/navigation/roleNav";
import {
  Bell,
  ChevronDown,
  Home,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  MessageSquare,
  Package,
  ShoppingBasket,
  Ticket,
  UserRound,
  X,
} from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

/** Shared content width — see --agri-content-max / .agri-shell in index.css */
const SHELL = "agri-shell";

export const shellContainerClass = SHELL;
export const fullBleedClass = "agri-full-bleed";

const navLinkClass = (active: boolean) =>
  `inline-flex min-h-11 items-center whitespace-nowrap rounded-xl px-3 text-sm font-bold no-underline ${
    active ? "text-[#1f5a3c]" : "text-[#647365] hover:text-[#1f5a3c] hover:bg-[#edf3e9]"
  }`;

function NavLinks({ items, className = "", onNavigate }: { items: NavItem[]; className?: string; onNavigate?: () => void }) {
  const [location] = useLocation();
  return (
    <nav className={className} aria-label="Primary navigation">
      {items.map(item => (
        <Link key={item.href + item.label} href={item.href} onClick={onNavigate} className={navLinkClass(isNavActive(location, item))}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="inline-flex shrink-0 items-center gap-2 text-[#174a31] no-underline">
      <img
        src="/images/agricoop-mark.jpg"
        alt=""
        width={40}
        height={40}
        className="h-10 w-10 rounded-xl object-cover"
        decoding="async"
      />
      {!compact && <span className="font-display text-xl font-bold tracking-tight">AgriCoop</span>}
    </Link>
  );
}

function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const { data: notifications = [], error, isLoading, isFetching, refetch } = trpc.notifications.mine.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: query => (typeof document !== "undefined" && document.visibilityState === "hidden" ? false : 30_000),
    refetchOnWindowFocus: true,
  });
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => utils.notifications.mine.invalidate(),
    onError: () => toast.error("Could not mark the notification as read. Please try again."),
  });
  const unreadCount = notifications.filter(notification => notification.isRead === 0).length;
  if (!user) return null;
  return (
    <div className="relative">
      <button
        type="button"
        className="relative grid h-11 w-11 place-items-center rounded-xl text-[#315640] hover:bg-[#edf3e9]"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-[#a34838] px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-[#dce4d6] bg-white shadow-xl">
          <div className="border-b border-[#e3e9de] p-3 font-bold text-[#264f37]">Notifications</div>
          {error ? (
            <NotificationQueryError message="Notifications could not be loaded." isRetrying={isFetching} onRetry={() => { void refetch(); }} />
          ) : isLoading ? (
            <p className="p-4 text-sm text-[#65766b]">Loading notifications...</p>
          ) : notifications.length ? (
            notifications.slice(0, 8).map(notification => {
              const href =
                notification.link?.startsWith("/") && !notification.link.startsWith("//") ? notification.link : "/dashboard";
              const content = (
                <>
                  <span className="block font-bold text-[#315640]">{notification.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-[#65766b]">{notification.content}</span>
                </>
              );
              return (
                <div
                  key={notification.id}
                  className={`border-b border-[#edf0e9] p-3 text-sm ${notification.isRead ? "bg-white" : "bg-[#f1f6ee]"}`}
                >
                  {notification.link ? (
                    <Link
                      href={href}
                      className="block no-underline"
                      onClick={() => {
                        if (!notification.isRead) markRead.mutate({ id: notification.id });
                        setOpen(false);
                      }}
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => {
                        if (!notification.isRead) markRead.mutate({ id: notification.id });
                      }}
                    >
                      {content}
                    </button>
                  )}
                </div>
              );
            })
          ) : (
            <p className="p-4 text-sm text-[#65766b]">No notifications yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ProfileMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [location]);
  if (!user) return null;

  const closeAnd = (action?: () => void) => {
    setOpen(false);
    onNavigate?.();
    action?.();
  };

  const menuItemClass =
    "flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-bold text-[#315640] no-underline hover:bg-[#edf3e9]";

  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex max-w-[min(100%,14rem)] min-h-11 items-center gap-1.5 rounded-xl border border-[#dce4d6] bg-white px-3 text-sm font-bold text-[#315640] hover:bg-[#edf3e9] sm:max-w-xs"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(value => !value)}
      >
        <UserRound size={16} className="shrink-0" aria-hidden />
        <span className="truncate">{formatUserRoleChip(user.name, user.role)}</span>
        <ChevronDown size={16} className="shrink-0 opacity-70" aria-hidden />
      </button>
      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-[#dce4d6] bg-white py-1 shadow-xl"
          role="menu"
        >
          <Link href="/profile" className={menuItemClass} role="menuitem" onClick={() => closeAnd()}>
            My Profile
          </Link>
          <Link href="/dashboard" className={menuItemClass} role="menuitem" onClick={() => closeAnd()}>
            My Workspace
          </Link>
          <Link href="/messages" className={menuItemClass} role="menuitem" onClick={() => closeAnd()}>
            Messages
          </Link>
          <Link href="/support" className={menuItemClass} role="menuitem" onClick={() => closeAnd()}>
            Support
          </Link>
          <MenuDivider />
          <button
            type="button"
            className={`${menuItemClass} text-[#a34838]`}
            role="menuitem"
            onClick={() => closeAnd(() => { void logout(); })}
          >
            <LogOut size={16} className="mr-2 inline" aria-hidden />
            Log Out
          </button>
        </div>
      )}
    </div>
  );
}

function MenuDivider() {
  return <div className="my-1 border-t border-[#e3e9de]" role="separator" />;
}

function mobileNavIcon(item: MobileNavItem) {
  switch (item.key) {
    case "home":
      return Home;
    case "browse":
      return LayoutGrid;
    case "cart":
      return ShoppingBasket;
    case "orders":
      return Package;
    case "messages":
      return MessageSquare;
    case "tickets":
      return Ticket;
    case "dashboard":
      return LayoutDashboard;
    case "account":
    default:
      return UserRound;
  }
}

function isMobileNavItemActive(location: string, item: MobileNavItem): boolean {
  const [path, hashPart] = item.href.split("#");
  if (hashPart) {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    return location.startsWith(path) && hash === `#${hashPart}`;
  }
  if (path === "/") return location === "/";
  return location === path || location.startsWith(`${path}/`);
}

function MobileBottomNav() {
  const { user } = useAuth();
  const [location] = useLocation();
  const loggedIn = !!user;
  const items = mobileBottomNav(user?.role, loggedIn);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#dce4d6] bg-[#fffdf8] pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Mobile primary"
    >
      <ul className={`mx-auto grid max-w-lg`} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map(item => {
          const active = isMobileNavItemActive(location, item);
          const Icon = mobileNavIcon(item);
          return (
            <li key={item.key + item.href}>
              <Link
                href={item.href}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-bold no-underline ${
                  active ? "text-[#1f5a3c]" : "text-[#6a796e]"
                }`}
              >
                <Icon size={20} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function HeaderRightActions({ drawerOpen, setDrawerOpen }: { drawerOpen: boolean; setDrawerOpen: (open: boolean) => void }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <button
        type="button"
        className="grid h-11 w-11 place-items-center rounded-xl text-[#1f5a3c] hover:bg-[#edf3e9] lg:hidden"
        onClick={() => setDrawerOpen(!drawerOpen)}
        aria-label={drawerOpen ? "Close menu" : "Open menu"}
        aria-expanded={drawerOpen}
      >
        {drawerOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
    );
  }

  if (user) {
    return (
      <>
        <div className="hidden shrink-0 items-center gap-1 sm:gap-2 lg:flex">
          {user.role === "buyer" && (
            <Link
              href="/marketplace#order"
              className="relative grid h-11 w-11 place-items-center rounded-xl text-[#315640] hover:bg-[#edf3e9] no-underline"
              aria-label="Open order basket"
            >
              <ShoppingBasket size={18} />
            </Link>
          )}
          <NotificationBell />
          <ProfileMenu />
        </div>
        <button
          type="button"
          className="grid h-11 w-11 place-items-center rounded-xl text-[#1f5a3c] hover:bg-[#edf3e9] lg:hidden"
          onClick={() => setDrawerOpen(!drawerOpen)}
          aria-label={drawerOpen ? "Close menu" : "Open menu"}
          aria-expanded={drawerOpen}
        >
          {drawerOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </>
    );
  }

  return (
    <>
      <div className="hidden shrink-0 items-center gap-2 whitespace-nowrap lg:flex">
        <Link
          href="/auth"
          className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold text-[#315640] no-underline hover:bg-[#edf3e9]"
        >
          Login
        </Link>
        <Button
          type="button"
          className="min-h-11 rounded-xl bg-[#1f4f36] px-4 text-sm font-bold text-white hover:bg-[#1a4330]"
          onClick={() => goToAuth("PublicHeader")}
        >
          Join AgriCoop
        </Button>
      </div>
      <button
        type="button"
        className="grid h-11 w-11 place-items-center rounded-xl text-[#1f5a3c] hover:bg-[#edf3e9] lg:hidden"
        onClick={() => setDrawerOpen(!drawerOpen)}
        aria-label={drawerOpen ? "Close menu" : "Open menu"}
        aria-expanded={drawerOpen}
      >
        {drawerOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
    </>
  );
}

function MobileNavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout } = useAuth();
  const centerItems = user ? centerNavForRole(user.role) : LOGGED_OUT_CENTER;
  const drawerLinkClass =
    "flex min-h-11 items-center rounded-xl px-3 text-sm font-bold text-[#315640] no-underline hover:bg-[#edf3e9]";

  if (!open) return null;

  return (
    <div className="border-t border-[#e4e7da] bg-[#fffdf8] lg:hidden">
      <div className={`${SHELL} flex flex-col gap-1 py-3`}>
        <NavLinks items={centerItems} className="flex flex-col gap-1" onNavigate={onClose} />
        {user ? (
          <>
            <MenuDivider />
            <Link href="/profile" onClick={onClose} className={drawerLinkClass}>
              My Profile
            </Link>
            <Link href="/dashboard" onClick={onClose} className={drawerLinkClass}>
              My Workspace
            </Link>
            <Link href="/messages" onClick={onClose} className={drawerLinkClass}>
              Messages
            </Link>
            <Link href="/support" onClick={onClose} className={drawerLinkClass}>
              Support
            </Link>
            <button
              type="button"
              className={`${drawerLinkClass} text-left text-[#a34838]`}
              onClick={() => {
                onClose();
                void logout();
              }}
            >
              Log Out
            </button>
          </>
        ) : (
          <>
            <MenuDivider />
            <Link href="/auth" onClick={onClose} className={drawerLinkClass}>
              Login
            </Link>
            <button
              type="button"
              className="mt-1 min-h-11 rounded-xl bg-[#1f4f36] px-3 text-sm font-bold text-white"
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
  );
}

export function PublicHeader() {
  const { user, loading } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const centerItems = !loading && user ? centerNavForRole(user.role) : LOGGED_OUT_CENTER;

  return (
    <header className="sticky top-0 z-40 border-b border-[#e4e7da] bg-[#fffdf8]">
      <div className={`${SHELL} relative flex h-16 flex-nowrap items-center gap-3 lg:h-[4.25rem] lg:gap-4`}>
        <div className="flex shrink-0 items-center gap-2">
          <BrandMark />
          {!loading && user && (
            <span className="hidden rounded-full bg-[#edf3e9] px-2.5 py-1 text-xs font-bold text-[#315640] xl:inline">
              {roleDisplayLabel(user.role)}
            </span>
          )}
        </div>

        <NavLinks
          items={centerItems}
          className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 whitespace-nowrap lg:flex"
        />

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <HeaderRightActions drawerOpen={drawerOpen} setDrawerOpen={setDrawerOpen} />
        </div>
      </div>
      <MobileNavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-[#dbe4d7] bg-[#eef4ea]">
      <div className={`${SHELL} grid gap-6 py-9 md:grid-cols-2`}>
        <div>
          <BrandMark />
          <p className="mt-3 max-w-md text-sm leading-6 text-[#57705e]">
            A cooperative-centered marketplace supporting fairer agricultural trade in Butuan City and beyond.
          </p>
        </div>
        <div className="self-end text-sm text-[#57705e] md:text-right">
          <p className="font-bold text-[#315640]">Trade fairly. Grow together.</p>
          <p className="mt-1">Payments are coordinated face-to-face through AgriCoop support.</p>
        </div>
      </div>
    </footer>
  );
}

export function PageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f8f5ee] pb-[calc(3.75rem+env(safe-area-inset-bottom))] text-[#173a2a] md:pb-0">
      <PublicHeader />
      {children}
      <PublicFooter />
      <MobileBottomNav />
    </div>
  );
}

export function WorkspaceHeader({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  const { user } = useAuth();
  const compactNav = centerNavForRole(user?.role);

  return (
    <header className="border-b border-[#dde4d9] bg-[#fffdf8]">
      <div className={`${SHELL} flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:gap-5`}>
        <div className="flex min-w-0 items-start gap-3">
          <BrandMark compact />
          <div className="min-w-0">
            <p className="font-display text-2xl font-bold text-[#174a31]">{title}</p>
            <p className="mt-1 max-w-xl text-sm text-[#627266]">{description}</p>
          </div>
        </div>

        <NavLinks
          items={compactNav}
          className="flex flex-wrap items-center gap-0.5 lg:justify-center"
        />

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <NotificationBell />
          <ProfileMenu />
          {children}
        </div>
      </div>
    </header>
  );
}