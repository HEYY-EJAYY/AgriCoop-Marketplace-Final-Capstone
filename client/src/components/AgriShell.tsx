import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { Button } from "@/components/ui/button";
import { Leaf, LogOut, Menu, Sprout, UserRound } from "lucide-react";
import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center gap-2 text-[#174a31] no-underline">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#dcebd8] text-[#1f5a3c]"><Sprout size={20} strokeWidth={2.4} /></span>
      {!compact && <span className="font-display text-xl font-bold tracking-tight">AgriCoop</span>}
    </Link>
  );
}

export function PublicHeader() {
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const nav = [
    { label: "Marketplace", href: "/marketplace" },
    { label: "How it works", href: "/about" },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-[#e4e7da] bg-[#fffdf8]/94 backdrop-blur">
      <div className="mx-auto flex min-h-18 max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <BrandMark />
        <nav className="hidden items-center gap-7 md:flex" aria-label="Main navigation">
          {nav.map(item => <Link key={item.href} href={item.href} className={`nav-link text-sm font-bold no-underline transition-colors ${location === item.href ? "text-[#1f5a3c]" : "text-[#647365] hover:text-[#1f5a3c]"}`}>{item.label}</Link>)}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          {!loading && (user ? <><Link href="/dashboard" className="agri-ghost text-sm no-underline"><UserRound size={16} /> My workspace</Link><button onClick={logout} className="agri-ghost text-sm" aria-label="Sign out"><LogOut size={16} /></button></> : <button className="agri-button text-sm" onClick={() => startLogin()}>Join AgriCoop</button>)}
        </div>
        <button className="grid h-10 w-10 place-items-center rounded-xl text-[#1f5a3c] hover:bg-[#edf3e9] md:hidden" onClick={() => setOpen(!open)} aria-label="Toggle menu"><Menu /></button>
      </div>
      {open && <div className="border-t border-[#e4e7da] bg-[#fffdf8] px-5 py-4 md:hidden"><div className="mx-auto flex max-w-7xl flex-col gap-3">{nav.map(item => <Link onClick={() => setOpen(false)} key={item.href} href={item.href} className="py-2 font-bold text-[#315640] no-underline">{item.label}</Link>)}{user ? <Link href="/dashboard" className="agri-button mt-1 text-sm no-underline">My workspace</Link> : <button className="agri-button mt-1 text-sm" onClick={() => startLogin()}>Join AgriCoop</button>}</div></div>}
    </header>
  );
}

export function PublicFooter() {
  return <footer className="border-t border-[#dbe4d7] bg-[#eef4ea]"><div className="mx-auto grid max-w-7xl gap-6 px-4 py-9 sm:px-6 md:grid-cols-2 lg:px-8"><div><BrandMark /><p className="mt-3 max-w-md text-sm leading-6 text-[#57705e]">A cooperative-centered marketplace supporting fairer agricultural trade in Butuan City and beyond.</p></div><div className="self-end text-sm text-[#57705e] md:text-right"><p className="font-bold text-[#315640]">Trade fairly. Grow together.</p><p className="mt-1">Payments are coordinated face-to-face between buyers and sellers.</p></div></div></footer>;
}

export function PageFrame({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[#f8f5ee] text-[#173a2a]"><PublicHeader />{children}<PublicFooter /></div>;
}

export function WorkspaceHeader({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  const { user, logout } = useAuth();
  return <header className="border-b border-[#dde4d9] bg-[#fffdf8]"><div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8"><div className="flex items-start gap-3"><BrandMark compact /><div><p className="font-display text-2xl font-bold text-[#174a31]">{title}</p><p className="mt-1 max-w-xl text-sm text-[#627266]">{description}</p></div></div><div className="flex items-center gap-2"><Link href="/marketplace" className="agri-ghost text-sm no-underline"><Leaf size={16} /> Browse market</Link><span className="hidden rounded-full bg-[#edf3e9] px-3 py-2 text-sm font-bold text-[#315640] sm:inline">{user?.name || "Member"}</span><Button onClick={logout} variant="ghost" size="icon" aria-label="Sign out"><LogOut size={18} /></Button></div></div></header>;
}
