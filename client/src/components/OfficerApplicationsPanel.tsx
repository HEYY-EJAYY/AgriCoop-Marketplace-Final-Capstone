import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";

export function OfficerApplicationsPanel() {
  const utils = trpc.useUtils();
  const pending = trpc.officerApplications.pendingList.useQuery();
  const review = trpc.officerApplications.review.useMutation({
    onSuccess: () => {
      toast.success("Application review saved.");
      void utils.officerApplications.pendingList.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  const openDoc = async (applicationId: number, kind: "id" | "proof") => {
    try {
      const { url } = await utils.officerApplications.documentUrl.fetch({ applicationId, kind });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(toUserFacingErrorMessage(error instanceof Error ? error.message : "Could not open document."));
    }
  };

  if (pending.isLoading) {
    return <div className="agri-card grid min-h-40 place-items-center"><Loader2 className="animate-spin text-[#4e8257]" /></div>;
  }

  return (
    <section className="agri-card p-5 sm:p-6" data-testid="admin-applications-content">
      <h2 className="font-display text-2xl font-bold text-[#264f37]">Cooperative Admin applications</h2>
      <p className="mt-1 text-sm text-[#6a796e]">SuperAdmin only. Approve grants Officer Admin (Admin role). Reject requires a reason.</p>
      <div className="mt-5 space-y-4">
        {(pending.data ?? []).map(row => (
          <article key={row.id} className="rounded-2xl border border-[#e2e9dd] p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <p className="font-bold text-[#315640]">{row.fullName}</p>
                <p className="text-xs text-[#6d7d70]">{row.email} · {row.cooperativeName}</p>
                <p className="mt-1 text-sm text-[#45614e]">{row.positionTitle}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="agri-ghost px-3 py-2 text-xs" onClick={() => void openDoc(row.id, "id")}>View ID</button>
                <button type="button" className="agri-ghost px-3 py-2 text-xs" onClick={() => void openDoc(row.id, "proof")}>View proof</button>
                <button
                  type="button"
                  className="agri-button px-3 py-2 text-xs"
                  disabled={review.isPending}
                  onClick={() => review.mutate({ applicationId: row.id, decision: "approved" })}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="agri-ghost px-3 py-2 text-xs text-[#a34838]"
                  onClick={() => { setRejectingId(row.id); setReason(""); }}
                >
                  Reject
                </button>
              </div>
            </div>
            {rejectingId === row.id && (
              <form
                className="mt-4 space-y-3"
                onSubmit={event => {
                  event.preventDefault();
                  if (!reason.trim()) return;
                  review.mutate({ applicationId: row.id, decision: "rejected", rejectionReason: reason.trim() });
                  setRejectingId(null);
                }}
              >
                <label className="field-label">Rejection reason
                  <textarea className="field-control min-h-20" required maxLength={600} value={reason} onChange={e => setReason(e.target.value)} />
                </label>
                <div className="flex gap-2">
                  <button className="agri-button px-3 py-2 text-xs" disabled={review.isPending || !reason.trim()}>Submit rejection</button>
                  <button type="button" className="agri-ghost px-3 py-2 text-xs" onClick={() => setRejectingId(null)}>Cancel</button>
                </div>
              </form>
            )}
          </article>
        ))}
        {!pending.data?.length && <p className="py-6 text-center text-sm text-[#6d7d70]">No pending Cooperative Admin applications.</p>}
      </div>
    </section>
  );
}
