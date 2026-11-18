import { shellContainerClass, WorkspaceHeader } from "@/components/AgriShell";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";
import { ClipboardList, FileText, Leaf, Loader2, MessageCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation, useSearch } from "wouter";

const peso = (cents: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);
const Status = ({ value }: { value: string }) => <span className={`status-pill status-${value}`}>{value.replaceAll("_", " ")}</span>;

type OrderStatusTab = "all" | "to_pay" | "to_ship" | "to_receive" | "completed" | "cancelled";
type OrderInboxTab = "active" | "archived";

const ORDER_STATUS_TABS: { id: OrderStatusTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "to_pay", label: "To Pay" },
  { id: "to_ship", label: "To Ship" },
  { id: "to_receive", label: "To Receive" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

const ORDER_INBOX_TABS: { id: OrderInboxTab; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "archived", label: "Archived" },
];

function parseOrderInboxTab(search: string): OrderInboxTab {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = params.get("tab");
  return raw === "archived" ? "archived" : "active";
}

function matchesOrderTab(status: string, paymentStatus: string, tab: OrderStatusTab) {
  if (tab === "all") return true;
  if (tab === "cancelled") return status === "cancelled";
  if (tab === "completed") return status === "completed" || status === "delivered";
  if (tab === "to_pay") return paymentStatus === "pending" || paymentStatus === "F2F-pending-confirmation" || paymentStatus === "awaiting_verification";
  if (tab === "to_ship") return ["submitted", "confirmed", "processing"].includes(status) && paymentStatus !== "failed";
  if (tab === "to_receive") return status === "ready" || status === "shipped";
  return true;
}

export default function Activity() {
  const { user, loading } = useAuth();
  const search = useSearch();
  const [location, setLocation] = useLocation();
  const inboxTab = parseOrderInboxTab(search);
  const [statusTab, setStatusTab] = useState<OrderStatusTab>("all");
  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([]);

  const ordersEnabled = !!user && (user.role === "buyer" || user.role === "seller");
  const utils = trpc.useUtils();
  const openOrderChat = trpc.conversations.openForOrder.useMutation({
    onSuccess: data => setLocation(`/messages?id=${data.conversationId}`),
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const ordersQuery = trpc.orders.buyerMine.useQuery(
    { archived: inboxTab === "archived" },
    { enabled: ordersEnabled },
  );
  const countsQuery = trpc.orders.buyerMineCounts.useQuery(undefined, { enabled: ordersEnabled });
  const archiveMutation = trpc.orders.updateArchive.useMutation({
    onSuccess: (_data, variables) => {
      toast.success(variables.action === "archive" ? "Orders archived." : "Orders restored to active.");
      setSelectedOrderIds([]);
      void utils.orders.buyerMine.invalidate();
      void utils.orders.buyerMineCounts.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const quotationsQuery = trpc.quotations.buyerMine.useQuery(
    { archived: inboxTab === "archived" },
    { enabled: ordersEnabled },
  );
  const quotationCountsQuery = trpc.quotations.counts.useQuery(
    { side: "buyer" },
    { enabled: ordersEnabled },
  );
  const quotationStateMutation = trpc.quotations.updateState.useMutation({
    onSuccess: (_data, variables) => {
      toast.success(variables.action === "archive" ? "Quotations archived." : variables.action === "unarchive" ? "Quotations restored." : "Quotation view updated.");
      void utils.quotations.buyerMine.invalidate();
      void utils.quotations.counts.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });

  const setInboxTab = useCallback(
    (next: OrderInboxTab) => {
      const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
      params.set("tab", next);
      const path = location.split("?")[0] || "/activity";
      setLocation(`${path}?${params.toString()}`, { replace: false });
      setSelectedOrderIds([]);
      setStatusTab("all");
    },
    [location, search, setLocation],
  );

  useEffect(() => {
    setSelectedOrderIds([]);
  }, [inboxTab]);

  const { data: orders = [], isLoading: ordersLoading, error: ordersError } = ordersQuery;
  const { data: quotations = [], isLoading: quotationsLoading, error: quotationsError } = quotationsQuery;
  const filteredOrders = useMemo(
    () => orders.filter(row => matchesOrderTab(row.order.status, row.order.paymentStatus, statusTab)),
    [orders, statusTab],
  );

  const toggleAllOrders = () => {
    if (selectedOrderIds.length === filteredOrders.length) setSelectedOrderIds([]);
    else setSelectedOrderIds(filteredOrders.map(row => row.order.id));
  };

  const toggleOrder = (orderId: number) => {
    setSelectedOrderIds(prev => (prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]));
  };

  const runBulkArchive = (action: "archive" | "unarchive") => {
    if (!selectedOrderIds.length) {
      toast.error("Select at least one order.");
      return;
    }
    archiveMutation.mutate({ orderIds: selectedOrderIds, action });
  };

  const runSingleArchive = (orderId: number, action: "archive" | "unarchive") => {
    archiveMutation.mutate({ orderIds: [orderId], action });
  };

  const activeCount = countsQuery.data?.active ?? 0;
  const archivedCount = countsQuery.data?.archived ?? 0;

  if (loading) {
    return (
      <div className="grid min-h-[40vh] place-items-center bg-[#f8f5ee]">
        <Loader2 className="animate-spin text-[#4e8257]" />
      </div>
    );
  }

  if (!user || (user.role !== "buyer" && user.role !== "seller")) {
    return (
      <>
        <WorkspaceHeader title="Marketplace activity" description="Your outgoing orders and quotation requests." />
        <main className={`${shellContainerClass} py-10`}>
          <div className="agri-card p-8 text-center">
            <Leaf className="mx-auto text-[#6d9852]" />
            <h1 className="mt-4 font-display text-3xl font-bold text-[#254f37]">Buyer or Farmer access required</h1>
            <p className="mt-3 text-[#65766b]">Approved Buyer and Farmer accounts can review outgoing activity here.</p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <WorkspaceHeader title="Marketplace activity" description="Review the orders and quotations you submitted to other farm sellers." />
      <main className={`${shellContainerClass} py-8`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-extrabold uppercase tracking-[.13em] text-[#668d49]">Outgoing activity</p>
            <h1 className="mt-1 font-display text-3xl font-bold text-[#244e36]">Orders and quotations</h1>
          </div>
          <Link href="/marketplace" className="agri-button min-h-11 text-sm no-underline">
            Browse marketplace
          </Link>
        </div>

        {ordersError || quotationsError ? (
          <div className="mt-6 rounded-xl bg-[#fff1ec] p-4 text-sm text-[#a34838]">
            <p role="alert">{toUserFacingErrorMessage(ordersError?.message || quotationsError?.message)}</p>
            <button
              type="button"
              className="agri-button mt-4 min-h-11 text-sm"
              disabled={ordersQuery.isFetching || quotationsQuery.isFetching}
              onClick={() => void Promise.all([ordersQuery.refetch(), quotationsQuery.refetch()])}
            >
              <Loader2 className={ordersQuery.isFetching || quotationsQuery.isFetching ? "animate-spin" : ""} size={15} /> Retry
            </button>
          </div>
        ) : (
          <section className="mt-7 grid gap-7 xl:grid-cols-[1.25fr_.75fr]">
            <div className="agri-card p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#edf4e9] text-[#4b814d]">
                  <ClipboardList size={19} />
                </span>
                <div>
                  <h2 className="font-display text-2xl font-bold text-[#264f37]">My Orders</h2>
                  <p className="text-sm text-[#6a796e]">Track fulfillment the way marketplace status tabs do.</p>
                </div>
              </div>

              <div
                className="mt-4 flex gap-2 overflow-x-auto pb-1"
                role="tablist"
                aria-label="Order inbox"
              >
                {ORDER_INBOX_TABS.map(item => {
                  const selected = inboxTab === item.id;
                  const count = item.id === "active" ? activeCount : archivedCount;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      className={`min-h-11 shrink-0 rounded-xl px-3 text-xs font-bold ${selected ? "bg-[#1f4f36] text-white" : "bg-[#edf3e9] text-[#315640]"}`}
                      onClick={() => setInboxTab(item.id)}
                    >
                      {item.label}
                      {countsQuery.isSuccess ? ` (${count})` : ""}
                    </button>
                  );
                })}
              </div>

              {selectedOrderIds.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#dce4d6] bg-[#fffdf8] p-3">
                  <span className="text-sm font-bold text-[#315640]">{selectedOrderIds.length} selected</span>
                  {inboxTab === "active" ? (
                    <button type="button" className="agri-ghost min-h-11 text-xs" disabled={archiveMutation.isPending} onClick={() => runBulkArchive("archive")}>
                      Archive
                    </button>
                  ) : (
                    <button type="button" className="agri-ghost min-h-11 text-xs" disabled={archiveMutation.isPending} onClick={() => runBulkArchive("unarchive")}>
                      Unarchive
                    </button>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Order status filters">
                  {ORDER_STATUS_TABS.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={statusTab === item.id}
                      className={`min-h-11 shrink-0 rounded-xl px-3 text-xs font-bold ${statusTab === item.id ? "bg-[#1f4f36] text-white" : "bg-[#edf3e9] text-[#315640]"}`}
                      onClick={() => setStatusTab(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                {filteredOrders.length > 0 && (
                  <label className="flex shrink-0 items-center gap-2 text-xs font-bold text-[#56705c]">
                    <input
                      type="checkbox"
                      checked={filteredOrders.length > 0 && selectedOrderIds.length === filteredOrders.length}
                      onChange={toggleAllOrders}
                    />
                    Select all
                  </label>
                )}
              </div>

              <div className="mt-5 space-y-3">
                {ordersLoading ? (
                  <Loader2 className="mx-auto my-8 animate-spin text-[#5d8a5e]" />
                ) : filteredOrders.length ? (
                  filteredOrders.map(row => (
                    <div key={row.order.id} className="rounded-xl border border-[#e2e9dd] p-4">
                      <div className="flex flex-wrap items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selectedOrderIds.includes(row.order.id)}
                          onChange={() => toggleOrder(row.order.id)}
                          aria-label={`Select order ${row.order.id}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap justify-between gap-2">
                            <div>
                              <Link href={`/orders/${row.order.id}`} className="font-bold text-[#315640] no-underline hover:text-[#1f5a3c]">
                                Order #{row.order.id} · {row.sellerName || "Farm seller"}
                              </Link>
                              <p className="mt-1 text-xs text-[#708074]">{row.order.orderType} order</p>
                            </div>
                            <Status value={row.order.status} />
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {row.items.map(item => (
                              <span key={item.item.id} className="rounded-lg bg-[#f0f5ed] px-2 py-1 text-xs text-[#45614e]">
                                {item.productName} × {item.item.quantity} {item.unit}
                              </span>
                            ))}
                          </div>
                          <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-[#edf0e9] pt-3">
                            <strong className="font-display text-[#27573a]">{peso(row.order.totalCents)}</strong>
                            <span className="text-xs text-[#6d7d70]">
                              {row.order.paymentMethod || "f2f"} · <Status value={row.order.paymentStatus} />
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="agri-button min-h-11 text-sm"
                              disabled={openOrderChat.isPending}
                              onClick={() => openOrderChat.mutate({ orderId: row.order.id })}
                            >
                              {openOrderChat.isPending ? <Loader2 className="animate-spin" size={15} /> : <MessageCircle size={15} />} Message
                            </button>
                            <button
                              type="button"
                              className="agri-ghost min-h-11 text-sm"
                              disabled={archiveMutation.isPending}
                              onClick={() => runSingleArchive(row.order.id, inboxTab === "active" ? "archive" : "unarchive")}
                            >
                              {inboxTab === "active" ? "Archive" : "Unarchive"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="py-9 text-center text-sm text-[#6d7d70]">
                    {inboxTab === "archived" ? "No archived orders yet." : "No orders in this status yet."}
                  </p>
                )}
              </div>
            </div>

            <div className="agri-card p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#edf4e9] text-[#4b814d]">
                  <FileText size={19} />
                </span>
                <div>
                  <h2 className="font-display text-2xl font-bold text-[#264f37]">Quotation requests</h2>
                  <p className="text-sm text-[#6a796e]">
                    {inboxTab === "archived" ? "Archived" : "Active"} · {quotationCountsQuery.data?.active ?? 0} active / {quotationCountsQuery.data?.archived ?? 0} archived
                  </p>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {quotationsLoading ? (
                  <Loader2 className="mx-auto my-8 animate-spin text-[#5d8a5e]" />
                ) : quotations.length ? (
                  quotations.map(row => (
                    <div key={row.quotation.id} className="rounded-xl bg-[#f2f6ef] p-4">
                      <div className="flex justify-between gap-2">
                        <div>
                          <p className="font-bold text-[#315640]">{row.productName}</p>
                          <p className="mt-1 text-xs text-[#708074]">
                            {row.quotation.requestedQty} {row.unit} from {row.sellerName || "farm seller"}
                          </p>
                        </div>
                        <Status value={row.quotation.status} />
                      </div>
                      {row.quotation.quotedPriceCents && (
                        <p className="mt-3 font-display text-lg font-bold text-[#2b603f]">
                          {peso(row.quotation.quotedPriceCents)} per {row.unit}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="agri-ghost px-3 py-1.5 text-xs"
                          disabled={quotationStateMutation.isPending}
                          onClick={() => quotationStateMutation.mutate({
                            quotationIds: [row.quotation.id],
                            action: inboxTab === "active" ? "archive" : "unarchive",
                            side: "buyer",
                          })}
                        >
                          {inboxTab === "active" ? "Archive" : "Unarchive"}
                        </button>
                        <button
                          type="button"
                          className="agri-ghost px-3 py-1.5 text-xs text-[#a34838]"
                          disabled={quotationStateMutation.isPending}
                          onClick={() => quotationStateMutation.mutate({
                            quotationIds: [row.quotation.id],
                            action: "delete",
                            side: "buyer",
                          })}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="py-9 text-center text-sm text-[#6d7d70]">
                    {inboxTab === "archived" ? "No archived quotation requests." : "No quotation requests yet."}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </>
  );
}