import { useMemo, useState, type ReactNode } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { formatDateManilaIso } from "@/lib/datetime";

/**
 * Data-driven analytics dashboard shared by SuperAdmin (platform scope) and
 * OfficerAdmin (cooperative scope — admin.overview is already coop-scoped).
 * Every metric is computed from real overview rows; soft-deleted records are
 * excluded from "active" counts but still reported separately.
 */

const AGRI = {
  primary: "#1f5a3c",
  secondary: "#4c8a5f",
  accent: "#d9a441",
  danger: "#a34838",
  muted: "#8a978d",
  grid: "#e7ede4",
};
const PIE_COLORS = [AGRI.primary, AGRI.secondary, AGRI.accent, "#7d9b76", "#b7c9ae", AGRI.danger, "#5b7d68"];

type RangeKey = "today" | "7d" | "30d" | "90d" | "custom";

function rangeStart(key: RangeKey, customStart?: string): Date | null {
  const now = new Date();
  if (key === "custom") return customStart ? new Date(`${customStart}T00:00:00+08:00`) : null;
  const days = key === "today" ? 0 : key === "7d" ? 7 : key === "30d" ? 30 : 90;
  if (key === "today") {
    // Manila midnight
    const manilaNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
    return new Date(manilaNow.getFullYear(), manilaNow.getMonth(), manilaNow.getDate());
  }
  return new Date(now.getTime() - days * 86400000);
}

function inRange(value: unknown, start: Date | null, end?: Date): boolean {
  if (!start) return true;
  const d = value ? new Date(value as string) : null;
  if (!d || Number.isNaN(d.getTime())) return false;
  return d >= start && (!end || d <= end);
}

function dayKey(value: unknown): string {
  const d = value ? new Date(value as string) : null;
  return d && !Number.isNaN(d.getTime()) ? formatDateManilaIso(d) : "";
}

function bucketize<T>(rows: T[], getDate: (r: T) => unknown, getValue: (r: T) => number, start: Date | null): { day: string; value: number }[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!inRange(getDate(row), start)) continue;
    const key = dayKey(getDate(row)) || "unknown";
    map.set(key, (map.get(key) ?? 0) + getValue(row));
  }
  return Array.from(map.entries())
    .map(([day, value]) => ({ day, value }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

function countBy<T>(rows: T[], getKey: (r: T) => string, start: Date | null = null, getDate?: (r: T) => unknown): { name: string; value: number }[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (start && getDate && !inRange(getDate(row), start)) continue;
    const key = getKey(row) || "unknown";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
}

function peso(cents: number) {
  return `₱${(cents / 100).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function ChartCard({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`agri-card p-4 sm:p-5 ${className}`}>
      <h3 className="font-display text-base font-bold text-[#264f37]">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-[#6a796e]">{subtitle}</p>}
      <div className="mt-3 h-56 w-full">{children}</div>
    </section>
  );
}

function Meter({ label, value, hint, color = AGRI.primary }: { label: string; value: number | null; hint: string; color?: string }) {
  const pct = value == null ? null : Math.max(0, Math.min(100, Math.round(value * 10) / 10));
  return (
    <div className="rounded-xl border border-[#e2e9dd] bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-[#4c5f52]">{label}</p>
        <p className="text-sm font-bold text-[#264f37]">{pct == null ? "—" : `${pct}%`}</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#eef2ea]">
        {pct != null && <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />}
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-[#8a978d]">{hint}</p>
    </div>
  );
}

function Donut({ data, height = 180 }: { data: { name: string; value: number }[]; height?: number }) {
  if (!data.length) return <p className="grid h-full place-items-center text-xs text-[#8a978d]">No data in range.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
          {data.map((entry, i) => <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v: number, name: string) => [`${v}`, name]} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function DashboardAnalytics({ overview, isPlatformAdmin, healthOk }: {
  overview: {
    users: { user: { id: number; role: string; deletedAt: Date | string | null; createdAt?: Date | string | null; approvalStatus?: string | null } }[];
    cooperatives: { id: number; name: string; status?: string | null; deletedAt: Date | string | null; createdAt?: Date | string | null }[];
    products: { id: number; sellerId?: number | null; verificationStatus: string | null; status: string | null; visibility?: string | null; deletedAt: Date | string | null; createdAt?: Date | string | null }[];
    orders: { id: number; status: string | null; paymentStatus?: string | null; fulfillmentMethod?: string | null; totalCents?: number | null; cooperativeId?: number | null; createdAt?: Date | string | null }[];
    quotations: { quotation: { id: number; status: string | null; createdAt?: Date | string | null } }[];
    transactions: { id: number; status: string | null; amountCents?: number | null; createdAt?: Date | string | null }[];
  };
  isPlatformAdmin: boolean;
  healthOk: boolean | null;
}) {
  const [range, setRange] = useState<RangeKey>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const start = rangeStart(range, customStart);
  const end = range === "custom" && customEnd ? new Date(`${customEnd}T23:59:59+08:00`) : undefined;

  const activeUsers = useMemo(() => overview.users.filter(r => !r.user.deletedAt), [overview.users]);
  const activeCoops = useMemo(() => overview.cooperatives.filter(c => !c.deletedAt), [overview.cooperatives]);
  const liveProducts = useMemo(() => overview.products.filter(p => !p.deletedAt), [overview.products]);
  const liveOrders = useMemo(() => overview.orders, [overview.orders]);

  const filteredOrders = useMemo(() => liveOrders.filter(o => inRange(o.createdAt, start, end)), [liveOrders, start, end]);
  const filteredTransactions = useMemo(() => overview.transactions.filter(t => inRange(t.createdAt, start, end)), [overview.transactions, start, end]);
  const filteredUsers = useMemo(() => activeUsers.filter(r => inRange(r.user.createdAt, start, end)), [activeUsers, start, end]);
  const filteredCoops = useMemo(() => activeCoops.filter(c => inRange(c.createdAt, start, end)), [activeCoops, start, end]);
  const filteredProducts = useMemo(() => liveProducts.filter(p => inRange(p.createdAt, start, end)), [liveProducts, start, end]);
  const filteredQuotations = useMemo(() => overview.quotations.filter(q => inRange(q.quotation.createdAt, start, end)), [overview.quotations, start, end]);

  const ordersOverTime = useMemo(() => bucketize(filteredOrders, o => o.createdAt, () => 1, null), [filteredOrders]);
  const salesOverTime = useMemo(() => bucketize(filteredOrders.filter(o => o.status !== "cancelled"), o => o.createdAt, o => o.totalCents ?? 0, null), [filteredOrders]);
  const usersOverTime = useMemo(() => bucketize(filteredUsers.map(r => r.user), u => u.createdAt, () => 1, null), [filteredUsers]);
  const coopsOverTime = useMemo(() => bucketize(filteredCoops, c => c.createdAt, () => 1, null), [filteredCoops]);
  const listingsOverTime = useMemo(() => bucketize(filteredProducts, p => p.createdAt, () => 1, null), [filteredProducts]);
  const transactionsOverTime = useMemo(() => bucketize(filteredTransactions, t => t.createdAt, () => 1, null), [filteredTransactions]);

  const orderStatusDist = useMemo(() => countBy(filteredOrders, o => o.status ?? "unknown"), [filteredOrders]);
  const paymentStatusDist = useMemo(() => countBy(filteredOrders, o => o.paymentStatus ?? "unpaid"), [filteredOrders]);
  const fulfillmentDist = useMemo(() => countBy(filteredOrders.filter(o => o.fulfillmentMethod), o => o.fulfillmentMethod ?? "unknown"), [filteredOrders]);
  const transactionStatusDist = useMemo(() => countBy(filteredTransactions, t => t.status ?? "unknown"), [filteredTransactions]);
  const listingStatusDist = useMemo(() => countBy(liveProducts, p => p.verificationStatus ?? "unknown"), [liveProducts]);

  // Cooperative performance comparison (platform scope only)
  const coopPerformance = useMemo(() => {
    if (!isPlatformAdmin) return [];
    const map = new Map<number, { name: string; orders: number; sales: number }>();
    const nameById = new Map(overview.cooperatives.map(c => [c.id, c.name]));
    for (const o of filteredOrders) {
      const cid = o.cooperativeId;
      if (cid == null) continue;
      const entry = map.get(cid) ?? { name: nameById.get(cid) ?? `Coop #${cid}`, orders: 0, sales: 0 };
      entry.orders += 1;
      if (o.status !== "cancelled") entry.sales += o.totalCents ?? 0;
      map.set(cid, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.sales - a.sales).slice(0, 8);
  }, [isPlatformAdmin, filteredOrders, overview.cooperatives]);

  // Performance meters — all computed from real rows
  const completedOrders = filteredOrders.filter(o => o.status === "completed").length;
  const terminalOrders = filteredOrders.filter(o => o.status === "completed" || o.status === "cancelled").length;
  const completionRate = terminalOrders ? completedOrders / terminalOrders : null;

  const paidOrders = filteredOrders.filter(o => o.paymentStatus === "paid" || o.paymentStatus === "verified" || o.paymentStatus === "refunded").length;
  const paymentVerificationRate = filteredOrders.length ? paidOrders / filteredOrders.length : null;

  const decidedListings = liveProducts.filter(p => p.verificationStatus === "approved" || p.verificationStatus === "rejected");
  const approvedListings = liveProducts.filter(p => p.verificationStatus === "approved").length;
  const listingApprovalRate = decidedListings.length ? approvedListings / decidedListings.length : null;

  const sellersWithListings = new Set(liveProducts.map(p => p.sellerId).filter((v): v is number => v != null));
  const totalSellers = activeUsers.filter(r => r.user.role === "seller").length;
  const sellerParticipation = totalSellers ? sellersWithListings.size / totalSellers : null;

  const avgOrdersPerCoop = activeCoops.length ? filteredOrders.length / activeCoops.length : null;
  const topCoopOrders = coopPerformance[0]?.orders ?? 0;
  const coopPerformanceRatio = isPlatformAdmin && topCoopOrders ? Math.min(1, (filteredOrders.length / Math.max(1, activeCoops.length)) / Math.max(1, topCoopOrders)) : null;

  const healthValue = healthOk == null ? null : healthOk ? 100 : 0;

  const rangeLabel = range === "custom" ? "Custom range" : ({ today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" } as Record<string, string>)[range];

  return (
    <div className="space-y-5">
      {/* Range filter */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#6a796e]">Range</span>
        {(["today", "7d", "30d", "90d", "custom"] as RangeKey[]).map(key => (
          <button
            key={key}
            type="button"
            onClick={() => setRange(key)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${range === key ? "bg-[#1f5a3c] text-white" : "border border-[#d7dfd1] bg-white text-[#4c5f52] hover:bg-[#f2f6ef]"}`}
          >
            {key === "custom" ? "Custom" : { today: "Today", "7d": "7D", "30d": "30D", "90d": "90D" }[key]}
          </button>
        ))}
        {range === "custom" && (
          <span className="flex items-center gap-2 text-xs text-[#4c5f52]">
            <input type="date" className="rounded-md border border-[#d7dfd1] bg-white px-2 py-1" value={customStart} onChange={e => setCustomStart(e.target.value)} aria-label="Start date" />
            <span>to</span>
            <input type="date" className="rounded-md border border-[#d7dfd1] bg-white px-2 py-1" value={customEnd} onChange={e => setCustomEnd(e.target.value)} aria-label="End date" />
          </span>
        )}
        <span className="ml-auto text-xs text-[#8a978d]">Asia/Manila · {rangeLabel}</span>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Orders", filteredOrders.length],
          ["Sales", peso(filteredOrders.filter(o => o.status !== "cancelled").reduce((s, o) => s + (o.totalCents ?? 0), 0))],
          ["Users", filteredUsers.length],
          ["Cooperatives", filteredCoops.length],
          ["Listings", filteredProducts.length],
          ["Transactions", filteredTransactions.length],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl border border-[#e2e9dd] bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8a978d]">{label}</p>
            <p className="mt-1 font-display text-xl font-bold text-[#264f37]">{value}</p>
          </div>
        ))}
      </div>

      {/* Trend charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Orders over time" subtitle="Orders created per day">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={ordersOverTime} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={AGRI.grid} vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Area type="monotone" dataKey="value" stroke={AGRI.primary} fill={AGRI.primary} fillOpacity={0.15} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Sales over time" subtitle="Order value per day (excl. cancelled)">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={salesOverTime} margin={{ top: 4, right: 8, left: -6, bottom: 0 }}>
              <CartesianGrid stroke={AGRI.grid} vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} minTickGap={24} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₱${Math.round(v / 100)}`} width={54} />
              <Tooltip formatter={(v: number) => [peso(v), "Sales"]} />
              <Area type="monotone" dataKey="value" stroke={AGRI.accent} fill={AGRI.accent} fillOpacity={0.18} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="User growth" subtitle="New accounts per day">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={usersOverTime} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={AGRI.grid} vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke={AGRI.secondary} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={isPlatformAdmin ? "Cooperative growth" : "Listing activity"} subtitle={isPlatformAdmin ? "New cooperatives per day" : "New listings per day"}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={isPlatformAdmin ? coopsOverTime : listingsOverTime} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={AGRI.grid} vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="value" fill={isPlatformAdmin ? AGRI.secondary : AGRI.primary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Transaction activity" subtitle="Payment transactions per day">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={transactionsOverTime} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={AGRI.grid} vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="value" fill={AGRI.accent} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Quotations" subtitle="Quotation requests per day">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bucketize(filteredQuotations, q => q.quotation.createdAt, () => 1, null)} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={AGRI.grid} vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="value" fill={AGRI.secondary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Distributions */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ChartCard title="Order status" subtitle={`${filteredOrders.length} orders`}>
          <Donut data={orderStatusDist} />
        </ChartCard>
        <ChartCard title="Payment status" subtitle={`${filteredOrders.length} orders`}>
          <Donut data={paymentStatusDist} />
        </ChartCard>
        <ChartCard title="Fulfillment method" subtitle="Pickup vs delivery">
          <Donut data={fulfillmentDist.length ? fulfillmentDist : countBy(filteredOrders, o => "not_set")} />
        </ChartCard>
        <ChartCard title="Transaction status" subtitle={`${filteredTransactions.length} transactions`}>
          <Donut data={transactionStatusDist} />
        </ChartCard>
      </div>

      {/* Cooperative comparison — platform scope only */}
      {isPlatformAdmin && coopPerformance.length > 0 && (
        <ChartCard title="Cooperative performance" subtitle="Orders and sales by cooperative (range)">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={coopPerformance} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={AGRI.grid} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number, name: string) => [name === "sales" ? peso(v) : v, name === "sales" ? "Sales" : "Orders"]} />
              <Bar dataKey="orders" fill={AGRI.primary} radius={[0, 4, 4, 0]} name="orders" />
              <Bar dataKey="sales" fill={AGRI.accent} radius={[0, 4, 4, 0]} name="sales" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Performance meters */}
      <section>
        <h3 className="font-display text-lg font-bold text-[#264f37]">Performance indicators</h3>
        <p className="mt-0.5 text-xs text-[#6a796e]">Calculated from live records in the selected range. Deleted records are excluded from active counts.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Meter label="Order completion rate" value={completionRate == null ? null : completionRate * 100} hint="Completed ÷ (completed + cancelled) orders" />
          <Meter label="Payment verification progress" value={paymentVerificationRate == null ? null : paymentVerificationRate * 100} hint="Paid or refunded ÷ all orders" color={AGRI.secondary} />
          <Meter label="Listing approval rate" value={listingApprovalRate == null ? null : listingApprovalRate * 100} hint="Approved ÷ decided listings (pending excluded)" color={AGRI.accent} />
          <Meter label="Seller participation" value={sellerParticipation == null ? null : sellerParticipation * 100} hint="Sellers with ≥1 live listing ÷ all sellers" />
          {isPlatformAdmin ? (
            <Meter label="Platform balance" value={coopPerformanceRatio == null ? null : coopPerformanceRatio * 100} hint="Average orders per coop vs busiest coop" color={AGRI.accent} />
          ) : (
            <Meter label="Cooperative order volume" value={null} hint={`${filteredOrders.length} orders across ${activeCoops.length} coop${activeCoops.length === 1 ? "" : "s"} in range`} />
          )}
          <Meter label="System health" value={healthValue} hint={healthOk == null ? "Checking /api/health…" : healthOk ? "API and database reachable" : "API or database unreachable"} color={healthOk === false ? AGRI.danger : AGRI.primary} />
        </div>
      </section>
    </div>
  );
}
