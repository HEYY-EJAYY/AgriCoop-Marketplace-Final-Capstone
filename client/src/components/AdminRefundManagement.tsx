import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { completedRefundAmountCents, reservedRefundAmountCents } from "../../../shared/paymentRefunds";
import { formatEnumLabel } from "@shared/enumLabels";
import { paymentMethodLabel } from "@shared/paymentMethods";

function peso(cents: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);
}

export default function AdminRefundManagement() {
  const utils = trpc.useUtils();
  const { data: queue = [], isLoading, isFetching, error, refetch } = trpc.payments.refundQueue.useQuery();
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [confirmationReferences, setConfirmationReferences] = useState<Record<string, string>>({});
  const [idempotencyKeys, setIdempotencyKeys] = useState<Record<number, string>>({});
  const recordRefund = trpc.payments.recordRefund.useMutation({
    onSuccess: async (_data, variables) => {
      toast.success("Refund recorded. It is not marked completed.");
      setAmounts({});
      setReasons({});
      setIdempotencyKeys(current => {
        const next = { ...current };
        delete next[variables.paymentId];
        return next;
      });
      await utils.payments.refundQueue.invalidate();
    },
    onError: mutationError => toast.error(mutationError.message),
  });
  const updateRefundStatus = trpc.payments.updateRefundStatus.useMutation({
    onSuccess: async () => {
      toast.success("Refund status updated.");
      await Promise.all([
        utils.payments.refundQueue.invalidate(),
        utils.payments.mine.invalidate(),
        utils.admin.overview.invalidate(),
      ]);
    },
    onError: mutationError => toast.error(mutationError.message),
  });

  const submitRefund = (paymentId: number) => {
    const rawAmount = amounts[paymentId] ?? "";
    if (!/^\d+(?:\.\d{1,2})?$/.test(rawAmount)) {
      toast.error("Enter a refund amount with no more than two decimal places.");
      return;
    }
    const amountCents = Math.round(Number(rawAmount) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      toast.error("Enter a valid refund amount.");
      return;
    }
    const reason = reasons[paymentId]?.trim();
    if (!reason) {
      toast.error("Enter a reason for the refund.");
      return;
    }
    const refundId = idempotencyKeys[paymentId] ?? crypto.randomUUID();
    setIdempotencyKeys(current => ({ ...current, [paymentId]: refundId }));
    recordRefund.mutate({ paymentId, refundId, amountCents, reason });
  };

  return <section className="mt-8 agri-card p-5 sm:p-6">
    <h2 className="font-display text-2xl font-bold text-[#264f37]">Refund management</h2>
    <p className="mt-1 text-sm leading-6 text-[#6a796e]">
      A refund is recorded first, then marked pending while it is processed. This app does not initiate or verify external refunds; mark one completed only after the money is actually returned and enter its confirmation reference.
    </p>
    {error ? <div className="mt-4 text-sm text-[#a34838]"><p role="alert">{error.message}</p><button type="button" className="agri-ghost mt-2 text-xs" disabled={isFetching} onClick={() => void refetch()}>Retry</button></div> : isLoading ? <Loader2 className="mx-auto my-6 animate-spin text-[#5d8a5e]"/> : queue.length ? <div className="mt-5 space-y-4">
      {queue.map(({ payment, refunds }) => {
        const reserved = reservedRefundAmountCents(refunds);
        const completed = completedRefundAmountCents(refunds);
        const refundable = Math.max(0, Number(payment.amountCents) - reserved);
        return <article key={payment.id} className="rounded-xl border border-[#e3e9de] p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-bold text-[#315640]">Order #{payment.orderId} · Payment #{payment.id}</p>
              <p className="mt-1 text-xs text-[#6d7d70]">{paymentMethodLabel(payment.paymentMethod)} · Verified amount {peso(Number(payment.amountCents))}</p>
              <p className="mt-1 text-xs text-[#6d7d70]">Refunded {peso(completed)} · Remaining refundable {peso(refundable)}</p>
            </div>
            <span className="rounded-full bg-[#edf3e9] px-3 py-1 text-xs font-bold text-[#315640]">{formatEnumLabel(payment.status)}</span>
          </div>
          {refunds.length > 0 && <div className="mt-4 space-y-3">
            {refunds.map(refund => <div key={refund.refundId} className="rounded-lg bg-[#f7faf4] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-[#315640]">{peso(refund.amountCents)} · {formatEnumLabel(refund.status)}</p>
                  <p className="mt-1 text-xs text-[#6d7d70]">{refund.reason}</p>
                  {refund.confirmationReference && <p className="mt-1 text-xs text-[#6d7d70]">Confirmation: {refund.confirmationReference}</p>}
                </div>
                {refund.status !== "completed" && refund.status !== "cancelled" && <div className="flex flex-wrap gap-2">
                  {refund.status === "recorded" && <button type="button" className="agri-ghost px-3 py-2 text-xs" disabled={updateRefundStatus.isPending} onClick={() => updateRefundStatus.mutate({ paymentId: payment.id, refundId: refund.refundId, status: "pending" })}>Mark pending</button>}
                  {refund.status === "pending" && <div className="flex flex-wrap items-end gap-2">
                    <label className="field-label mt-0">Actual refund confirmation<input className="field-control" maxLength={160} value={confirmationReferences[refund.refundId] ?? ""} onChange={event => setConfirmationReferences(current => ({ ...current, [refund.refundId]: event.target.value }))} placeholder="Bank/GCash reference"/></label>
                    <button type="button" className="agri-button px-3 py-2 text-xs" disabled={updateRefundStatus.isPending || !confirmationReferences[refund.refundId]?.trim()} onClick={() => updateRefundStatus.mutate({ paymentId: payment.id, refundId: refund.refundId, status: "completed", confirmationReference: confirmationReferences[refund.refundId]?.trim() })}>Confirm completed</button>
                  </div>}
                  <button type="button" className="agri-ghost px-3 py-2 text-xs text-[#a34838]" disabled={updateRefundStatus.isPending} onClick={() => updateRefundStatus.mutate({ paymentId: payment.id, refundId: refund.refundId, status: "cancelled" })}>Cancel request</button>
                </div>}
              </div>
            </div>)}
          </div>}
          {payment.status === "verified" && refundable > 0 && <form className="mt-4 grid gap-3 border-t border-[#e3e9de] pt-4 sm:grid-cols-[180px_1fr_auto]" onSubmit={event => { event.preventDefault(); submitRefund(payment.id); }}>
            <label className="field-label">Refund amount (PHP)<input required type="number" min="0.01" max={(refundable / 100).toFixed(2)} step="0.01" className="field-control" value={amounts[payment.id] ?? ""} onChange={event => setAmounts(current => ({ ...current, [payment.id]: event.target.value }))}/></label>
            <label className="field-label">Reason<input required maxLength={600} className="field-control" value={reasons[payment.id] ?? ""} onChange={event => setReasons(current => ({ ...current, [payment.id]: event.target.value }))}/></label>
            <button className="agri-ghost self-end text-sm" disabled={recordRefund.isPending}>Record refund</button>
          </form>}
        </article>;
      })}
    </div> : <p className="py-6 text-center text-sm text-[#6d7d70]">No verified payments are available for refund management.</p>}
  </section>;
}
