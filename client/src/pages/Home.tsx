import { PageFrame, marketingShellClass } from "@/components/AgriShell";
import { trpc } from "@/lib/trpc";
import { ArrowRight, BadgeCheck, Handshake, Layers3, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";

const heroSrc = "/images/hero-banner-1200.webp";
const heroSrcSet = "/images/hero-banner-800.webp 800w, /images/hero-banner-1200.webp 1200w";
const heroSizes = "(max-width: 1023px) 100vw, 50vw";

const cooperativeContactMailto = (() => {
  const to = ["joanathancahiyang59@gmail.com", "daguinoderoll33@gmail.com"].join(",");
  const subject = "Cooperative Inquiry – AgriCoop Marketplace";
  const body = [
    "Hello AgriCoop Team,",
    "",
    "I am interested in learning more about joining the AgriCoop Marketplace as a cooperative.",
    "I would appreciate more information about the application process, requirements, and next steps.",
    "",
    "Thank you, and I look forward to hearing from you.",
    "",
    "Best regards,",
    "[Your Name]",
    "[Cooperative Name]",
    "[Contact Number]",
  ].join("\n");
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
})();

export default function Home() {
  // Defer marketplace snapshot until after first paint so it cannot contend with LCP.
  const [snapshotReady, setSnapshotReady] = useState(false);
  useEffect(() => {
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof win.requestIdleCallback === "function") {
      const id = win.requestIdleCallback(() => setSnapshotReady(true), { timeout: 1200 });
      return () => win.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => setSnapshotReady(true), 0);
    return () => window.clearTimeout(t);
  }, []);
  const { data: listings = [] } = trpc.marketplace.list.useQuery(undefined, {
    enabled: snapshotReady,
    staleTime: 60_000,
  });
  const activeListingCount = listings.length;
  const featured = listings[0];

  return (
    <PageFrame>
      <main>
        <section className="agri-full-bleed relative overflow-hidden bg-[#e5efe0]" data-testid="home-hero" data-full-bleed>
          <div className="grain absolute inset-0 opacity-30" aria-hidden />
          <div
            className={`${marketingShellClass} relative grid items-start gap-8 py-12 lg:min-h-[560px] lg:grid-cols-2 lg:gap-10 lg:py-16`}
          >
            <div className="relative z-10 flex flex-col justify-center" data-testid="hero-text">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#c7dabc] bg-[#f5f9f1] px-3 py-1.5 text-xs font-extrabold tracking-[.08em] text-[#2e6a41]">
                <span className="h-2 w-2 rounded-full bg-[#71a85a]" aria-hidden /> Cooperative-powered agricultural trade
              </div>
              {/* No animation on H1 — keep LCP text immediately visible */}
              <h1 className="mt-5 max-w-xl font-display text-5xl font-bold leading-[.98] tracking-tight text-[#163b2a] sm:text-6xl">
                Local harvest. <em className="text-[#6a8940]">Fairer value.</em> Stronger communities.
              </h1>
              <p className="mt-6 max-w-lg text-lg leading-8 text-[#4e6a59]">
                AgriCoop brings buyers, farmers, and cooperative officers together in one clear, community-first marketplace.
              </p>
              <div className="mt-8 flex flex-wrap gap-3" data-testid="hero-ctas">
                <Link href="/marketplace" className="agri-button min-h-11 no-underline">
                  Explore fresh listings <ArrowRight size={18} aria-hidden />
                </Link>
                <Link href="/about" className="agri-ghost min-h-11 no-underline">
                  See how AgriCoop works
                </Link>
              </div>
              <p className="mt-6 text-sm font-medium text-[#607865]">
                Built for selected agricultural cooperatives in Butuan City, Agusan del Norte.
              </p>
            </div>

            <div className="relative min-w-0" data-testid="hero-media">
              <div className="aspect-[4/3] w-full overflow-hidden rounded-[1.5rem] bg-[#b5ca88] shadow-[0_18px_40px_rgba(22,59,42,0.12)] lg:aspect-[5/4]">
                <img
                  src={heroSrc}
                  srcSet={heroSrcSet}
                  sizes={heroSizes}
                  alt="Filipino farmers gathering fresh produce in a green field"
                  width={1200}
                  height={675}
                  fetchPriority="high"
                  decoding="async"
                  className="h-full w-full object-cover object-center"
                  data-testid="hero-image"
                />
              </div>

              <aside
                className="hero-glass-badge relative z-10 mt-4 min-h-[9.5rem] lg:absolute lg:bottom-[var(--agri-hero-badge-inset-lg)] lg:right-[var(--agri-hero-badge-inset-lg)] lg:mt-0 lg:max-w-[min(20rem,42%)]"
                data-testid="hero-glass-badge"
                aria-label="Marketplace snapshot"
              >
                <p className="text-[0.7rem] font-extrabold uppercase tracking-[.12em] text-[#355445]">Live marketplace</p>
                <p className="mt-1 font-display text-xl font-bold leading-tight text-[#163b2a]" aria-live="polite">
                  {!snapshotReady
                    ? "Checking fresh listings…"
                    : activeListingCount === 0
                      ? "Fresh listings open soon"
                      : `${activeListingCount} active listing${activeListingCount === 1 ? "" : "s"}`}
                </p>
                <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm leading-5 text-[var(--agri-glass-muted)]">
                  {featured
                    ? `Featured: ${featured.product.name}${featured.cooperativeName ? ` · ${featured.cooperativeName}` : ""}`
                    : "Compare harvest prices with cooperative oversight."}
                </p>
                <Link
                  href="/marketplace"
                  className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-bold text-[#1f5a3c] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#eab75d]"
                >
                  Browse marketplace <ArrowRight size={14} aria-hidden />
                </Link>
              </aside>
            </div>
          </div>
        </section>

        <section className={`${marketingShellClass} py-14`}>
          <div className="grid gap-8 lg:grid-cols-[.78fr_1.22fr]">
            <div>
              <p className="text-sm font-extrabold uppercase tracking-[.14em] text-[#3f5f28]">Built around the cooperative</p>
              <h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-[#1d4932]">
                A better market begins with better coordination.
              </h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { icon: Handshake, title: "Connect directly", body: "Bring fresh products and buyers closer without unnecessary layers." },
                { icon: Layers3, title: "Trade with clarity", body: "Compare prices, request quotations, and manage regular or bulk orders." },
                { icon: ShieldCheck, title: "Stay accountable", body: "Officer oversight keeps listings, inventory, and transactions organized." },
              ].map(({ icon: Icon, title, body }) => (
                <article key={title} className="agri-card p-5">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e4f0df] text-[#2c6a41]">
                    <Icon size={21} aria-hidden />
                  </span>
                  <h3 className="mt-5 font-display text-xl font-bold text-[#214b35]">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#627266]">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="agri-full-bleed border-y border-[#dce6d6] bg-[#eff5eb]" data-full-bleed>
          <div className={`${marketingShellClass} grid gap-8 py-12 lg:grid-cols-2`}>
            <div>
              <p className="text-sm font-extrabold uppercase tracking-[.14em] text-[#3f5f28]">Designed for every participant</p>
              <h2 className="mt-3 font-display text-4xl font-bold text-[#1d4932]">One shared market, each role with the right tools.</h2>
              <p className="mt-4 max-w-xl leading-7 text-[#58705e]">
                AgriCoop makes it easier to participate in digital trade while keeping cooperative support and face-to-face relationships at the center.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["Buyers", "Discover crops, compare prices, arrange orders, and request quotations."],
                ["Farmers", "List harvests, maintain stock, respond to quotations, and fulfill orders."],
                ["OfficerAdmins", "Validate members, monitor activity, and generate a clear operational view."],
                ["SuperAdmins", "Manage roles, cooperative assignments, and platform-wide coordination."],
              ].map(([role, body]) => (
                <div key={role} className="rounded-2xl border border-[#d9e5d3] bg-[#fffdf8] p-5">
                  <BadgeCheck className="text-[#3f5f28]" size={20} aria-hidden />
                  <h3 className="mt-3 font-bold text-[#28543b]">{role}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#627266]">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={`${marketingShellClass} py-14`} data-testid="coop-recruitment">
          <div className="agri-card grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.2fr_.8fr] lg:items-center">
            <div>
              <p className="text-sm font-extrabold uppercase tracking-[.14em] text-[#3f5f28]">For agricultural cooperatives</p>
              <h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-[#1d4932]">
                Bring your cooperative&apos;s harvest to more buyers.
              </h2>
              <p className="mt-4 max-w-2xl leading-7 text-[#58705e]">
                Joining AgriCoop gives your cooperative a verified marketplace presence: list members&apos; produce, reach more
                institutional and retail buyers, manage orders and payments in one place, and keep officer oversight on every
                transaction — all while staying rooted in your community.
              </p>
              <ul className="mt-6 grid gap-2 text-sm text-[#4e6a59] sm:grid-cols-2">
                <li className="flex items-center gap-2"><BadgeCheck size={16} className="text-[#3f5f28]" aria-hidden /> Verified member listings</li>
                <li className="flex items-center gap-2"><BadgeCheck size={16} className="text-[#3f5f28]" aria-hidden /> Wider buyer reach</li>
                <li className="flex items-center gap-2"><BadgeCheck size={16} className="text-[#3f5f28]" aria-hidden /> Order &amp; payment tools</li>
                <li className="flex items-center gap-2"><BadgeCheck size={16} className="text-[#3f5f28]" aria-hidden /> Cooperative oversight</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-[#d9e5d3] bg-[#f5f9f1] p-6">
              <h3 className="font-display text-xl font-bold text-[#214b35]">Interested in joining?</h3>
              <p className="mt-2 text-sm leading-6 text-[#627266]">
                Contact our team to discuss onboarding your cooperative.
              </p>
              <div className="mt-5 flex flex-col gap-3">
                <a
                  href={cooperativeContactMailto}
                  className="agri-button min-h-11 justify-center no-underline"
                >
                  Contact Us
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </PageFrame>
  );
}
