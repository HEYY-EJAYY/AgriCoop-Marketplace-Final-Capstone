import { shellContainerClass, WorkspaceHeader } from "@/components/AgriShell";
import { useAuth } from "@/_core/hooks/useAuth";
import { roleDisplayLabel } from "@/lib/roleLabels";
import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";
import { Loader2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
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
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Use a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error("Profile photos must be 3 MB or less.");
      return;
    }
    setBusy(true);
    try {
      const base64 = await fileToBase64(file);
      const result = await uploadPhoto.mutateAsync({
        fileName: file.name,
        contentType: file.type as "image/jpeg" | "image/png" | "image/webp",
        base64,
      });
      setPreview(result.url);
      await utils.auth.me.invalidate();
      await refresh();
      toast.success("Profile photo updated.");
    } catch (error) {
      toast.error(toUserFacingErrorMessage(error instanceof Error ? error.message : "Upload failed."));
    } finally {
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

  return (
    <>
      <WorkspaceHeader title="My Profile" description="Update the details that appear in your account menu and message threads." />
      <main className={`${shellContainerClass} pb-28 pt-8`}>
        <form id="profile-form" onSubmit={onSubmit} className="agri-card mx-auto max-w-3xl p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-2xl bg-[#e8f0e4] text-2xl font-bold text-[#1f5a3c]">
              {preview ? <img src={preview} alt="" width={96} height={96} className="h-full w-full object-cover" /> : (name.trim().charAt(0) || "?").toUpperCase()}
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="agri-ghost min-h-11 cursor-pointer px-4 text-sm">
                Upload photo
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={e => void onPickPhoto(e.target.files?.[0] ?? null)} />
              </label>
              {preview && <button type="button" className="agri-ghost min-h-11 text-sm text-[#a34838]" onClick={() => void removePhoto()}>Remove</button>}
            </div>
          </div>

          <label className="field-label mt-6">Email<input className="field-control" value={user.email ?? ""} readOnly disabled /></label>
          <label className="field-label mt-4">Role<input className="field-control" value={roleDisplayLabel(user.role)} readOnly disabled /></label>
          <label className="field-label mt-4">Display name<input required maxLength={120} className="field-control" value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="field-label mt-4">Contact number<input maxLength={40} className="field-control" value={contactNumber} onChange={e => setContactNumber(e.target.value)} placeholder="09XX XXX XXXX" /></label>
          <label className="field-label mt-4">Address<textarea maxLength={500} className="field-control min-h-24" value={address} onChange={e => setAddress(e.target.value)} placeholder={user.role === "seller" ? "Business or pickup address" : "Delivery address"} /></label>

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
