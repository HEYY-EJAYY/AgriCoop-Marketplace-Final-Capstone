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
import { MobileMenuOverlay, MobileMenuToggle } from "@/components/MobileMenuOverlay";
import {
  Bell,
  ChevronDown,
  Home,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Package,
  ShoppingBasket,
  Ticket,
  UserRound,
} from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

/** App / marketplace shell — full width + small gutters (.agri-shell) */
const SHELL = "agri-shell";
/** Marketing shell — boxed ~1280px + equal fluid side padding (.agri-marketing-shell) */
const MARKETING_SHELL = "agri-marketing-shell";

export const shellContainerClass = SHELL;
export const marketingShellClass = MARKETING_SHELL;
export const fullBleedClass = "agri-full-bleed";

const navLinkClass = (active: boolean) =>
  `inline-flex min-h-11 items-center whitespace-nowrap rounded-xl px-3 text-sm font-bold no-underline ${
    active ? "text-[#1f5a3c]" : "text-[#647365] hover:text-[#1f5a3c] hover:bg-[#edf3e9]"
  }`;

function NavLinks({ items, className = "", onNavigate }: { items: NavItem[]; className?: string; onNavigate?: () => void }) {
  const [location] = useLocation();
  return (
    <nav className={className} aria-label="Primary navigation" data-testid="primary-nav">
      {items.map(item => {
        const active = isNavActive(location, item);
        return (
          <Link
            key={item.href + item.label}
            href={item.href}
            onClick={onNavigate}
            className={navLinkClass(active)}
            aria-current={active ? "page" : undefined}
            data-testid={`nav-link-${item.label}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function LoggedOutAuthActions({ source }: { source: string }) {
  return (
    <div className="hidden shrink-0 items-center gap-2 whitespace-nowrap lg:flex" data-testid="nav-auth-actions">
      <Link
        href="/auth"
        className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold text-[#315640] no-underline hover:bg-[#edf3e9]"
        data-testid="nav-login"
      >
        Login
      </Link>
      <Button
        type="button"
        className="min-h-11 rounded-xl bg-[#1f4f36] px-4 text-sm font-bold text-white hover:bg-[#1a4330]"
        data-testid="nav-join"
        onClick={() => goToAuth(source, { register: true })}
      >
        Join AgriCoop
      </Button>
    </div>
  );
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" aria-label="AgriCoop" className="inline-flex shrink-0 items-center gap-2 text-[#174a31] no-underline">
      <img
        src="/images/agricoop-mark.jpg"
        alt=""
        width={40}
        height={40}
        className="h-10 w-10 rounded-xl object-cover"
        decoding="async"
        aria-hidden
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
  const [photoBroken, setPhotoBroken] = useState(false);
  const [location] = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [location]);
  useEffect(() => {
    setPhotoBroken(false);
  }, [user?.profileImageUrl]);
  if (!user) return null;
  const showPhoto = Boolean(user.profileImageUrl) && !photoBroken;
  const initials = (user.name?.trim().charAt(0) || "?").toUpperCase();

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
        data-testid="nav-profile-menu"
        onClick={() => setOpen(value => !value)}
      >
        {showPhoto ? (
          <img
            src={user.profileImageUrl!}
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 shrink-0 rounded-lg object-cover"
            data-testid="nav-profile-photo"
            onError={() => setPhotoBroken(true)}
          />
        ) : (
          <span
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#e8f0e4] text-xs font-bold text-[#1f5a3c]"
            aria-hidden
            data-testid="nav-profile-fallback"
          >
            {initials}
          </span>
        )}
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

function HeaderRightActions({
  menuOpen,
  onToggleMenu,
  toggleRef,
}: {
  menuOpen: boolean;
  onToggleMenu: () => void;
  toggleRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const { user, loading } = useAuth();

  // While auth resolves, keep logged-out Login/Join visible (same size) so the nav never empties.
  if (loading || !user) {
    return (
      <>
        <LoggedOutAuthActions source="PublicHeader" />
        <MobileMenuToggle open={menuOpen} onToggle={onToggleMenu} toggleRef={toggleRef} />
      </>
    );
  }

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
      <MobileMenuToggle open={menuOpen} onToggle={onToggleMenu} toggleRef={toggleRef} />
    </>
  );
}

export function PublicHeader() {
  const { user, loading, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  // Prefer logged-out center links until auth resolves — avoids empty/role flash on public routes.
  const centerItems = !loading && user ? centerNavForRole(user.role) : LOGGED_OUT_CENTER;
  const overlayUser = !loading && user ? { name: user.name, role: user.role } : null;

  return (
    <header className="sticky top-0 z-50 border-b border-[#e4e7da] bg-[#fffdf8]" data-testid="site-header">
      <div className={`${MARKETING_SHELL} relative flex h-16 flex-nowrap items-center gap-3 lg:h-[4.25rem] lg:gap-4`}>
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
          <HeaderRightActions
            menuOpen={menuOpen}
            onToggleMenu={() => setMenuOpen(value => !value)}
            toggleRef={toggleRef}
          />
        </div>
      </div>
      <MobileMenuOverlay
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        navItems={centerItems}
        user={overlayUser}
        onLogout={() => void logout()}
        toggleRef={toggleRef}
      />
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-[#dbe4d7] bg-[#eef4ea]" data-testid="site-footer">
      <div className={`${MARKETING_SHELL} grid gap-6 py-9 md:grid-cols-2`}>
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
  const { user, loading, logout } = useAuth();
  const compactNav = !loading && user ? centerNavForRole(user.role) : LOGGED_OUT_CENTER;
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const overlayUser = !loading && user ? { name: user.name, role: user.role } : null;

  return (
    <header className="sticky top-0 z-50 border-b border-[#dde4d9] bg-[#fffdf8]" data-testid="site-header">
      <div className={`${SHELL} flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:gap-5`}>
        <div className="flex min-w-0 items-start gap-3">
          <BrandMark compact />
          <div className="min-w-0">
            <p className="font-display text-2xl font-bold text-[#174a31]">{title}</p>
            <p className="mt-1 max-w-xl text-sm text-[#627266]">{description}</p>
          </div>
          <div className="ml-auto lg:hidden">
            <MobileMenuToggle open={menuOpen} onToggle={() => setMenuOpen(value => !value)} toggleRef={toggleRef} />
          </div>
        </div>

        <NavLinks
          items={compactNav}
          className="hidden flex-wrap items-center gap-0.5 lg:flex lg:justify-center"
        />

        <div className="hidden shrink-0 flex-wrap items-center gap-2 lg:flex">
          {loading || !user ? (
            <LoggedOutAuthActions source="WorkspaceHeader" />
          ) : (
            <>
              <NotificationBell />
              <ProfileMenu />
              {children}
            </>
          )}
        </div>
      </div>
      <MobileMenuOverlay
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        navItems={compactNav}
        user={overlayUser}
        onLogout={() => void logout()}
        toggleRef={toggleRef}
      />
    </header>
  );
}