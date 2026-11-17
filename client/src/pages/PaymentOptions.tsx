import { getAccountAccessRestriction } from "../../../shared/accountAccess";
import { useAuth } from "@/_core/hooks/useAuth";
import { shellContainerClass, WorkspaceHeader } from "@/components/AgriShell";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, ImagePlus, Loader2, Pencil, QrCode, Trash2, Upload, X } from "lucide-react";
import { ChangeEvent, FormEvent, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
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

type PaymentOptionDraft = {
  methodName: string;
  accountName: string;
  accountNumber: string;
  qrImageUrl: string | null;
  instructions: string;
  isActive: boolean;
  cooperativeId: number | null;
};

const blankDraft = (): PaymentOptionDraft => ({
  methodName: "",
  accountName: "",
  accountNumber: "",
  qrImageUrl: null,
  instructions: "",
  isActive: true,
  cooperativeId: null,
});

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
  const enabled = !loading && (user?.role === "admin" || user?.role === "superadmin");
  const {
    data: options,
    isLoading,
    isFetching,
    error: optionsError,
    refetch: refetchOptions,
  } = trpc.adminPayment.listOptions.useQuery(undefined, { enabled });
  const cooperativesQuery = trpc.cooperatives.list.useQuery(undefined, {
    enabled: !loading && user?.role === "superadmin",
  });
  const cooperatives = cooperativesQuery.data ?? [];
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
    return <main className="grid min-h-screen place-items-center bg-[#f8f5ee] p-4"><div className="agri-card max-w-md p-8 text-center"><h1 className="font-display text-2xl font-bold text-[#244e36]">Payment management is restricted</h1><p className="mt-3 text-sm leading-6 text-[#647568]">Only an approved Admin assigned to a cooperative or a SuperAdmin can manage payment options.</p><Link href="/dashboard" className="agri-button mt-6 inline-flex no-underline">Return to workspace</Link></div></main>;
  }
  const restriction = getAccountAccessRestriction(user);
  if (restriction) {
    return <main className="grid min-h-screen place-items-center bg-[#f8f5ee] p-4"><div className="agri-card max-w-md p-8 text-center"><h1 className="font-display text-2xl font-bold text-[#244e36]">Account access is restricted</h1><p className="mt-3 text-sm leading-6 text-[#647568]">Resolve your account approval or cooperative assignment before managing payment options.</p><Link href="/dashboard" className="agri-button mt-6 inline-flex no-underline">Return to workspace</Link></div></main>;
  }

  return <>
    <WorkspaceHeader title="Payment Options" description="Manage checkout instructions and QR images for your platform or cooperative."/>
    <main className={`${shellContainerClass} py-8`}>
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link href="/dashboard" className="agri-ghost text-sm no-underline"><ArrowLeft size={16}/> Return to dashboard</Link>
        <button className="agri-button text-sm" disabled={Boolean(optionsError)} onClick={() => { setCreating(value => !value); setDraft(blankDraft()); }}>
          {creating ? <X size={16}/> : <ImagePlus size={16}/>} {creating ? "Close form" : "Add payment option"}
        </button>
      </div>

      {creating && <form onSubmit={submitCreate} className="agri-card mb-6 grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
        <label className="field-label">Payment option name<input required maxLength={150} className="field-control" value={draft.methodName} onChange={event => setDraft({ ...draft, methodName: event.target.value })}/></label>
        <label className="field-label">Account name (optional)<input maxLength={150} className="field-control" value={draft.accountName} onChange={event => setDraft({ ...draft, accountName: event.target.value })}/></label>
        <label className="field-label">Account number or identifier<input maxLength={100} className="field-control" value={draft.accountNumber} onChange={event => setDraft({ ...draft, accountNumber: event.target.value })}/></label>
        <label className="field-label">Payment instructions<textarea maxLength={5000} className="field-control" value={draft.instructions} onChange={event => setDraft({ ...draft, instructions: event.target.value })}/></label>
        {user.role === "superadmin" && <div>
          <label className="field-label">Option scope<select className="field-control" value={draft.cooperativeId ?? ""} disabled={Boolean(draft.qrImageUrl) || cooperativesQuery.isLoading} onChange={event => setDraft(current => ({ ...current, cooperativeId: event.target.value ? Number(event.target.value) : null }))}><option value="">Platform-wide</option>{cooperatives.map(cooperative => <option key={cooperative.id} value={cooperative.id}>{cooperative.name}</option>)}</select></label>
          {cooperativesQuery.isLoading && <p className="mt-1 text-xs text-[#718074]">Loading cooperative scopes…</p>}
          {cooperativesQuery.error && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#a34838]"><span role="alert">Cooperative scopes could not be loaded: {cooperativesQuery.error.message}</span><button type="button" className="agri-ghost px-2 py-1" disabled={cooperativesQuery.isFetching} onClick={() => void cooperativesQuery.refetch()}>Retry</button></div>}
        </div>}
        <label className="field-label">QR image (JPEG, PNG, WebP; up to 3 MB)<input type="file" accept="image/jpeg,image/png,image/webp" className="field-control" onChange={event => void uploadImage(event, draft.cooperativeId, url => setDraft(current => ({ ...current, qrImageUrl: url })))}/></label>
        {draft.qrImageUrl && <div className="flex items-start gap-3"><img src={draft.qrImageUrl} alt="Payment QR preview" className="h-28 w-28 rounded-xl border border-[#dce4d6] object-contain"/><button type="button" className="agri-ghost text-xs" onClick={() => setDraft(current => ({ ...current, qrImageUrl: null }))}>Remove preview</button></div>}
        <label className="field-label flex items-center gap-2"><input type="checkbox" checked={draft.isActive} onChange={event => setDraft({ ...draft, isActive: event.target.checked })}/> Available at checkout</label>
        <div className="sm:col-span-2"><button className="agri-button" disabled={createOption.isPending || uploadQrImage.isPending || Boolean(optionsError)}>{createOption.isPending ? <Loader2 className="animate-spin" size={16}/> : <QrCode size={16}/>} Save payment option</button></div>
      </form>}

      {optionsError ? <div className="agri-card p-6 text-sm text-[#a34838]"><p role="alert">Payment options could not be loaded: {optionsError.message}</p><button type="button" className="agri-ghost mt-3 text-sm" disabled={isFetching} onClick={() => void refetchOptions()}>Retry</button></div> : isLoading ? <div className="grid min-h-40 place-items-center"><Loader2 className="animate-spin text-[#4e8257]"/></div> : (options?.length ?? 0) === 0
        ? <div className="agri-card p-8 text-center"><QrCode className="mx-auto text-[#8ba17c]" size={32}/><h2 className="mt-3 font-display text-xl font-bold text-[#315640]">No payment options yet</h2><p className="mt-2 text-sm text-[#6d7d70]">Add a method and optional QR image to make it available during buyer checkout.</p></div>
        : <div className="space-y-4">{options?.map(option => <article key={option.id} className="agri-card p-5 sm:p-6">
          {editing?.id === option.id ? <form onSubmit={submitUpdate} className="grid gap-4 sm:grid-cols-2">
            <label className="field-label">Payment option name<input required maxLength={150} className="field-control" value={editing.methodName} onChange={event => setEditing({ ...editing, methodName: event.target.value })}/></label>
            <label className="field-label">Account name (optional)<input maxLength={150} className="field-control" value={editing.accountName} onChange={event => setEditing({ ...editing, accountName: event.target.value })}/></label>
            <label className="field-label">Account number or identifier<input maxLength={100} className="field-control" value={editing.accountNumber} onChange={event => setEditing({ ...editing, accountNumber: event.target.value })}/></label>
            <label className="field-label">Payment instructions<textarea maxLength={5000} className="field-control" value={editing.instructions} onChange={event => setEditing({ ...editing, instructions: event.target.value })}/></label>
            <label className="field-label">Replace QR image<input type="file" accept="image/jpeg,image/png,image/webp" className="field-control" onChange={event => void uploadImage(event, option.cooperativeId, url => setEditing(current => current ? { ...current, qrImageUrl: url } : current))}/></label>
            {editing.qrImageUrl && <div className="flex items-start gap-3"><img src={editing.qrImageUrl} alt={`${editing.methodName} QR preview`} className="h-28 w-28 rounded-xl border border-[#dce4d6] object-contain"/><button type="button" className="agri-ghost text-xs" onClick={() => setEditing(current => current ? { ...current, qrImageUrl: null } : current)}>Remove QR</button></div>}
            <label className="field-label flex items-center gap-2"><input type="checkbox" checked={editing.isActive} onChange={event => setEditing({ ...editing, isActive: event.target.checked })}/> Available at checkout</label>
            <div className="flex gap-2 sm:col-span-2"><button className="agri-button text-sm" disabled={updateOption.isPending || uploadQrImage.isPending}><Upload size={15}/> Save changes</button><button type="button" className="agri-ghost text-sm" onClick={() => setEditing(null)}>Cancel</button></div>
          </form> : <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {option.qrImageUrl ? <img src={option.qrImageUrl} alt={`${option.methodName} QR code`} className="h-28 w-28 rounded-xl border border-[#dce4d6] object-contain"/> : <div className="grid h-28 w-28 place-items-center rounded-xl bg-[#f0f5ed] text-[#82987a]"><QrCode size={34}/></div>}
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-xl font-bold text-[#264f37]">{option.methodName}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${option.isActive ? "bg-[#e6f3e5] text-[#397347]" : "bg-[#f3eee6] text-[#806b4e]"}`}>{option.isActive ? "Available" : "Inactive"}</span><span className="text-xs text-[#738174]">{option.cooperativeId === null ? "Platform-wide" : `Cooperative #${option.cooperativeId}`}</span></div><p className="mt-2 text-sm text-[#5d7062]">{option.accountName}{option.accountNumber ? ` · ${option.accountNumber}` : ""}</p>{option.instructions && <p className="mt-1 whitespace-pre-wrap text-sm text-[#6a796e]">{option.instructions}</p>}</div>
            <div className="flex gap-2"><button className="agri-ghost text-sm" onClick={() => setEditing({ id: option.id, methodName: option.methodName, accountName: option.accountName ?? "", accountNumber: option.accountNumber ?? "", qrImageUrl: option.qrImageUrl, instructions: option.instructions ?? "", isActive: option.isActive, cooperativeId: option.cooperativeId })}><Pencil size={15}/> Edit</button><button className="agri-ghost text-sm text-[#a34838]" disabled={deleteOption.isPending} onClick={() => setDeleteTarget({ id: option.id, methodName: option.methodName })}><Trash2 size={15}/> Delete</button></div>
          </div>}
        </article>)}</div>}
    </main>
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
