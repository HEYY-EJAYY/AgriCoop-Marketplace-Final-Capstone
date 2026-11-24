import { PageFrame, shellContainerClass, WorkspaceHeader } from "@/components/AgriShell";
import { CooperativeSelect, emptyCooperativeSelectValue, type CooperativeSelectValue } from "@/components/CooperativeSelect";
import { PasswordVisibilityInput } from "@/components/PasswordVisibilityInput";
import { useAuth } from "@/_core/hooks/useAuth";
import { blobToBase64, prepareProfileImage } from "@/lib/profileImage";
import { roleDisplayLabel } from "@/lib/roleLabels";
import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";
import { Loader2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

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
  const { data: cooperatives = [] } = trpc.cooperatives.list.useQuery(undefined, { enabled: !!user });
  const associationMine = trpc.cooperativeAssociations.mine.useQuery(undefined, {
    enabled: !!user && user.role === "seller",
  });
  const associationRequest = trpc.cooperativeAssociations.request.useMutation({
    onSuccess: () => {
      toast.success("Cooperative association request submitted.");
      setAssociationReason("");
      void associationMine.refetch();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const [sellerCoop, setSellerCoop] = useState<CooperativeSelectValue>(emptyCooperativeSelectValue);
  const [associationReason, setAssociationReason] = useState("");

  useEffect(() => {
    if (!user) return;
    setName(user.name ?? "");
    setContactNumber(user.contactNumber ?? "");
    setAddress(user.address ?? "");
    setPreview(user.profileImageUrl ?? null);
    setSellerCoop({
      ...emptyCooperativeSelectValue(),
      cooperativeId: user.cooperativeId ?? null,
    });
  }, [user]);

  const assignedCooperative = user?.cooperativeId
    ? cooperatives.find(row => row.id === user.cooperativeId)
    : undefined;
  const pendingAssociation = associationMine.data?.find(row => row.request.status === "pending");

  if (loading) {
    return (
      <PageFrame>
        <main className={`${shellContainerClass} grid min-h-[50vh] place-items-center py-16`}>
          <Loader2 className="animate-spin text-[#4e8257]" aria-label="Loading" />
        </main>
      </PageFrame>
    );
  }
  if (!user) {
    return (
      <PageFrame>
        <main className={`${shellContainerClass} py-10`}>
          <div className="agri-card p-5 sm:p-6 text-center">
            <h1 className="font-display text-3xl font-bold text-[#254f37]">Sign in required</h1>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link href="/auth" className="agri-ghost inline-flex min-h-11 items-center no-underline">Login</Link>
              <Link href="/auth?register=1" className="agri-button inline-flex min-h-11 items-center no-underline">Join AgriCoop</Link>
            </div>
          </div>
        </main>
      </PageFrame>
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
      {user.role !== "admin" && user.role !== "superadmin" && (
        <WorkspaceHeader title="My Profile" description="Update the details that appear in your account menu and message threads." />
      )}
      <main className={`${shellContainerClass} w-full pb-28 pt-8`}>
        <form id="profile-form" onSubmit={onSubmit} className="grid w-full gap-6 lg:grid-cols-2">
          <section className="agri-card w-full p-5 sm:p-6">
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

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="field-label">Email<input className="field-control" value={user.email ?? ""} readOnly disabled /></label>
              <label className="field-label">Role<input className="field-control" value={roleDisplayLabel(user.role)} readOnly disabled /></label>
              <label className="field-label sm:col-span-2">Display name<input required maxLength={120} className="field-control" value={name} onChange={e => setName(e.target.value)} /></label>
              <label className="field-label">Contact number<input maxLength={40} className="field-control" value={contactNumber} onChange={e => setContactNumber(e.target.value)} placeholder="09XX XXX XXXX" /></label>
              <label className="field-label sm:col-span-2">Address<textarea maxLength={500} className="field-control min-h-24" value={address} onChange={e => setAddress(e.target.value)} placeholder={user.role === "seller" ? "Business or pickup address" : "Delivery address"} /></label>
            </div>
          </section>

          <div className="grid w-full gap-6">
            <section className="agri-card w-full p-5 sm:p-6">
              <h2 className="font-display text-xl font-bold text-[#264f37]">Cooperative</h2>
              <p className="mt-1 text-sm text-[#6a796e]">
                {user.role === "seller"
                  ? "Request a different cooperative. An officer must approve before assignments change."
                  : "Your linked cooperative (read-only here)."}
              </p>
              {user.role === "seller" ? (
                <div className="mt-4 space-y-3">
                  <p className="text-sm text-[#315640]">
                    Current: {assignedCooperative?.name ?? (user.cooperativeId ? "Assigned cooperative" : "Not assigned")}
                  </p>
                  <CooperativeSelect
                    value={sellerCoop}
                    onChange={setSellerCoop}
                    allowAddNew={false}
                    required={false}
                    label="Request cooperative"
                  />
                  <label className="field-label">Reason for joining or changing cooperatives<textarea required maxLength={600} className="field-control min-h-20" value={associationReason} onChange={event => setAssociationReason(event.target.value)} /></label>
                  {pendingAssociation && (
                    <p className="text-sm text-[#65766b]" role="status">
                      You already have a pending request for {pendingAssociation.cooperativeName}. Wait for a decision before submitting another.
                    </p>
                  )}
                  {user.approvalStatus === "suspended" && (
                    <p className="text-sm text-[#a34838]" role="alert">Suspended Sellers cannot request a cooperative change. Contact an Admin for help.</p>
                  )}
                  {sellerCoop.cooperativeId === user.cooperativeId && user.cooperativeId != null && !pendingAssociation && (
                    <p className="text-sm text-[#65766b]" role="status">You are already assigned to this cooperative. Choose a different active cooperative.</p>
                  )}
                  <button
                    type="button"
                    className="agri-button text-sm"
                    disabled={associationRequest.isPending
                      || !sellerCoop.cooperativeId
                      || sellerCoop.cooperativeId === user.cooperativeId
                      || Boolean(pendingAssociation)
                      || user.approvalStatus === "suspended"
                      || !associationReason.trim()}
                    onClick={() => {
                      if (!sellerCoop.cooperativeId) return;
                      associationRequest.mutate({
                        cooperativeId: sellerCoop.cooperativeId,
                        message: associationReason.trim(),
                      });
                    }}
                  >
                    {user.cooperativeId ? "Request cooperative change" : "Request to join a cooperative"}
                  </button>
                </div>
              ) : (
                <div className="mt-4">
                  <CooperativeSelect
                    value={{
                      ...emptyCooperativeSelectValue(),
                      cooperativeId: user.cooperativeId ?? null,
                    }}
                    onChange={() => undefined}
                    allowAddNew={false}
                    disabled
                    label="Linked cooperative"
                  />
                </div>
              )}
            </section>
            <section className="agri-card w-full p-5 sm:p-6">
              <h2 className="font-display text-xl font-bold text-[#264f37]">Change password</h2>
              <p className="mt-1 text-sm text-[#6a796e]">Leave blank to keep your current password.</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="profile-new-password">New password</label>
                  <PasswordVisibilityInput id="profile-new-password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
                </div>
                <div>
                  <label className="field-label" htmlFor="profile-confirm-password">Confirm new password</label>
                  <PasswordVisibilityInput id="profile-confirm-password" minLength={8} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" />
                </div>
              </div>
            </section>
          </div>
        </form>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#dce4d6] bg-[#fffdf8] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:pb-3">
        <div className={`${shellContainerClass} flex w-full flex-wrap items-center justify-between gap-2`}>
          <button type="button" className="agri-ghost min-h-11" onClick={() => window.history.back()}>Cancel</button>
          <button type="submit" form="profile-form" className="agri-button min-h-11" disabled={busy}>{busy ? <Loader2 className="animate-spin" size={16} /> : null} Save</button>
        </div>
      </div>
    </>
  );
}
