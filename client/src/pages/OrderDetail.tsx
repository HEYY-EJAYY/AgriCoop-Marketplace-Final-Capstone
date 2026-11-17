import { shellContainerClass, WorkspaceHeader } from "@/components/AgriShell";
import { ProductImage } from "@/components/ProductImage";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatDateTimeManila } from "@/lib/datetime";
import { resolveProductImageSrc } from "@/lib/productImages";
import { trpc } from "@/lib/trpc";
import {
  fulfillmentFromPaymentMethod,
  fulfillmentLabel,
  paymentMethodLabel,
  paymentStatusLabel,
} from "@shared/paymentMethods";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";
import { ArrowLeft, ClipboardList, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link, useRoute } from "wouter";

const peso = (cents: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);

type OrderParty = {
  id?: number;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  contactNumber?: string | null;
  address?: string | null;
} | null;

type OrderLine = {
  item: {
    id: number;
    productId: number;
    quantity: number;
    unitPriceCents: number;
  };
  productName: string;
  unit?: string | null;
  primaryImageUrl?: string | null;
  imageUrl?: string | null;
};

type HistoryRow = {
  id?: number;
  eventType?: string | null;
  action?: string | null;
  fromValue?: string | null;
  toValue?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  note?: string | null;
  actorName?: string | null;
  createdAt?: Date | string | null;
  event?: {
    id?: number;
    action?: string | null;
    fromStatus?: string | null;
    toStatus?: string | null;
    note?: string | null;
    createdAt?: Date | string | null;
  };
};

type OrderDetailPayload = {
  order: {
    id: number;
    status: string;
    paymentStatus: string;
    paymentMethod?: string | null;
    fulfillmentMethod?: string | null;
    totalCents: number;
    buyerNote?: string | null;
    createdAt: Date | string;
    updatedAt?: Date | string | null;
  };
  items: OrderLine[];
  buyer?: OrderParty;
  seller?: OrderParty;
  cooperative?: { id?: number; name?: string | null; location?: string | null; slug?: string | null } | null;
  payment?: { status?: string | null; amountCents?: number | null; paymentMethod?: string | null } | null;
  proof?: {
    id?: number;
    signedUrl?: string | null;
    evidenceUrl?: string | null;
    verificationStatus?: string | null;
  } | null;
  history?: HistoryRow[];
  events?: HistoryRow[];
};

type QueryErrorLike = { data?: { code?: string } | null; message?: string } | null;

type OrderByIdHook = {
  useQuery: (
    input: { id: number },
    opts?: { enabled?: boolean },
  ) => {
    data: OrderDetailPayload | undefined;
    isLoading: boolean;
    isFetching: boolean;
    error: QueryErrorLike;
    refetch: () => unknown;
  };
};

function useOrdersById(id: number, enabled: boolean) {
  return trpc.orders.byId.useQuery({ id }, { enabled });
}

function hasPaymentProcedure(name: "recordCashReceipt" | "reviewProof") {
  const payments = trpc.payments as typeof trpc.payments & Record<string, { useMutation?: unknown } | undefined>;
  return typeof payments[name]?.useMutation === "function";
}

function historyLabel(row: HistoryRow) {
  const eventType = row.eventType || row.action || row.event?.action || "Update";
  const from = row.fromValue ?? row.fromStatus ?? row.event?.fromStatus;
  const to = row.toValue ?? row.toStatus ?? row.event?.toStatus;
  if (from && to) return `${String(eventType).replaceAll("_", " ")}: ${from} → ${to}`;
  if (to) return `${String(eventType).replaceAll("_", " ")} → ${to}`;
  return String(eventType).replaceAll("_", " ");
}

function historyWhen(row: HistoryRow) {
  return row.createdAt ?? row.event?.createdAt ?? null;
}

function isNotFoundOrForbidden(error: QueryErrorLike) {
  const code = error?.data?.code;
  return code === "NOT_FOUND" || code === "FORBIDDEN" || code === "UNAUTHORIZED";
}

export default function OrderDetail() {
  const [match, params] = useRoute("/orders/:id");
  const rawId = match ? params?.id : undefined;
  const orderId = Number(rawId);
  const validId = Number.isSafeInteger(orderId) && orderId > 0;
  const { user } = useAuth();
  const [reviewNote, setReviewNote] = useState("");

  const detailQuery = useOrdersById(orderId, validId);
  const { data, isLoading, isFetching, error, refetch } = detailQuery;
  const utils = trpc.useUtils();

  const canRecordCash = hasPaymentProcedure("recordCashReceipt");
  const canReviewProof = hasPaymentProcedure("reviewProof");

  const recordCashReceipt = trpc.payments.recordCashReceipt.useMutation({
    onSuccess: async () => {
      toast.success("Cash receipt recorded.");
      await Promise.all([
        refetch(),
        utils.orders.buyerMine.invalidate(),
        utils.orders.sellerMine.invalidate(),
        utils.payments.mine.invalidate(),
      ]);
    },
    onError: problem => toast.error(toUserFacingErrorMessage(problem.message)),
  });

  const reviewProof = trpc.payments.reviewProof.useMutation({
    onSuccess: async () => {
      toast.success("Payment review saved.");
      setReviewNote("");
      await Promise.all([
        refetch(),
        utils.payments.reviewQueue.invalidate(),
        utils.payments.mine.invalidate(),
      ]);
    },
    onError: problem => toast.error(toUserFacingErrorMessage(problem.message)),
  });

  if (!validId || (!isLoading && !error && !data) || isNotFoundOrForbidden(error)) {
    return (
      <>
        <WorkspaceHeader title="Order details" description="Review who is involved, what was ordered, and how payment is progressing." />
        <main className={`${shellContainerClass} py-10`}>
          <div className="agri-card mx-auto max-w-xl p-8 text-center">
            <ClipboardList className="mx-auto text-[#6d9852]" />
            <h1 className="mt-4 font-display text-3xl font-bold text-[#254f37]">Order not found</h1>
            <p className="mt-3 text-[#65766b]">
              {toUserFacingErrorMessage(
                error?.message,
                "This order is unavailable, or you do not have access to view it.",
              )}
            </p>
            <Link href="/activity" className="agri-button mt-5 inline-flex min-h-11 text-sm no-underline">
              <ArrowLeft size={16} /> Back to activity
            </Link>
          </div>
        </main>
      </>
    );
  }

  if (error) {
    return (
      <>
        <WorkspaceHeader title="Order details" description="Review who is involved, what was ordered, and how payment is progressing." />
        <main className={`${shellContainerClass} py-10`}>
          <div className="agri-card mx-auto max-w-xl p-8 text-center">
            <h1 className="font-display text-3xl font-bold text-[#254f37]">Order details are unavailable</h1>
            <p role="alert" className="mt-3 text-[#65766b]">{toUserFacingErrorMessage(error.message)}</p>
            <button type="button" className="agri-button mt-5 min-h-11" disabled={isFetching} onClick={() => void refetch()}>
              <Loader2 className={isFetching ? "animate-spin" : ""} size={16} /> Retry
            </button>
          </div>
        </main>
      </>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f8f5ee]">
        <Loader2 className="animate-spin text-[#4e8257]" />
      </div>
    );
  }

  const { order, items, buyer, seller, cooperative, payment, proof } = data;
  const history: HistoryRow[] = (data.history?.length ? data.history : data.events) ?? [];
  const fulfillment =
    order.fulfillmentMethod
    || fulfillmentFromPaymentMethod(order.paymentMethod)
    || null;
  const receiptUrl = proof?.signedUrl || proof?.evidenceUrl || null;
  const paymentMethod = order.paymentMethod || payment?.paymentMethod || null;
  const paymentStatus = order.paymentStatus || payment?.status || null;

  const role = user?.role;
  const isSellerOrOfficer = role === "seller" || role === "admin" || role === "superadmin";
  const isOfficer = role === "admin" || role === "superadmin";
  const cashMethod = paymentMethod === "cash_pickup" || paymentMethod === "cash_delivery";
  const showRecordCash =
    canRecordCash
    && isSellerOrOfficer
    && cashMethod
    && order.status === "ready"
    && paymentStatus !== "paid"
    && paymentStatus !== "verified";
  const showReviewProof =
    canReviewProof
    && isSellerOrOfficer
    && proof?.id
    && (proof.verificationStatus === "pending" || paymentStatus === "awaiting_verification");

  return (
    <>
      <WorkspaceHeader
        title={`Order #${order.id}`}
        description="Who is involved, what was ordered, how payment works, and when status changed."
      />
      <main className={`${shellContainerClass} py-8`}>
        <nav className="mb-5 text-xs font-bold text-[#66806b]" aria-label="Breadcrumb">
          <Link href="/dashboard" className="no-underline hover:text-[#1f5a3c]">Dashboard</Link>
          <span className="mx-2">/</span>
          <span className="text-[#214b35]">Order #{order.id}</span>
        </nav>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[#6a796e]">
            Placed {formatDateTimeManila(order.createdAt)} · {peso(order.totalCents)}
          </p>
          <span className={`status-pill status-${order.status}`}>{order.status.replaceAll("_", " ")}</span>
        </div>

        <section className="agri-card p-5 sm:p-6">
          <h2 className="font-display text-2xl font-bold text-[#264f37]">Who</h2>
          <p className="mt-1 text-sm text-[#6a796e]">Buyer, seller, cooperative, and delivery or pickup address.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-[#f2f6ef] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Buyer</p>
              <p className="mt-1 font-bold text-[#315640]">{buyer?.name || "Buyer"}</p>
              <p className="mt-1 text-sm text-[#65766b]">{buyer?.email || "No email on file"}</p>
              <p className="text-sm text-[#65766b]">{buyer?.contactNumber || buyer?.phone || "No phone on file"}</p>
            </div>
            <div className="rounded-xl bg-[#f2f6ef] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Seller</p>
              <p className="mt-1 font-bold text-[#315640]">{seller?.name || "Farm seller"}</p>
              <p className="mt-1 text-sm text-[#65766b]">{seller?.email || "No email on file"}</p>
              <p className="text-sm text-[#65766b]">{seller?.contactNumber || seller?.phone || "No phone on file"}</p>
            </div>
            <div className="rounded-xl bg-[#f2f6ef] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Cooperative</p>
              <p className="mt-1 font-bold text-[#315640]">{cooperative?.name || "Individual / unassigned"}</p>
              <p className="mt-1 text-sm text-[#65766b]">{cooperative?.location || "Location not listed"}</p>
            </div>
            <div className="rounded-xl bg-[#f2f6ef] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Address</p>
              <p className="mt-1 text-sm leading-6 text-[#45614e]">
                {buyer?.address || seller?.address || "No address on file for this order."}
              </p>
            </div>
          </div>
        </section>

        <section className="mt-8 agri-card p-5 sm:p-6">
          <h2 className="font-display text-2xl font-bold text-[#264f37]">What</h2>
          <p className="mt-1 text-sm text-[#6a796e]">Line items included in this order.</p>
          <ul className="mt-5 space-y-3">
            {items.map(row => {
              const name = row.productName || "Product";
              const image = resolveProductImageSrc(row.primaryImageUrl, name);
              return (
                <li key={row.item.id} className="flex gap-3 rounded-xl border border-[#e2e9dd] p-3">
                  <ProductImage
                    src={image}
                    alt={name}
                    productName={name}
                    width={96}
                    height={96}
                    className="h-20 w-20 shrink-0 rounded-lg object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[#315640]">{name}</p>
                    <p className="mt-1 text-sm text-[#6a796e]">
                      {row.item.quantity} {row.unit || "unit"} · {peso(row.item.unitPriceCents)} each
                    </p>
                    <p className="mt-1 font-display text-lg font-bold text-[#1d5639]">
                      {peso(row.item.unitPriceCents * row.item.quantity)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          {!items.length && <p className="py-6 text-center text-sm text-[#6d7d70]">No line items were recorded for this order.</p>}
          {order.buyerNote && (
            <p className="mt-4 rounded-xl bg-[#f2f6ef] p-3 text-sm text-[#45614e]">
              <span className="font-bold">Buyer note:</span> {order.buyerNote}
            </p>
          )}
        </section>

        <section className="mt-8 agri-card p-5 sm:p-6">
          <h2 className="font-display text-2xl font-bold text-[#264f37]">How</h2>
          <p className="mt-1 text-sm text-[#6a796e]">Fulfillment and payment for this order.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl bg-[#f2f6ef] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Fulfillment</p>
              <p className="mt-1 font-bold text-[#315640]">{fulfillmentLabel(fulfillment)}</p>
            </div>
            <div className="rounded-xl bg-[#f2f6ef] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Payment method</p>
              <p className="mt-1 font-bold text-[#315640]">{paymentMethodLabel(paymentMethod)}</p>
            </div>
            <div className="rounded-xl bg-[#f2f6ef] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Payment status</p>
              <p className="mt-1 font-bold text-[#315640]">{paymentStatusLabel(paymentStatus)}</p>
            </div>
          </div>
          {receiptUrl ? (
            <a href={receiptUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex text-sm font-bold text-[#397549] underline">
              View payment receipt
            </a>
          ) : (
            <p className="mt-4 text-sm text-[#6a796e]">No payment receipt is attached to this order yet.</p>
          )}
        </section>

        <section className="mt-8 agri-card p-5 sm:p-6">
          <h2 className="font-display text-2xl font-bold text-[#264f37]">When</h2>
          <p className="mt-1 text-sm text-[#6a796e]">Order placed and later status or payment updates.</p>
          <p className="mt-4 text-sm font-bold text-[#315640]">Placed {formatDateTimeManila(order.createdAt)}</p>
          <ol className="mt-4 space-y-3">
            {history.length ? history.map((row, index) => (
              <li key={row.id ?? `${historyLabel(row)}-${index}`} className="rounded-xl border border-[#e2e9dd] p-3">
                <p className="font-bold capitalize text-[#315640]">{historyLabel(row)}</p>
                <p className="mt-1 text-xs text-[#708074]">
                  {row.actorName || "System"} · {formatDateTimeManila(historyWhen(row))}
                </p>
                {row.note && (
                  <p className="mt-2 text-sm text-[#65766b]">{row.note}</p>
                )}
              </li>
            )) : (
              <li className="py-4 text-center text-sm text-[#6d7d70]">No timeline events have been recorded yet.</li>
            )}
          </ol>
        </section>

        <section className="mt-8 agri-card p-5 sm:p-6">
          <h2 className="font-display text-2xl font-bold text-[#264f37]">Actions</h2>
          <p className="mt-1 text-sm text-[#6a796e]">Actions available for your role on this order.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {showRecordCash && (
              <button
                type="button"
                className="agri-button min-h-11 text-sm"
                disabled={recordCashReceipt.isPending}
                onClick={() => recordCashReceipt.mutate({ orderId: order.id })}
              >
                {recordCashReceipt.isPending ? <Loader2 className="animate-spin" size={15} /> : null}
                Record cash received
              </button>
            )}
            {showReviewProof && proof?.id && (
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end">
                <label className="field-label min-w-56 flex-1">
                  Review note (required when rejecting)
                  <textarea
                    maxLength={600}
                    className="field-control min-h-16"
                    value={reviewNote}
                    onChange={event => setReviewNote(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="agri-button min-h-11 text-sm"
                  disabled={reviewProof.isPending}
                  onClick={() => reviewProof.mutate({
                    proofId: proof.id!,
                    decision: "verified",
                    reviewNote: reviewNote.trim() || undefined,
                  })}
                >
                  Verify payment
                </button>
                <button
                  type="button"
                  className="agri-ghost min-h-11 text-sm text-[#a34838]"
                  disabled={reviewProof.isPending || !reviewNote.trim()}
                  onClick={() => reviewProof.mutate({
                    proofId: proof.id!,
                    decision: "rejected",
                    reviewNote: reviewNote.trim(),
                  })}
                >
                  Reject proof
                </button>
              </div>
            )}
            {!showRecordCash && !showReviewProof && (
              <p className="text-sm text-[#6a796e]">
                {paymentStatusLabel(paymentStatus)}
                {!canRecordCash && !canReviewProof
                  ? " · Payment actions are not available in this build."
                  : " · No payment actions are available for your role right now."}
              </p>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
