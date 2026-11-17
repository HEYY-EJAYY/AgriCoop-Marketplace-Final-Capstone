import { shellContainerClass, WorkspaceHeader } from "@/components/AgriShell";
import { useAuth } from "@/_core/hooks/useAuth";
import { blobToBase64, prepareProfileImage } from "@/lib/profileImage";
import { roleDisplayLabel } from "@/lib/roleLabels";
import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";
import { MAX_PRODUCT_IMAGE_SIZE_BYTES } from "@shared/productOptions";
import { Loader2, QrCode } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
type SellerOnlinePaymentState = {
  qrImageUrl?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
  label?: string | null;
};

type SellerOnlinePaymentQuery = {
  useQuery: (
    input?: undefined,
    opts?: { enabled?: boolean },
  ) => { data?: SellerOnlinePaymentState; isLoading: boolean; refetch: () => unknown };
};

type SellerQrUploadMutation = {
  useMutation: () => {
    mutateAsync: (input: {
      fileName: string;
      contentType: "image/jpeg" | "image/png" | "image/webp";
      base64: string;
    }) => Promise<{ qrImageUrl?: string; url?: string }>;
    isPending: boolean;
  };
};

type SellerPaymentDetailsMutation = {
  useMutation: () => {
    mutateAsync: (input: {
      accountName?: string;
      accountNumber?: string;
      label?: string;
    }) => Promise<unknown>;
    isPending: boolean;
  };
};

function readImageAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the selected QR image."));
    reader.readAsDataURL(file);
  });
}

export default function Profile() {
  const { user, loading, refresh } = useAuth();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [address, setAddress] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const updateProfile = trpc.account.updateProfile.useMutation();
  const uploadPhoto = trpc.account.uploadProfileImage.useMutation();
  const sellerRole = user?.role === "seller" || user?.role === "admin" || user?.role === "superadmin";
  const onlinePaymentQuery = trpc.sellers.getOnlinePayment.useQuery(undefined, {
    enabled: Boolean(user && sellerRole),
  });
  const uploadSellerQr = trpc.sellers.uploadOnlinePaymentQr.useMutation();
  const saveSellerPayment = trpc.sellers.saveOnlinePaymentDetails.useMutation();
  const canUploadSellerQr = true;
  const canSaveSellerPayment = true;
  const [paymentAccountName, setPaymentAccountName] = useState("");
  const [paymentAccountNumber, setPaymentAccountNumber] = useState("");
  const [paymentLabel, setPaymentLabel] = useState("");
  const qrPreview = useMemo(
    () => onlinePaymentQuery.data?.qrImageUrl ?? null,
    [onlinePaymentQuery.data?.qrImageUrl],
  );

  useEffect(() => {
    if (!onlinePaymentQuery.data) return;
    setPaymentAccountName(onlinePaymentQuery.data.accountName ?? "");
    setPaymentAccountNumber(onlinePaymentQuery.data.accountNumber ?? "");
    setPaymentLabel(onlinePaymentQuery.data.label ?? "");
  }, [onlinePaymentQuery.data]);

  useEffect(() => {
    if (!user) return;
    setName(user.name ?? "");
    setContactNumber(user.contactNumber ?? "");
    setAddress(user.address ?? "");
    setPreview(user.profileImageUrl ?? null);
  }, [user]);

  if (loading) return <div className="grid min-h-screen place-items-center bg-[#f8f5ee]"><Loader2 className="animate-spin text-[#4e8257]" /></div>;
  if (!user) {
    return (
      <>
        <WorkspaceHeader title="My Profile" description="Sign in to manage your AgriCoop profile." />
        <main className={`${shellContainerClass} py-10`}><div className="agri-card p-8 text-center"><h1 className="font-display text-3xl font-bold text-[#254f37]">Sign in required</h1></div></main>
      </>
    );
  }

  const onPickPhoto = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    let localPreview: string | null = null;
    try {
      const prepared = await prepareProfileImage(file);
      localPreview = prepared.previewUrl;
      setPreview(prepared.previewUrl);
      const base64 = await blobToBase64(prepared.blob);
      const result = await uploadPhoto.mutateAsync({
        fileName: prepared.fileName,
        contentType: prepared.contentType,
        base64,
      });
      setPreview(result.url);
      await utils.auth.me.invalidate();
      await refresh();
      toast.success("Profile photo updated.");
    } catch (error) {
      setPreview(user.profileImageUrl ?? null);
      toast.error(toUserFacingErrorMessage(error instanceof Error ? error.message : "Upload failed."));
    } finally {
      if (localPreview) URL.revokeObjectURL(localPreview);
      setBusy(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await updateProfile.mutateAsync({
        name: name.trim(),
        contactNumber: contactNumber.trim() || undefined,
        address: address.trim() || undefined,
      });
      if (password) {
        if (password.length < 8) throw new Error("Password must be at least 8 characters.");
        if (password !== confirmPassword) throw new Error("Password confirmation does not match.");
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setPassword("");
        setConfirmPassword("");
      }
      await utils.auth.me.invalidate();
      await refresh();
      toast.success("Profile saved.");
    } catch (error) {
      toast.error(toUserFacingErrorMessage(error instanceof Error ? error.message : "Could not save profile."));
    } finally {
      setBusy(false);
    }
  };

  const uploadQr = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !canUploadSellerQr) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Choose a JPEG, PNG, or WebP QR image.");
      return;
    }
    if (file.size > MAX_PRODUCT_IMAGE_SIZE_BYTES) {
      toast.error("QR images must be 3 MB or less.");
      return;
    }
    setBusy(true);
    try {
      const base64 = await readImageAsBase64(file);
      const result = await uploadSellerQr.mutateAsync({
        fileName: file.name,
        contentType: file.type as "image/jpeg" | "image/png" | "image/webp",
        base64,
      });
      if (result.url) toast.success("Online payment QR updated.");
      await onlinePaymentQuery.refetch();
    } catch (error) {
      toast.error(toUserFacingErrorMessage(error instanceof Error ? error.message : "QR upload failed."));
    } finally {
      setBusy(false);
    }
  };

  const saveOnlinePayment = async () => {
    if (!canSaveSellerPayment) {
      toast.error("Saving online payment details is not available yet.");
      return;
    }
    setBusy(true);
    try {
      await saveSellerPayment.mutateAsync({
        accountName: paymentAccountName.trim() || undefined,
        accountNumber: paymentAccountNumber.trim() || undefined,
        label: paymentLabel.trim() || undefined,
      });
      await onlinePaymentQuery.refetch();
      toast.success("Online payment details saved.");
    } catch (error) {
      toast.error(toUserFacingErrorMessage(error instanceof Error ? error.message : "Could not save payment details."));
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = async () => {
    setBusy(true);
    try {
      await updateProfile.mutateAsync({ profileImageUrl: null });
      setPreview(null);
      await utils.auth.me.invalidate();
      await refresh();
      toast.success("Profile photo removed.");
    } catch (error) {
      toast.error(toUserFacingErrorMessage(error instanceof Error ? error.message : "Could not remove photo."));
    } finally {
      setBusy(false);
    }
  };

  const initials = (name.trim().charAt(0) || "?").toUpperCase();

  return (
    <>
      <WorkspaceHeader title="My Profile" description="Update the details that appear in your account menu and message threads." />
      <main className={`${shellContainerClass} pb-28 pt-8`}>
        <form id="profile-form" onSubmit={onSubmit} className="agri-card mx-auto max-w-3xl p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-2xl bg-[#e8f0e4] text-2xl font-bold text-[#1f5a3c]" data-testid="profile-avatar">
              {preview ? (
                <img
                  src={preview}
                  alt=""
                  width={96}
                  height={96}
                  className="h-full w-full object-cover"
                  onError={() => setPreview(null)}
                />
              ) : (
                initials
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="agri-ghost min-h-11 cursor-pointer px-4 text-sm">
                Upload photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  data-testid="profile-photo-input"
                  disabled={busy}
                  onChange={e => void onPickPhoto(e.target.files?.[0] ?? null)}
                />
              </label>
              {preview && (
                <button type="button" className="agri-ghost min-h-11 text-sm text-[#a34838]" disabled={busy} onClick={() => void removePhoto()}>
                  Remove
                </button>
              )}
            </div>
          </div>

          <label className="field-label mt-6">Email<input className="field-control" value={user.email ?? ""} readOnly disabled /></label>
          <label className="field-label mt-4">Role<input className="field-control" value={roleDisplayLabel(user.role)} readOnly disabled /></label>
          <label className="field-label mt-4">Display name<input required maxLength={120} className="field-control" value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="field-label mt-4">Contact number<input maxLength={40} className="field-control" value={contactNumber} onChange={e => setContactNumber(e.target.value)} placeholder="09XX XXX XXXX" /></label>
          <label className="field-label mt-4">Address<textarea maxLength={500} className="field-control min-h-24" value={address} onChange={e => setAddress(e.target.value)} placeholder={user.role === "seller" ? "Business or pickup address" : "Delivery address"} /></label>

          {sellerRole && (
            <section className="mt-8 rounded-2xl border border-[#e2e9dd] bg-[#f7faf4] p-5">
              <h2 className="font-display text-xl font-bold text-[#264f37]">Online payment (seller)</h2>
              <p className="mt-1 text-sm text-[#6a796e]">
                Upload your QR and account details so buyers can pay online at checkout.
              </p>
              <div className="mt-4 flex flex-wrap items-start gap-4">
                {qrPreview ? (
                  <img src={qrPreview} alt="Your payment QR" className="h-28 w-28 rounded-xl border border-[#e2e9dd] object-contain" />
                ) : (
                  <div className="grid h-28 w-28 place-items-center rounded-xl bg-[#edf3e9] text-[#82987a]">
                    <QrCode />
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <label className="agri-ghost min-h-11 cursor-pointer px-4 text-sm">
                    Upload QR image
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={busy || !canUploadSellerQr}
                      onChange={e => void uploadQr(e)}
                    />
                  </label>
                </div>
              </div>
              <label className="field-label mt-4">
                Account name
                <input
                  className="field-control"
                  maxLength={150}
                  value={paymentAccountName}
                  onChange={e => setPaymentAccountName(e.target.value)}
                  disabled={!canSaveSellerPayment}
                />
              </label>
              <label className="field-label mt-3">
                Account number
                <input
                  className="field-control"
                  maxLength={100}
                  value={paymentAccountNumber}
                  onChange={e => setPaymentAccountNumber(e.target.value)}
                  disabled={!canSaveSellerPayment}
                />
              </label>
              <label className="field-label mt-3">
                Label (e.g. GCash, Maya)
                <input
                  className="field-control"
                  maxLength={150}
                  value={paymentLabel}
                  onChange={e => setPaymentLabel(e.target.value)}
                  disabled={!canSaveSellerPayment}
                />
              </label>
              {canSaveSellerPayment && (
                <button type="button" className="agri-button mt-4 text-sm" disabled={busy} onClick={() => void saveOnlinePayment()}>
                  {busy ? <Loader2 className="animate-spin" size={16} /> : null} Save payment details
                </button>
              )}
              <p className="mt-3 text-xs text-[#66766b]">
                After your QR is saved, enable <strong>Accepts Online Payment</strong> on each listing in your farmer
                workspace.
              </p>
            </section>
          )}

          <h2 className="mt-8 font-display text-xl font-bold text-[#264f37]">Change password</h2>
          <p className="mt-1 text-sm text-[#6a796e]">Leave blank to keep your current password.</p>
          <label className="field-label mt-4">New password<input type="password" minLength={8} className="field-control" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" /></label>
          <label className="field-label mt-4">Confirm new password<input type="password" minLength={8} className="field-control" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" /></label>
        </form>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#dce4d6] bg-[#fffdf8] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:pb-3">
        <div className={`${shellContainerClass} flex max-w-3xl justify-end gap-2`}>
          <button type="button" className="agri-ghost min-h-11" onClick={() => window.history.back()}>Cancel</button>
          <button type="submit" form="profile-form" className="agri-button min-h-11" disabled={busy}>{busy ? <Loader2 className="animate-spin" size={16} /> : null} Save</button>
        </div>
      </div>
    </>
  );
}
