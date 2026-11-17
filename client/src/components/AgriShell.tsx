import { useAuth } from "@/_core/hooks/useAuth";
import { goToAuth } from "@/const";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { NotificationQueryError } from "@/components/NotificationQueryError";
import {
  Bell,
  Home,
  LayoutGrid,
  Leaf,
  LogOut,
  Menu,
  Package,
  Search,
  ShoppingBasket,
  Sprout,
  UserRound,
  X,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { toast } from "sonner";

const SHELL = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 xl:px-10";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="inline-flex shrink-0 items-center gap-2 text-[#174a31] no-underline">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#dcebd8] text-[#1f5a3c]"><Sprout size={20} strokeWidth={2.4} /></span>
      {!compact && <span className="font-display text-xl font-bold tracking-tight">AgriCoop</span>}
    </Link>
  );
}

function MarketplaceSearch({ className = "" }: { className?: string }) {
  const [location, setLocation] = useLocation();
  const searchString = useSearch();
  const params = useMemo(() => new URLSearchParams(searchString.startsWith("?") ? searchString.slice(1) : searchString), [searchString]);
  const [query, setQuery] = useState(params.get("q") ?? "");
  useEffect(() => {
    setQuery(params.get("q") ?? "");
  }, [params]);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next = query.trim();
    if (location.startsWith("/marketplace")) {
      const nextParams = new URLSearchParams(params);
      if (next) nextParams.set("q", next);
      else nextParams.delete("q");
      const qs = nextParams.toString();
      setLocation(qs ? `/marketplace?${qs}` : "/marketplace");
      return;
    }
    setLocation(next ? `/marketplace?q=${encodeURIComponent(next)}` : "/marketplace");
  };
  return (
    <form onSubmit={onSubmit} className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-[#d5e0d2] bg-[#f3f7f0] px-3 ${className}`} role="search">
      <Search size={18} className="shrink-0 text-[#647365]" aria-hidden />
      <label className="sr-only" htmlFor="agri-market-search">Search marketplace</label>
      <input
        id="agri-market-search"
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="Search produce, category, or seller"
        className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-[#8a978c]"
      />
      <button type="submit" className="hidden shrink-0 rounded-lg bg-[#1f4f36] px-3 py-1.5 text-xs font-bold text-white sm:inline">Search</button>
    </form>
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
  return <div className="relative">
    <button type="button" className="relative grid h-11 w-11 place-items-center rounded-xl text-[#315640] hover:bg-[#edf3e9]" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <Bell size={18}/>
      {unreadCount > 0 && <span className="absolute right-1 top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-[#a34838] px-1 text-[10px] font-bold text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}
    </button>
    {open && <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-[#dce4d6] bg-white shadow-xl">
      <div className="border-b border-[#e3e9de] p-3 font-bold text-[#264f37]">Notifications</div>
      {error
        ? <NotificationQueryError message="Notifications could not be loaded." isRetrying={isFetching} onRetry={() => { void refetch(); }}/>
        : isLoading
          ? <p className="p-4 text-sm text-[#65766b]">Loading notifications...</p>
          : notifications.length ? notifications.slice(0, 8).map(notification => {
        const href = notification.link?.startsWith("/") && !notification.link.startsWith("//")
          ? notification.link
          : "/dashboard";
        const content = <><span className="block font-bold text-[#315640]">{notification.title}</span><span className="mt-1 block text-xs leading-5 text-[#65766b]">{notification.content}</span></>;
        return <div key={notification.id} className={`border-b border-[#edf0e9] p-3 text-sm ${notification.isRead ? "bg-white" : "bg-[#f1f6ee]"}`}>
          {notification.link
            ? <Link href={href} className="block no-underline" onClick={() => { if (!notification.isRead) markRead.mutate({ id: notification.id }); setOpen(false); }}>{content}</Link>
            : <button type="button" className="w-full text-left" onClick={() => { if (!notification.isRead) markRead.mutate({ id: notification.id }); }}>{content}</button>}
        </div>;
      }) : <p className="p-4 text-sm text-[#65766b]">No notifications yet.</p>}
    </div>}
  </div>;
}

export function PublicHeader() {
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const categoryLinks = [
    { label: "All listings", href: "/marketplace" },
    { label: "How it works", href: "/about" },
    { label: "Support", href: "/support" },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-[#e4e7da] bg-[#fffdf8]/96 backdrop-blur">
      <div className={`${SHELL} flex h-16 items-center gap-3 lg:h-[4.25rem] lg:gap-5`}>
        <BrandMark />
        <div className="hidden min-w-0 flex-1 md:block"><MarketplaceSearch /></div>
        <nav className="hidden shrink-0 items-center gap-5 xl:flex" aria-label="Category navigation">
          {categoryLinks.map(item => (
            <Link key={item.href} href={item.href} className={`whitespace-nowrap text-sm font-bold no-underline ${location === item.href || (item.href === "/marketplace" && location.startsWith("/marketplace")) ? "text-[#1f5a3c]" : "text-[#647365] hover:text-[#1f5a3c]"}`}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <Link href="/marketplace#order" className="relative grid h-11 w-11 place-items-center rounded-xl text-[#315640] hover:bg-[#edf3e9] no-underline" aria-label="Open order basket">
            <ShoppingBasket size={18} />
          </Link>
          {!loading && (user
            ? <>
              <NotificationBell />
              <Link href="/dashboard" className="hidden h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-[#315640] no-underline hover:bg-[#edf3e9] lg:inline-flex"><UserRound size={16} /> Account</Link>
              <button type="button" onClick={logout} className="hidden h-11 w-11 place-items-center rounded-xl text-[#315640] hover:bg-[#edf3e9] lg:grid" aria-label="Sign out"><LogOut size={16} /></button>
            </>
            : <button type="button" className="hidden h-11 items-center rounded-xl bg-[#1f4f36] px-4 text-sm font-bold text-white lg:inline-flex" onClick={() => goToAuth("PublicHeader")}>Join</button>)}
          <button type="button" className="grid h-11 w-11 place-items-center rounded-xl text-[#1f5a3c] hover:bg-[#edf3e9] xl:hidden" onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      <div className={`${SHELL} pb-3 md:hidden`}><MarketplaceSearch /></div>
      {open && (
        <div className="border-t border-[#e4e7da] bg-[#fffdf8] xl:hidden">
          <div className={`${SHELL} flex flex-col gap-1 py-3`}>
            {categoryLinks.map(item => <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="rounded-xl px-3 py-3 text-sm font-bold text-[#315640] no-underline hover:bg-[#edf3e9]">{item.label}</Link>)}
            <Link href="/support-tickets" onClick={() => setOpen(false)} className="rounded-xl px-3 py-3 text-sm font-bold text-[#315640] no-underline hover:bg-[#edf3e9]">Support tickets</Link>
            {user
              ? <>
                <Link href="/dashboard" onClick={() => setOpen(false)} className="rounded-xl px-3 py-3 text-sm font-bold text-[#315640] no-underline hover:bg-[#edf3e9]">My workspace</Link>
                <Link href="/activity" onClick={() => setOpen(false)} className="rounded-xl px-3 py-3 text-sm font-bold text-[#315640] no-underline hover:bg-[#edf3e9]">My orders</Link>
                <button type="button" className="rounded-xl px-3 py-3 text-left text-sm font-bold text-[#a34838]" onClick={() => { setOpen(false); logout(); }}>Sign out</button>
              </>
              : <button type="button" className="mt-1 rounded-xl bg-[#1f4f36] px-3 py-3 text-sm font-bold text-white" onClick={() => goToAuth("PublicHeader")}>Join AgriCoop</button>}
          </div>
        </div>
      )}
    </header>
  );
}

function MobileBottomNav() {
  const { user } = useAuth();
  const [location] = useLocation();
  const items = [
    { label: "Home", href: "/", icon: Home },
    { label: "Browse", href: "/marketplace", icon: LayoutGrid },
    { label: "Cart", href: "/marketplace#order", icon: ShoppingBasket },
    { label: "Orders", href: user ? "/activity" : "/auth", icon: Package },
    { label: "Account", href: user ? "/dashboard" : "/auth", icon: UserRound },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#dce4d6] bg-[#fffdf8]/97 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Mobile primary">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {items.map(item => {
          const path = item.href.split("#")[0];
          const active = path === "/" ? location === "/" : location.startsWith(path);
          const Icon = item.icon;
          return (
            <li key={item.label}>
              <Link href={item.href} className={`flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-bold no-underline ${active ? "text-[#1f5a3c]" : "text-[#6a796e]"}`}>
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

export function PublicFooter() {
  return (
    <footer className="border-t border-[#dbe4d7] bg-[#eef4ea]">
      <div className={`${SHELL} grid gap-6 py-9 md:grid-cols-2`}>
        <div>
          <BrandMark />
          <p className="mt-3 max-w-md text-sm leading-6 text-[#57705e]">A cooperative-centered marketplace supporting fairer agricultural trade in Butuan City and beyond.</p>
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
    <div className="min-h-screen bg-[#f8f5ee] pb-16 text-[#173a2a] md:pb-0">
      <PublicHeader />
      {children}
      <PublicFooter />
      <MobileBottomNav />
    </div>
  );
}

export function WorkspaceHeader({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <header className="border-b border-[#dde4d9] bg-[#fffdf8]">
      <div className={`${SHELL} flex flex-col gap-4 py-5 lg:flex-row lg:items-center lg:justify-between`}>
        <div className="flex items-start gap-3">
          <BrandMark compact />
          <div>
            <p className="font-display text-2xl font-bold text-[#174a31]">{title}</p>
            <p className="mt-1 max-w-xl text-sm text-[#627266]">{description}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/marketplace" className="inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-[#315640] no-underline hover:bg-[#edf3e9]"><Leaf size={16} /> Browse</Link>
          <Link href="/support" className="inline-flex h-11 items-center rounded-xl px-3 text-sm font-bold text-[#315640] no-underline hover:bg-[#edf3e9]">Support</Link>
          {(user?.role === "buyer" || user?.role === "seller") && <Link href="/activity" className="inline-flex h-11 items-center rounded-xl px-3 text-sm font-bold text-[#315640] no-underline hover:bg-[#edf3e9]">Orders</Link>}
          {(user?.role === "admin" || user?.role === "superadmin") && <Link href="/reports" className="inline-flex h-11 items-center rounded-xl px-3 text-sm font-bold text-[#315640] no-underline hover:bg-[#edf3e9]">Reports</Link>}
          {(user?.role === "admin" || user?.role === "superadmin") && <Link href="/admin/audit-logs" className="inline-flex h-11 items-center rounded-xl px-3 text-sm font-bold text-[#315640] no-underline hover:bg-[#edf3e9]">Audit</Link>}
          <NotificationBell />
          <span className="hidden rounded-full bg-[#edf3e9] px-3 py-2 text-sm font-bold text-[#315640] sm:inline">{user?.name || "Member"}</span>
          <Button onClick={logout} variant="ghost" size="icon" className="h-11 w-11" aria-label="Sign out"><LogOut size={18} /></Button>
          {children}
        </div>
      </div>
    </header>
  );
}

export const shellContainerClass = SHELL;
