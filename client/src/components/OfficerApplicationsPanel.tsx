import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type Category = { id: string; label: string; kind: "requests" | "cooperative"; cooperativeId?: number };

export function OfficerApplicationsPanel() {
  const utils = trpc.useUtils();
  const pending = trpc.officerApplications.pendingList.useQuery();
  const overview = trpc.admin.overview.useQuery();
  const review = trpc.officerApplications.review.useMutation({
    onSuccess: () => {
      toast.success("Application review saved.");
      void utils.officerApplications.pendingList.invalidate();
      void utils.admin.overview.invalidate();
      void utils.notifications.pendingCounts.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const updateUser = trpc.admin.updateUser.useMutation({
    onSuccess: () => {
      toast.success("Officer account updated.");
      void utils.admin.overview.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const deleteUser = trpc.admin.deleteUser.useMutation({
    onSuccess: () => {
      toast.success("Officer account permanently deleted.");
      void utils.admin.overview.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });

  const cooperatives = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of overview.data?.cooperatives ?? []) {
      if (!row.deletedAt) map.set(row.id, row.name);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [overview.data]);

  const categories = useMemo<Category[]>(() => [
    { id: "requests", label: "Approval Requests", kind: "requests" },
    ...cooperatives.map(([id, name]) => ({ id: `coop-${id}`, label: name, kind: "cooperative" as const, cooperativeId: id })),
  ], [cooperatives]);

  const [activeCategory, setActiveCategory] = useState("requests");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState<
    | { kind: "bulk" }
    | { kind: "user"; id: number; name: string }
    | null
  >(null);

  const requests = pending.data ?? [];
  const officers = (overview.data?.users ?? []).filter(row => row.user.role === "admin");
  const active = categories.find(c => c.id === activeCategory) ?? categories[0];
  const visibleRequests = active.kind === "requests" ? requests : [];
  const visibleOfficers = active.kind === "cooperative"
    ? officers.filter(row => row.user.cooperativeId === active.cooperativeId && !row.user.deletedAt)
    : [];
  const visibleKeys = [
    ...visibleRequests.map(r => `app-${r.id}`),
    ...visibleOfficers.map(r => `user-${r.user.id}`),
  ];
  const allSelected = visibleKeys.length > 0 && visibleKeys.every(k => selected.has(k));

  const toggle = (key: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visibleKeys));

  const runBulk = async (fn: (key: string) => Promise<unknown>) => {
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    for (const key of Array.from(selected)) {
      try { await fn(key); ok += 1; } catch { failed += 1; }
    }
    setBulkBusy(false);
    setSelected(new Set());
    if (failed) toast.error(`${ok} succeeded, ${failed} failed. Review each record for details.`);
    else toast.success(`${ok} record${ok === 1 ? "" : "s"} updated.`);
  };

  const bulkApprove = () => runBulk(async key => {
    const id = Number(key.replace("app-", ""));
    await review.mutateAsync({ applicationId: id, decision: "approved" });
  });
  const bulkDelete = () => setDeleteRequest({ kind: "bulk" });
  const confirmDelete = () => {
    if (!deleteRequest) return;
    if (deleteRequest.kind === "bulk") {
      setDeleteRequest(null);
      void runBulk(async key => {
        if (!key.startsWith("user-")) throw new Error("not a user");
        await deleteUser.mutateAsync({ userId: Number(key.slice(5)), confirm: true });
      });
      return;
    }
    const target = deleteRequest;
    setDeleteRequest(null);
    deleteUser.mutate({ userId: target.id, confirm: true });
  };
  const bulkSuspend = () => runBulk(async key => {
    if (!key.startsWith("user-")) throw new Error("not a user");
    const id = Number(key.slice(5));
    const target = officers.find(r => r.user.id === id);
    if (!target) throw new Error("unknown user");
    await updateUser.mutateAsync({ userId: id, role: target.user.role, approvalStatus: "suspended", cooperativeId: target.user.cooperativeId });
  });

  const openDoc = async (applicationId: number, kind: "id" | "proof") => {
    try {
      const { url } = await utils.officerApplications.documentUrl.fetch({ applicationId, kind });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(toUserFacingErrorMessage(error instanceof Error ? error.message : "Could not open document."));
    }
  };

  if (pending.isLoading || overview.isLoading) {
    return <div className="agri-card grid min-h-40 place-items-center"><Loader2 className="animate-spin text-[#4e8257]" /></div>;
  }

  return (
    <section className="agri-card overflow-hidden" data-testid="admin-applications-content">
      <div className="border-b border-[#e3e9de] p-5 sm:p-6">
        <h2 className="font-display text-2xl font-bold text-[#264f37]">OfficerAdmin Management</h2>
        <p className="mt-1 text-sm text-[#6a796e]">Review OfficerAdmin applications and manage approved officers by cooperative.</p>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-[#e3e9de] bg-[#f7faf5] px-5 py-3" role="tablist" aria-label="OfficerAdmin categories">
        {categories.map(category => (
          <button
            key={category.id}
            type="button"
            role="tab"
            aria-selected={activeCategory === category.id}
            className={`agri-ghost px-3 py-1.5 text-xs ${activeCategory === category.id ? "bg-[#edf3e9]" : ""}`}
            onClick={() => { setActiveCategory(category.id); setSelected(new Set()); }}
          >
            {category.label}
            {category.kind === "requests" && requests.length ? ` (${requests.length})` : ""}
          </button>
        ))}
      </div>
      {visibleKeys.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-[#edf0e9] bg-[#fbfdf9] px-5 py-2 text-xs text-[#4c5f52]">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
            Select all
          </label>
          {selected.size > 0 && (
            <>
              <span>{selected.size} selected</span>
              {active.kind === "requests" && (
                <button type="button" className="font-semibold text-[#1f5a3c] hover:underline disabled:opacity-50" disabled={bulkBusy || review.isPending} onClick={() => void bulkApprove()}>Bulk approve</button>
              )}
              {active.kind === "cooperative" && (
                <>
                  <button type="button" className="font-semibold text-[#1f5a3c] hover:underline disabled:opacity-50" disabled={bulkBusy} onClick={() => void bulkSuspend()}>Bulk suspend</button>
                  <button type="button" className="font-semibold text-[#a34838] hover:underline disabled:opacity-50" disabled={bulkBusy} onClick={bulkDelete}>Bulk delete</button>
                </>
              )}
            </>
          )}
        </div>
      )}
      <div className="space-y-4 p-5 sm:p-6">
        {active.kind === "requests" && visibleRequests.map(row => (
          <article key={row.id} className="flex gap-3 rounded-2xl border border-[#e2e9dd] p-4">
            <input type="checkbox" className="mt-1" checked={selected.has(`app-${row.id}`)} onChange={() => toggle(`app-${row.id}`)} aria-label={`Select ${row.fullName}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-bold text-[#315640]">{row.fullName}</p>
                  <p className="text-xs text-[#6d7d70]">{row.email} · {row.contactNumber ?? "no contact"} · {row.cooperativeName}</p>
                  <p className="mt-1 text-sm text-[#45614e]">{row.positionTitle}{row.idType ? ` · ${row.idType.replace(/_/g, " ")}` : ""}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="agri-ghost px-3 py-2 text-xs" onClick={() => void openDoc(row.id, "id")}>View ID</button>
                  {row.hasProofDocument && (
                    <button type="button" className="agri-ghost px-3 py-2 text-xs" onClick={() => void openDoc(row.id, "proof")}>View proof</button>
                  )}
                  <button type="button" className="agri-button px-3 py-2 text-xs" disabled={review.isPending} onClick={() => review.mutate({ applicationId: row.id, decision: "approved" })}>Approve</button>
                  <button type="button" className="agri-ghost px-3 py-2 text-xs text-[#a34838]" onClick={() => { setRejectingId(row.id); setReason(""); }}>Reject</button>
                </div>
              </div>
              {rejectingId === row.id && (
                <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); if (!reason.trim()) return; review.mutate({ applicationId: row.id, decision: "rejected", rejectionReason: reason.trim() }); setRejectingId(null); }}>
                  <label className="field-label">Rejection reason<textarea className="field-control min-h-20" required maxLength={600} value={reason} onChange={e => setReason(e.target.value)} /></label>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button type="button" className="agri-ghost px-3 py-2 text-xs" onClick={() => setRejectingId(null)}>Cancel</button>
                    <button className="agri-button px-3 py-2 text-xs" disabled={review.isPending || !reason.trim()}>Submit rejection</button>
                  </div>
                </form>
              )}
            </div>
          </article>
        ))}
        {active.kind === "requests" && !visibleRequests.length && <p className="py-6 text-center text-sm text-[#6d7d70]">No pending OfficerAdmin applications.</p>}
        {active.kind === "cooperative" && visibleOfficers.map(row => (
          <article key={row.user.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#e2e9dd] p-4">
            <input type="checkbox" checked={selected.has(`user-${row.user.id}`)} onChange={() => toggle(`user-${row.user.id}`)} aria-label={`Select ${row.user.name || row.user.email}`} />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-[#315640]">{row.user.name || "Unnamed"}{row.user.deletedAt ? " (deleted)" : ""}</p>
              <p className="text-xs text-[#6d7d70]">{row.user.email || "No email"} · {row.cooperativeName || "No cooperative"}</p>
            </div>
            <span className="rounded-full bg-[#eef5ea] px-2 py-1 text-xs font-bold text-[#4d784c]">{row.user.approvalStatus}</span>
            <div className="flex flex-wrap gap-2">
              {row.user.approvalStatus === "approved" && (
                <button type="button" className="agri-ghost px-3 py-2 text-xs" disabled={updateUser.isPending} onClick={() => updateUser.mutate({ userId: row.user.id, role: row.user.role, approvalStatus: "suspended", cooperativeId: row.user.cooperativeId })}>Suspend</button>
              )}
              {row.user.approvalStatus === "suspended" && (
                <button type="button" className="agri-ghost px-3 py-2 text-xs" disabled={updateUser.isPending} onClick={() => updateUser.mutate({ userId: row.user.id, role: row.user.role, approvalStatus: "approved", cooperativeId: row.user.cooperativeId })}>Reactivate</button>
              )}
              {!row.user.deletedAt && row.user.id !== undefined && (
                <button type="button" className="agri-ghost px-3 py-2 text-xs text-[#a34838]" disabled={deleteUser.isPending} onClick={() => setDeleteRequest({ kind: "user", id: row.user.id, name: row.user.name || row.user.email || "this OfficerAdmin" })}>Delete</button>
              )}
            </div>
          </article>
        ))}
        {active.kind === "cooperative" && !visibleOfficers.length && <p className="py-6 text-center text-sm text-[#6d7d70]">No OfficerAdmins are assigned to this cooperative.</p>}
      </div>
      <ConfirmDialog
        open={deleteRequest !== null}
        onOpenChange={open => { if (!open) setDeleteRequest(null); }}
        title={deleteRequest?.kind === "bulk" ? "Delete selected OfficerAdmins?" : "Delete OfficerAdmin account?"}
        description={deleteRequest?.kind === "bulk"
          ? `Permanently delete ${selected.size} selected OfficerAdmin account${selected.size === 1 ? "" : "s"}? This cannot be undone — their accounts and personal data will be removed.`
          : `Permanently delete ${deleteRequest?.kind === "user" ? deleteRequest.name : "this OfficerAdmin"}? This cannot be undone — their account and personal data will be removed.`}
        confirmLabel="Delete permanently"
        destructive
        pending={deleteUser.isPending || bulkBusy}
        onConfirm={confirmDelete}
      />
    </section>
  );
}
