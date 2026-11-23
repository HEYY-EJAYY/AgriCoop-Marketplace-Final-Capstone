import { getAccountAccessRestriction } from "../../../shared/accountAccess";
import { useAuth } from "@/_core/hooks/useAuth";
import { shellContainerClass } from "@/components/AgriShell";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, ImagePlus, Loader2, Pencil, QrCode, Trash2, Upload, X } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Link, useSearch } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MAX_PRODUCT_IMAGE_SIZE_BYTES } from "../../../shared/productOptions";
import { toUserFacingErrorMessage } from "../../../shared/userFacingErrors";
import {
  QR_ISSUE_REPORT_STATUSES,
  QR_PAYMENT_PROVIDERS,
  qrIssueReasonLabel,
  qrPaymentProviderLabel,
  type QrPaymentProvider,
} from "../../../shared/paymentMethods";

type PaymentOptionDraft = {
  paymentMethod: string;
  methodName: string;
  accountName: string;
  accountNumber: string;
  qrImageUrl: string | null;
  instructions: string;
  isActive: boolean;
  cooperativeId: number | null;
};

const blankDraft = (): PaymentOptionDraft => ({
  paymentMethod: "gcash",
  methodName: "",
  accountName: "",
  accountNumber: "",
  qrImageUrl: null,
  instructions: "",
  isActive: true,
  cooperativeId: null,
});

const REPORT_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  under_review: "Under review",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

function readImageAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the selected QR image."));
    reader.readAsDataURL(file);
  });
}

export default function PaymentOptions() {
  const { user, loading } = useAuth();
  const utils = trpc.useUtils();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const enabled = !loading && isAdmin;
  const search = useSearch();
  const [tab, setTab] = useState<"options" | "reports">("options");
  const [highlightReportId, setHighlightReportId] = useState<number | null>(null);
  const coopsQuery = trpc.cooperatives.listActive.useQuery(undefined, { enabled });
  const cooperativeNameById = new Map((coopsQuery.data ?? []).map(coop => [coop.id, coop.name]));
  const {
    data: reports,
    isLoading: reportsLoading,
    error: reportsError,
    refetch: refetchReports,
  } = trpc.adminPayment.listReports.useQuery(undefined, { enabled: enabled && tab === "reports" });
  const updateReport = trpc.adminPayment.updateReport.useMutation({
    onSuccess: () => {
      toast.success("Report updated.");
      void utils.adminPayment.listReports.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const [reportEdits, setReportEdits] = useState<Record<number, { status: string; adminNote: string }>>({});

  useEffect(() => {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    if (params.get("tab") === "reports") setTab("reports");
    const reportParam = Number(params.get("report"));
    if (Number.isInteger(reportParam) && reportParam > 0) setHighlightReportId(reportParam);
  }, [search]);

  useEffect(() => {
    if (tab !== "reports" || highlightReportId === null || !reports?.length) return;
    const target = document.getElementById(`qr-report-${highlightReportId}`);
    if (target) {
      target.scrollIntoView({ block: "center" });
      target.classList.add("ring-2", "ring-[#4e8257]");
    }
  }, [tab, highlightReportId, reports]);
  const {
    data: options,
    isLoading,
    isFetching,
    error: optionsError,
    refetch: refetchOptions,
  } = trpc.adminPayment.listOptions.useQuery(undefined, { enabled });
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<PaymentOptionDraft>(blankDraft);
  const [editing, setEditing] = useState<{ id: number } & PaymentOptionDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; methodName: string } | null>(null);

  const refresh = () => utils.adminPayment.listOptions.invalidate();
  const createOption = trpc.adminPayment.createOption.useMutation({
    onSuccess: () => {
      toast.success("Payment option created.");
      setCreating(false);
      setDraft(blankDraft());
      void refresh();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const updateOption = trpc.adminPayment.updateOption.useMutation({
    onSuccess: result => {
      toast.success(result.cleanupWarning
        ? "Payment option saved, but its previous QR image could not be removed from Storage."
        : "Payment option saved.");
      setEditing(null);
      void refresh();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const deleteOption = trpc.adminPayment.deleteOption.useMutation({
    onSuccess: result => {
      toast.success(result.cleanupWarning
        ? "Payment option deleted, but its QR image could not be removed from Storage."
        : "Payment option deleted.");
      setDeleteTarget(null);
      void refresh();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const uploadQrImage = trpc.adminPayment.uploadQrImage.useMutation({
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const uploadImage = async (
    event: ChangeEvent<HTMLInputElement>,
    cooperativeId: number | null,
    setUrl: (url: string) => void,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Choose a JPEG, PNG, or WebP QR image.");
      return;
    }
    if (file.size > MAX_PRODUCT_IMAGE_SIZE_BYTES) {
      toast.error("QR images must be 3 MB or less.");
      return;
    }
    try {
      const base64 = await readImageAsBase64(file);
      const result = await uploadQrImage.mutateAsync({
        cooperativeId,
        fileName: file.name,
        contentType: file.type as "image/jpeg" | "image/png" | "image/webp",
        base64,
      });
      setUrl(result.url);
      toast.success("QR image uploaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "QR image upload failed.");
    }
  };

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    createOption.mutate({
      cooperativeId: user?.role === "superadmin" ? draft.cooperativeId : undefined,
      paymentMethod: draft.paymentMethod as QrPaymentProvider,
      methodName: draft.methodName,
      accountName: draft.accountName,
      accountNumber: draft.accountNumber || undefined,
      qrImageUrl: draft.qrImageUrl,
      instructions: draft.instructions || undefined,
      isActive: draft.isActive,
    });
  };

  const submitUpdate = (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    updateOption.mutate({
      id: editing.id,
      paymentMethod: editing.paymentMethod as QrPaymentProvider,
      methodName: editing.methodName,
      accountName: editing.accountName,
      accountNumber: editing.accountNumber || null,
      qrImageUrl: editing.qrImageUrl,
      instructions: editing.instructions || null,
      isActive: editing.isActive,
    });
  };

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-[#f8f5ee]"><Loader2 className="animate-spin text-[#4e8257]"/></div>;
  }
  if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
    return <main className="grid min-h-screen place-items-center bg-[#f8f5ee] p-4"><div className="agri-card max-w-md p-8 text-center"><h1 className="font-display text-2xl font-bold text-[#244e36]">Payment management is restricted</h1><p className="mt-3 text-sm leading-6 text-[#647568]">Only an approved OfficerAdmin or SuperAdmin can manage payment options.</p><Link href="/dashboard" className="agri-button mt-6 inline-flex no-underline">Return to workspace</Link></div></main>;
  }
  const restriction = getAccountAccessRestriction(user);
  if (restriction) {
    return <main className="grid min-h-screen place-items-center bg-[#f8f5ee] p-4"><div className="agri-card max-w-md p-8 text-center"><h1 className="font-display text-2xl font-bold text-[#244e36]">Account access is restricted</h1><p className="mt-3 text-sm leading-6 text-[#647568]">Resolve your account approval or cooperative assignment before managing payment options.</p><Link href="/dashboard" className="agri-button mt-6 inline-flex no-underline">Return to workspace</Link></div></main>;
  }

  return <>
    <div className={shellContainerClass}>
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link href="/dashboard" className="agri-ghost text-sm no-underline"><ArrowLeft size={16}/> Return to dashboard</Link>
        <button className="agri-button text-sm" disabled={Boolean(optionsError) || tab !== "options"} onClick={() => { setCreating(value => !value); setDraft(blankDraft()); }}>
          {creating ? <X size={16}/> : <ImagePlus size={16}/>} {creating ? "Close form" : "Add payment option"}
        </button>
      </div>

      <div className="mb-6 flex gap-2" role="tablist" aria-label="Payment management sections">
        {([["options", "QR codes"], ["reports", "QR reports"]] as const).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={`rounded-full px-4 py-2 text-sm font-bold ${tab === value ? "bg-[#315640] text-white" : "border border-[#dfe6da] bg-white text-[#5d7062]"}`}
            onClick={() => setTab(value)}
          >{label}</button>
        ))}
      </div>

      {tab === "options" && creating && <form onSubmit={submitCreate} className="agri-card mb-6 grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
        <label className="field-label">Payment provider
          <select className="field-control" value={draft.paymentMethod} onChange={event => setDraft({ ...draft, paymentMethod: event.target.value })}>
            {QR_PAYMENT_PROVIDERS.map(provider => <option key={provider} value={provider}>{qrPaymentProviderLabel(provider)}</option>)}
          </select>
        </label>
        <label className="field-label">Payment option name<input required maxLength={150} className="field-control" value={draft.methodName} onChange={event => setDraft({ ...draft, methodName: event.target.value })}/></label>
        {user?.role === "superadmin" && <label className="field-label">Cooperative
          <select required className="field-control" value={draft.cooperativeId ?? ""} onChange={event => setDraft({ ...draft, cooperativeId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">Select a cooperative…</option>
            {(coopsQuery.data ?? []).map(coop => <option key={coop.id} value={coop.id}>{coop.name}</option>)}
          </select>
        </label>}
        <label className="field-label">Account name (optional)<input maxLength={150} className="field-control" value={draft.accountName} onChange={event => setDraft({ ...draft, accountName: event.target.value })}/></label>
        <label className="field-label">Account number or identifier<input maxLength={100} className="field-control" value={draft.accountNumber} onChange={event => setDraft({ ...draft, accountNumber: event.target.value })}/></label>
        <label className="field-label">Payment instructions<textarea maxLength={5000} className="field-control" value={draft.instructions} onChange={event => setDraft({ ...draft, instructions: event.target.value })}/></label>
        <label className="field-label">QR image (JPEG, PNG, WebP; up to 3 MB)<input type="file" accept="image/jpeg,image/png,image/webp" className="field-control" onChange={event => void uploadImage(event, user?.role === "superadmin" ? draft.cooperativeId : user?.cooperativeId ?? null, url => setDraft(current => ({ ...current, qrImageUrl: url })))}/></label>
        {draft.qrImageUrl && <div className="flex items-start gap-3"><img src={draft.qrImageUrl} alt="Payment QR preview" className="h-28 w-28 rounded-xl border border-[#dce4d6] object-contain"/><button type="button" className="agri-ghost text-xs" onClick={() => setDraft(current => ({ ...current, qrImageUrl: null }))}>Remove preview</button></div>}
        <label className="field-label flex items-center gap-2"><input type="checkbox" checked={draft.isActive} onChange={event => setDraft({ ...draft, isActive: event.target.checked })}/> Available at checkout</label>
        <div className="sm:col-span-2"><button className="agri-button" disabled={createOption.isPending || uploadQrImage.isPending || Boolean(optionsError)}>{createOption.isPending ? <Loader2 className="animate-spin" size={16}/> : <QrCode size={16}/>} Save payment option</button></div>
      </form>}

      {tab === "options" && (optionsError ? <div className="agri-card p-6 text-sm text-[#a34838]"><p role="alert">Payment options could not be loaded: {optionsError.message}</p><button type="button" className="agri-ghost mt-3 text-sm" disabled={isFetching} onClick={() => void refetchOptions()}>Retry</button></div> : isLoading ? <div className="grid min-h-40 place-items-center"><Loader2 className="animate-spin text-[#4e8257]"/></div> : (options?.length ?? 0) === 0
        ? <div className="agri-card p-8 text-center"><QrCode className="mx-auto text-[#8ba17c]" size={32}/><h2 className="mt-3 font-display text-xl font-bold text-[#315640]">No payment options yet</h2><p className="mt-2 text-sm text-[#6d7d70]">Add a method and optional QR image to make it available during buyer checkout.</p></div>
        : <div className="space-y-4">{options?.map(option => <article key={option.id} className="agri-card p-5 sm:p-6">
          {editing?.id === option.id ? <form onSubmit={submitUpdate} className="grid gap-4 sm:grid-cols-2">
            <label className="field-label">Payment provider
              <select className="field-control" value={editing.paymentMethod} onChange={event => setEditing({ ...editing, paymentMethod: event.target.value })}>
                {QR_PAYMENT_PROVIDERS.map(provider => <option key={provider} value={provider}>{qrPaymentProviderLabel(provider)}</option>)}
              </select>
            </label>
            <label className="field-label">Payment option name<input required maxLength={150} className="field-control" value={editing.methodName} onChange={event => setEditing({ ...editing, methodName: event.target.value })}/></label>
            <label className="field-label">Account name (optional)<input maxLength={150} className="field-control" value={editing.accountName} onChange={event => setEditing({ ...editing, accountName: event.target.value })}/></label>
            <label className="field-label">Account number or identifier<input maxLength={100} className="field-control" value={editing.accountNumber} onChange={event => setEditing({ ...editing, accountNumber: event.target.value })}/></label>
            <label className="field-label">Payment instructions<textarea maxLength={5000} className="field-control" value={editing.instructions} onChange={event => setEditing({ ...editing, instructions: event.target.value })}/></label>
            <label className="field-label">Replace QR image<input type="file" accept="image/jpeg,image/png,image/webp" className="field-control" onChange={event => void uploadImage(event, option.cooperativeId, url => setEditing(current => current ? { ...current, qrImageUrl: url } : current))}/></label>
            {editing.qrImageUrl && <div className="flex items-start gap-3"><img src={editing.qrImageUrl} alt={`${editing.methodName} QR preview`} className="h-28 w-28 rounded-xl border border-[#dce4d6] object-contain"/><button type="button" className="agri-ghost text-xs" onClick={() => setEditing(current => current ? { ...current, qrImageUrl: null } : current)}>Remove QR</button></div>}
            <label className="field-label flex items-center gap-2"><input type="checkbox" checked={editing.isActive} onChange={event => setEditing({ ...editing, isActive: event.target.checked })}/> Available at checkout</label>
            <p className="text-xs text-[#6a796e] sm:col-span-2">A buyer QR report automatically hides this option. Re-enable it here only after reviewing and fixing the problem.</p>
            <div className="flex gap-2 sm:col-span-2"><button className="agri-button text-sm" disabled={updateOption.isPending || uploadQrImage.isPending}><Upload size={15}/> Save changes</button><button type="button" className="agri-ghost text-sm" onClick={() => setEditing(null)}>Cancel</button></div>
          </form> : <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {option.qrImageUrl ? <img src={option.qrImageUrl} alt={`${option.methodName} QR code`} className="h-28 w-28 rounded-xl border border-[#dce4d6] object-contain"/> : <div className="grid h-28 w-28 place-items-center rounded-xl bg-[#f0f5ed] text-[#82987a]"><QrCode size={34}/></div>}
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-xl font-bold text-[#264f37]">{option.methodName}</h2><span className="rounded-full bg-[#e8f0e4] px-2.5 py-1 text-xs font-bold text-[#3d6b45]">{qrPaymentProviderLabel(option.paymentMethod)}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${option.isActive ? "bg-[#e6f3e5] text-[#397347]" : "bg-[#f3eee6] text-[#806b4e]"}`}>{option.isActive ? "Available" : "Inactive"}</span><span className="text-xs text-[#738174]">{option.cooperativeId === null ? "Unassigned — hidden from buyers" : cooperativeNameById.get(option.cooperativeId) ?? `Cooperative #${option.cooperativeId}`}</span></div><p className="mt-2 text-sm text-[#5d7062]">{option.accountName}{option.accountNumber ? ` · ${option.accountNumber}` : ""}</p>{option.instructions && <p className="mt-1 whitespace-pre-wrap text-sm text-[#6a796e]">{option.instructions}</p>}</div>
            <div className="flex gap-2"><button className="agri-ghost text-sm" onClick={() => setEditing({ id: option.id, paymentMethod: option.paymentMethod, methodName: option.methodName, accountName: option.accountName ?? "", accountNumber: option.accountNumber ?? "", qrImageUrl: option.qrImageUrl, instructions: option.instructions ?? "", isActive: option.isActive, cooperativeId: option.cooperativeId })}><Pencil size={15}/> Edit</button><button className="agri-ghost text-sm text-[#a34838]" disabled={deleteOption.isPending} onClick={() => setDeleteTarget({ id: option.id, methodName: option.methodName })}><Trash2 size={15}/> Delete</button></div>
          </div>}
        </article>)}</div>)}

      {tab === "reports" && (reportsError ? <div className="agri-card p-6 text-sm text-[#a34838]"><p role="alert">QR reports could not be loaded: {reportsError.message}</p><button type="button" className="agri-ghost mt-3 text-sm" onClick={() => void refetchReports()}>Retry</button></div> : reportsLoading ? <div className="grid min-h-40 place-items-center"><Loader2 className="animate-spin text-[#4e8257]"/></div> : (reports?.length ?? 0) === 0
        ? <div className="agri-card p-8 text-center"><QrCode className="mx-auto text-[#8ba17c]" size={32}/><h2 className="mt-3 font-display text-xl font-bold text-[#315640]">No QR reports</h2><p className="mt-2 text-sm text-[#6d7d70]">Buyer reports about QR codes that do not work will appear here.</p></div>
        : <div className="space-y-4">{reports?.map(row => {
          const report = row.report;
          const edit = reportEdits[report.id] ?? { status: report.status, adminNote: report.adminNote ?? "" };
          const dirty = edit.status !== report.status || edit.adminNote !== (report.adminNote ?? "");
          return <article key={report.id} id={`qr-report-${report.id}`} className="agri-card scroll-mt-24 p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {row.qrImageUrl ? <img src={row.qrImageUrl} alt={`${report.paymentOptionLabel} QR`} className="h-24 w-24 rounded-xl border border-[#dce4d6] object-contain"/> : <div className="grid h-24 w-24 place-items-center rounded-xl bg-[#f0f5ed] text-[#82987a]"><QrCode size={30}/></div>}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-lg font-bold text-[#264f37]">{report.paymentOptionLabel}</h2>
                  <span className="rounded-full bg-[#e8f0e4] px-2.5 py-1 text-xs font-bold text-[#3d6b45]">{qrPaymentProviderLabel(report.paymentProvider)}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${report.status === "pending" ? "bg-[#fdf0e0] text-[#8a5a1e]" : report.status === "under_review" ? "bg-[#e8eefb] text-[#3c5a94]" : report.status === "resolved" ? "bg-[#e6f3e5] text-[#397347]" : "bg-[#f0efec] text-[#6d6a60]"}`}>{REPORT_STATUS_LABELS[report.status] ?? report.status}</span>
                </div>
                <p className="mt-2 text-sm text-[#5d7062]">
                  {qrIssueReasonLabel(report.reason)}
                  {report.accountName ? ` · ${report.accountName}` : ""}
                  {report.accountNumber ? ` · ${report.accountNumber}` : ""}
                </p>
                {report.details && <p className="mt-1 whitespace-pre-wrap text-sm text-[#6a796e]">{report.details}</p>}
                <p className="mt-2 text-xs text-[#738174]">
                  Reported by {row.reporterName ?? row.reporterEmail ?? "a buyer"}
                  {row.cooperativeName ? ` · ${row.cooperativeName}` : " · Platform"}
                  {report.orderId ? ` · Order #${report.orderId}` : ""}
                  {` · ${new Date(report.createdAt).toLocaleString()}`}
                </p>
                {report.status !== "pending" && report.reviewedAt && (
                  <p className="mt-1 text-xs text-[#738174]">Reviewed {new Date(report.reviewedAt).toLocaleString()}</p>
                )}
                <p className="mt-1 text-xs font-semibold text-[#8a5a1e]">
                  This QR is hidden from buyer checkout until an admin re-enables it under the QR codes tab.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 border-t border-[#edf0e9] pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="field-label text-xs">Internal note<textarea maxLength={2000} className="field-control" value={edit.adminNote} onChange={event => setReportEdits(current => ({ ...current, [report.id]: { ...edit, adminNote: event.target.value } }))}/></label>
              <div className="flex flex-wrap items-center gap-2">
                <select className="field-control w-auto text-sm" value={edit.status} onChange={event => setReportEdits(current => ({ ...current, [report.id]: { ...edit, status: event.target.value } }))}>
                  {QR_ISSUE_REPORT_STATUSES.map(status => <option key={status} value={status}>{REPORT_STATUS_LABELS[status]}</option>)}
                </select>
                <button
                  type="button"
                  className="agri-button text-sm"
                  disabled={!dirty || updateReport.isPending}
                  onClick={() => updateReport.mutate({ id: report.id, status: edit.status as (typeof QR_ISSUE_REPORT_STATUSES)[number], adminNote: edit.adminNote.trim() || null })}
                >{updateReport.isPending ? <Loader2 className="animate-spin" size={15}/> : <Upload size={15}/>} Save review</button>
              </div>
            </div>
          </article>;
        })}</div>)}
    </div>
    <AlertDialog open={deleteTarget !== null} onOpenChange={open => {
      if (!open && !deleteOption.isPending) setDeleteTarget(null);
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete payment option?</AlertDialogTitle>
          <AlertDialogDescription>
            Delete {deleteTarget?.methodName ?? "this option"}? Existing order payment details will be preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteOption.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!deleteTarget || deleteOption.isPending}
            className="bg-[#a34838] text-white hover:bg-[#873c31]"
            onClick={() => {
              if (deleteTarget) deleteOption.mutate({ id: deleteTarget.id });
            }}
          >
            {deleteOption.isPending ? <Loader2 className="animate-spin" size={15}/> : <Trash2 size={15}/>} Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
