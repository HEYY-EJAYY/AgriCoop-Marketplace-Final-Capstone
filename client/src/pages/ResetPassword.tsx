import { PageFrame } from "@/components/AgriShell";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { validatePasswordReset } from "@/lib/passwordValidation";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [busy, setBusy] = useState(false);
  const recoveryLink = typeof window !== "undefined"
    && new URLSearchParams(window.location.hash.replace(/^#/, "")).get("type") === "recovery";

  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" && session) setHasRecoverySession(true);
      if (event === "INITIAL_SESSION" && recoveryLink && session) setHasRecoverySession(true);
      if (event === "SIGNED_OUT") setHasRecoverySession(false);
      setCheckingSession(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      if (recoveryLink && session) setHasRecoverySession(true);
      setCheckingSession(false);
    }).catch(() => {
      if (active) setCheckingSession(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [recoveryLink]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validatePasswordReset(password, confirmation);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    if (!isSupabaseConfigured || !hasRecoverySession) {
      setHasRecoverySession(false);
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error("We couldn't update your password. Please request a new reset link and try again.");
        return;
      }
      toast.success("Your password has been updated. Please sign in again.");
      await supabase.auth.signOut();
      setHasRecoverySession(false);
      navigate("/auth");
    } catch {
      toast.error("We couldn't update your password. Please request a new reset link and try again.");
    } finally {
      setBusy(false);
    }
  };

  return <PageFrame><main className="mx-auto max-w-lg px-4 py-16 sm:px-6"><div className="agri-card p-7"><p className="text-xs font-extrabold uppercase tracking-[.13em] text-[#6d9147]">AgriCoop account</p><h1 className="mt-2 font-display text-3xl font-bold text-[#214b35]">Choose a new password</h1>{checkingSession ? <p className="mt-4 text-sm text-[#66766b]">Checking your reset link…</p> : hasRecoverySession ? <><p className="mt-2 text-sm leading-6 text-[#66766b]">Choose a new password for your account.</p><form onSubmit={submit} className="mt-6 space-y-4"><label className="field-label">New password<input required minLength={8} autoComplete="new-password" type={showPasswords ? "text" : "password"} className="field-control" value={password} onChange={event=>setPassword(event.target.value)} /></label><label className="field-label">Confirm new password<input required minLength={8} autoComplete="new-password" type={showPasswords ? "text" : "password"} className="field-control" value={confirmation} onChange={event=>setConfirmation(event.target.value)} /></label><button type="button" className="text-sm font-bold text-[#3c704b]" onClick={()=>setShowPasswords(value=>!value)}>{showPasswords ? "Hide passwords" : "Show passwords"}</button><button disabled={busy} className="agri-button w-full">{busy ? "Please wait…" : "Update password"}</button></form></> : <><p className="mt-2 text-sm leading-6 text-[#66766b]">This link is invalid or expired.</p><button className="agri-button mt-6 w-full" onClick={()=>navigate("/auth?forgot=1")}>Request a new reset link</button></>}</div></main></PageFrame>;
}
