import Link from "next/link";

export default function HomePage() {
  return <main className="page-shell">
    <nav className="nav"><Link href="/" className="brand">AgriCoop</Link><div className="nav-links"><Link href="/marketplace">Marketplace</Link><Link href="/about">How it works</Link><Link href="/support">Support</Link></div><Link href="/auth" className="button">Join AgriCoop</Link></nav>
    <section className="hero"><div><p className="eyebrow">Cooperative-powered agricultural trade</p><h1>Local harvest.<br/><em>Fairer value.</em><br/>Stronger communities.</h1><p className="lede">AgriCoop brings buyers and sellers together in one clear, community-first marketplace.</p><div className="actions"><Link href="/marketplace" className="button">Explore fresh listings →</Link><Link href="/about" className="ghost">See how it works</Link></div></div><div className="hero-card"><strong>Direct & transparent</strong><span>Grow together, sell fairly.</span></div></section>
    <section className="features"><p className="eyebrow">Built around the cooperative</p><h2>A better market begins with better coordination.</h2><div className="feature-grid"><article><b>Connect directly</b><p>Bring fresh products and buyers closer without unnecessary layers.</p></article><article><b>Trade with clarity</b><p>Compare listings, request quotations, and coordinate F2F handover.</p></article><article><b>Stay accountable</b><p>Role-based oversight keeps listings, inventory, and conversations organized.</p></article></div></section>
  </main>;
}
