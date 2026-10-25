import { PageFrame } from "@/components/AgriShell";
import { ArrowRight, BadgeCheck, Handshake, Layers3, ShieldCheck } from "lucide-react";
import { Link } from "wouter";

const heroUrl = "/images/hero-banner.webp";

export default function Home() {
  return <PageFrame><main>
    <section className="mx-4 my-6 overflow-hidden rounded-[2rem] bg-[#e5efe0] shadow-sm sm:mx-6 lg:mx-auto lg:my-8 lg:max-w-7xl">
      <div className="relative">
        <div className="grain absolute inset-0 opacity-30" />
        <div className="relative grid items-center gap-8 px-5 py-8 sm:px-8 sm:py-10 lg:min-h-[570px] lg:grid-cols-[.88fr_1.12fr] lg:gap-6 lg:px-10 lg:py-12">
          <div className="flex flex-col justify-center py-4 lg:py-8">
            <div className="rise-in inline-flex w-fit items-center gap-2 rounded-full border border-[#c7dabc] bg-[#f5f9f1] px-3 py-1.5 text-xs font-extrabold tracking-[.08em] text-[#2e6a41]"><span className="h-2 w-2 rounded-full bg-[#71a85a]" /> Cooperative-powered agricultural trade</div>
            <h1 className="rise-in-delay mt-5 max-w-xl font-display text-5xl font-bold leading-[.98] tracking-tight text-[#163b2a] sm:text-6xl">Local harvest. <em className="text-[#6a8940]">Fairer value.</em> Stronger communities.</h1>
            <p className="rise-in-delay mt-6 max-w-lg text-lg leading-8 text-[#4e6a59]">AgriCoop brings buyers, farmers, and cooperative officers together in one clear, community-first marketplace.</p>
            <div className="rise-in-delay mt-8 flex flex-wrap gap-3"><Link href="/marketplace" className="agri-button no-underline">Explore fresh listings <ArrowRight size={18} /></Link><Link href="/about" className="agri-ghost no-underline">See how AgriCoop works</Link></div>
            <p className="mt-6 text-sm font-medium text-[#607865]">Built for selected agricultural cooperatives in Butuan City, Agusan del Norte.</p>
          </div>
          <div className="relative min-h-[300px] sm:min-h-[380px] lg:min-h-[470px]">
            <div className="absolute inset-0 overflow-hidden rounded-[1.5rem] bg-[#b5ca88] sm:rounded-[2rem]">
              <img src={heroUrl} alt="Filipino farmers gathering fresh produce in a green field" className="h-full w-full object-cover object-center" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#163b2a]/35 via-transparent to-transparent" />
            </div>
            <div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-white/50 bg-[#fffdf8]/95 p-4 shadow-xl backdrop-blur sm:bottom-6 sm:left-6 sm:right-auto sm:min-w-64">
              <p className="text-xs font-extrabold uppercase tracking-[.12em] text-[#6a8940]">Direct & transparent</p>
              <p className="mt-1 font-display text-xl font-bold text-[#1f4f36]">Grow together, sell fairly.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8"><div className="grid gap-12 lg:grid-cols-[.78fr_1.22fr]"><div><p className="text-sm font-extrabold uppercase tracking-[.14em] text-[#628940]">Built around the cooperative</p><h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-[#1d4932]">A better market begins with better coordination.</h2></div><div className="grid gap-4 sm:grid-cols-3">{[{icon:Handshake,title:"Connect directly",body:"Bring fresh products and buyers closer without unnecessary layers."},{icon:Layers3,title:"Trade with clarity",body:"Compare prices, request quotations, and manage regular or bulk orders."},{icon:ShieldCheck,title:"Stay accountable",body:"Officer oversight keeps listings, inventory, and transactions organized."}].map(({icon:Icon,title,body})=><article key={title} className="agri-card p-5"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e4f0df] text-[#2c6a41]"><Icon size={21}/></span><h3 className="mt-5 font-display text-xl font-bold text-[#214b35]">{title}</h3><p className="mt-2 text-sm leading-6 text-[#627266]">{body}</p></article>)}</div></div></section>
    <section className="border-y border-[#dce6d6] bg-[#eff5eb]"><div className="mx-auto grid max-w-7xl gap-12 px-4 py-18 sm:px-6 lg:grid-cols-2 lg:px-8"><div><p className="text-sm font-extrabold uppercase tracking-[.14em] text-[#628940]">Designed for every participant</p><h2 className="mt-3 font-display text-4xl font-bold text-[#1d4932]">One shared market, each role with the right tools.</h2><p className="mt-4 max-w-xl leading-7 text-[#58705e]">AgriCoop makes it easier to participate in digital trade while keeping cooperative support and face-to-face relationships at the center.</p></div><div className="grid gap-3 sm:grid-cols-2">{[["Buyers","Discover crops, compare prices, arrange orders, and request quotations."],["Farmers","List harvests, maintain stock, respond to quotations, and fulfill orders."],["Cooperative officers","Validate members, monitor activity, and generate a clear operational view."],["System administrators","Manage roles, cooperative assignments, and platform-wide coordination."]].map(([role,body])=><div key={role} className="rounded-2xl border border-[#d9e5d3] bg-[#fffdf8] p-5"><BadgeCheck className="text-[#628940]" size={20}/><h3 className="mt-3 font-bold text-[#28543b]">{role}</h3><p className="mt-2 text-sm leading-6 text-[#627266]">{body}</p></div>)}</div></div></section>
  </main></PageFrame>;
}
