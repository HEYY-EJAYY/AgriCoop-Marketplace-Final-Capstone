import { PageFrame, shellContainerClass } from "@/components/AgriShell";
import { ArrowRight, BadgeCheck, Handshake, Layers3, ShieldCheck } from "lucide-react";
import { Link } from "wouter";

const heroSrc = "/images/hero-banner-1200.webp";
const heroSrcSet = "/images/hero-banner-800.webp 800w, /images/hero-banner-1200.webp 1200w";
const heroSizes = "(max-width: 1024px) 100vw, 58vw";

export default function Home() {
  return (
    <PageFrame>
      <main>
        <section className="relative overflow-hidden bg-[#e5efe0]">
          <div className="grain absolute inset-0 opacity-30" aria-hidden />
          <div className={`relative grid min-h-[560px] items-stretch lg:grid-cols-[1fr_1.05fr] ${shellContainerClass}`}>
            <div className="z-10 flex flex-col justify-center py-14 lg:py-20">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#c7dabc] bg-[#f5f9f1] px-3 py-1.5 text-xs font-extrabold tracking-[.08em] text-[#2e6a41]">
                <span className="h-2 w-2 rounded-full bg-[#71a85a]" /> Cooperative-powered agricultural trade
              </div>
              {/* No animation on H1 — keep LCP text immediately visible */}
              <h1 className="mt-5 max-w-xl font-display text-5xl font-bold leading-[.98] tracking-tight text-[#163b2a] sm:text-6xl">
                Local harvest. <em className="text-[#6a8940]">Fairer value.</em> Stronger communities.
              </h1>
              <p className="mt-6 max-w-lg text-lg leading-8 text-[#4e6a59]">
                AgriCoop brings buyers, farmers, and cooperative officers together in one clear, community-first marketplace.
              </p>
              <div className="mt-8 flex flex-wrap gap-3 lg:hidden">
                <Link href="/marketplace" className="agri-button min-h-11 no-underline">Explore fresh listings <ArrowRight size={18} /></Link>
                <Link href="/about" className="agri-ghost min-h-11 no-underline">See how AgriCoop works</Link>
              </div>
              <p className="mt-6 text-sm font-medium text-[#607865]">Built for selected agricultural cooperatives in Butuan City, Agusan del Norte.</p>
            </div>
            <div className="relative min-h-[320px] pb-8 lg:min-h-0 lg:pb-0">
              <div className="absolute inset-y-0 right-[-8vw] hidden w-[70vw] max-w-[820px] overflow-hidden rounded-bl-[10rem] bg-[#b5ca88] lg:block">
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
                />
                <div className="absolute inset-0 bg-gradient-to-r from-[#e5efe0]/75 via-transparent to-transparent" />
              </div>
              <div className="relative mx-auto mt-2 aspect-[16/10] w-full max-w-xl overflow-hidden rounded-3xl bg-[#b5ca88] lg:hidden">
                <img
                  src={heroSrc}
                  srcSet={heroSrcSet}
                  sizes="100vw"
                  alt="Filipino farmers gathering fresh produce in a green field"
                  width={1200}
                  height={675}
                  fetchPriority="high"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </div>
              {/* Glass value card — right on desktop, stacked under hero copy/image on mobile */}
              <div className="relative z-20 mt-4 rounded-2xl border border-white/55 bg-[#fffdf8]/78 p-5 shadow-xl backdrop-blur-md lg:absolute lg:bottom-12 lg:right-4 lg:mt-0 lg:w-[min(100%,22rem)]">
                <p className="text-xs font-extrabold uppercase tracking-[.12em] text-[#6a8940]">Direct & transparent</p>
                <p className="mt-2 font-display text-2xl font-bold text-[#1f4f36]">Grow together, sell fairly.</p>
                <p className="mt-2 text-sm leading-6 text-[#4f6758]">Compare harvest prices, request quotations, and arrange cash pickup or delivery with cooperative oversight.</p>
                <Link href="/marketplace" className="agri-button mt-4 inline-flex min-h-11 w-full justify-center no-underline sm:w-auto">
                  Explore marketplace <ArrowRight size={16} />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className={`${shellContainerClass} py-20`}>
          <div className="grid gap-12 lg:grid-cols-[.78fr_1.22fr]">
            <div>
              <p className="text-sm font-extrabold uppercase tracking-[.14em] text-[#628940]">Built around the cooperative</p>
              <h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-[#1d4932]">A better market begins with better coordination.</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { icon: Handshake, title: "Connect directly", body: "Bring fresh products and buyers closer without unnecessary layers." },
                { icon: Layers3, title: "Trade with clarity", body: "Compare prices, request quotations, and manage regular or bulk orders." },
                { icon: ShieldCheck, title: "Stay accountable", body: "Officer oversight keeps listings, inventory, and transactions organized." },
              ].map(({ icon: Icon, title, body }) => (
                <article key={title} className="agri-card p-5">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e4f0df] text-[#2c6a41]"><Icon size={21} /></span>
                  <h3 className="mt-5 font-display text-xl font-bold text-[#214b35]">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#627266]">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-[#dce6d6] bg-[#eff5eb]">
          <div className={`${shellContainerClass} grid gap-12 py-16 lg:grid-cols-2`}>
            <div>
              <p className="text-sm font-extrabold uppercase tracking-[.14em] text-[#628940]">Designed for every participant</p>
              <h2 className="mt-3 font-display text-4xl font-bold text-[#1d4932]">One shared market, each role with the right tools.</h2>
              <p className="mt-4 max-w-xl leading-7 text-[#58705e]">AgriCoop makes it easier to participate in digital trade while keeping cooperative support and face-to-face relationships at the center.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["Buyers", "Discover crops, compare prices, arrange orders, and request quotations."],
                ["Farmers", "List harvests, maintain stock, respond to quotations, and fulfill orders."],
                ["Officer Admins", "Validate members, monitor activity, and generate a clear operational view."],
                ["SuperAdmins", "Manage roles, cooperative assignments, and platform-wide coordination."],
              ].map(([role, body]) => (
                <div key={role} className="rounded-2xl border border-[#d9e5d3] bg-[#fffdf8] p-5">
                  <BadgeCheck className="text-[#628940]" size={20} />
                  <h3 className="mt-3 font-bold text-[#28543b]">{role}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#627266]">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </PageFrame>
  );
}
