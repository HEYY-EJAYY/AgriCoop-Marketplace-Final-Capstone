import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import { PageFrame, shellContainerClass } from "@/components/AgriShell";
import { CooperativeDuplicateNotice } from "@/components/CooperativeDuplicateNotice";
import { CooperativeSelect, emptyCooperativeSelectValue, type CooperativeSelectValue } from "@/components/CooperativeSelect";
import { PasswordVisibilityInput } from "@/components/PasswordVisibilityInput";
import {
  appendNewCooperativeFields,
  confirmNormalizedNameForNewCoop,
  cooperativeConflictFromError,
  type CooperativeConflictUi,
} from "@/lib/cooperativeConflict";
import { authSession, logAuthDiagnostic } from "@/lib/authSession";
import { getEmailVerificationReturn } from "@/lib/emailVerification";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";

type VerificationState = "none" | "required" | "verified" | "expired";
type RegistrationRole = "buyer" | "seller" | "coop_admin";

function isEmailConfirmationError(error: { code?: string; message?: string }) {
  return error.code === "email_not_confirmed" || /email not confirmed/i.test(error.message ?? "");
}

function registerModeFromSearch(search: string) {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  return params.get("register") === "1" || params.get("mode") === "register";
}

export default function Auth() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const utils = trpc.useUtils();
  const register = useMemo(() => registerModeFromSearch(search), [search]);
  const setRegister = useCallback((next: boolean) => {
    // Push history so browser Back switches login ↔ register correctly.
    navigate(next ? "/auth?register=1" : "/auth");
  }, [navigate]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<RegistrationRole>("buyer");
  const [coop, setCoop] = useState<CooperativeSelectValue>(emptyCooperativeSelectValue);
  const [coopConflict, setCoopConflict] = useState<CooperativeConflictUi | null>(null);
  const [busy, setBusy] = useState(false);
  const [verificationState, setVerificationState] = useState<VerificationState>("none");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [resendNotice, setResendNotice] = useState("");
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const [resetStage, setResetStage] = useState<"none" | "request" | "complete">("none");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const registerAccount = trpc.auth.register.useMutation();
  const resendVerification = trpc.auth.resendVerification.useMutation();

  // Password recovery links land here with ?type=recovery (or #type=recovery).
  // Supabase establishes the recovery session from the URL; detect it and
  // switch to the reset form instead of the normal sign-in/register views.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const params = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const type = params.get("type") ?? fragment.get("type");
    // `recovery=1` is set by the global PASSWORD_RECOVERY redirect when the
    // Supabase Site URL lands the user somewhere other than /auth.
    if (type !== "recovery" && params.get("recovery") !== "1") return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      window.history.replaceState({}, "", "/auth");
      if (data.session) {
        setEmail(data.session.user.email ?? "");
        setResetStage("complete");
      } else {
        setResetStage("request");
        setResendNotice("That password reset link is invalid or has expired. Request a new one below.");
      }
    }).catch(() => {
      if (active) setResetStage("request");
    });
    return () => { active = false; };
  }, []);

  const resolveApplicationSession = useCallback(async (session: Session) => {
    authSession.setLoginSession(session);
    await Promise.all([utils.auth.me.invalidate(), utils.auth.status.invalidate()]);
    const [authResolution, applicationUser] = await Promise.all([
      utils.auth.status.fetch(),
      utils.auth.me.fetch(),
    ]);
    if (authResolution === "email_not_verified") {
      setVerificationEmail(session.user.email ?? "");
      setVerificationState("required");
      return false;
    }
    if (authResolution === "application_user_deleted") {
      logAuthDiagnostic("application_user_deleted_after_login", { supabaseSessionPresent: true });
      toast.error("This account is no longer active. Please contact an administrator.");
      await supabase.auth.signOut().catch(() => undefined);
      return false;
    }
    if (authResolution === "application_user_missing") {
      logAuthDiagnostic("application_user_missing_after_login", { supabaseSessionPresent: true });
      toast.error("We could not finish linking your AgriCoop profile yet. Wait a moment and sign in again, or contact support if this continues.");
      return false;
    }
    if (authResolution === "application_user_mapping_unavailable") {
      logAuthDiagnostic("application_user_mapping_unavailable_after_login", { supabaseSessionPresent: true });
      toast.error("A Supabase role profile exists, but AgriCoop could not find its matching application account. An administrator must verify the exact openId mapping.");
      return false;
    }
    if (authResolution === "application_profile_missing") {
      logAuthDiagnostic("application_profile_missing_after_login", { supabaseSessionPresent: true });
      toast.error("Your AgriCoop application account has no visible canonical role profile. An administrator must verify the profile link and database policies.");
      return false;
    }
    if (authResolution === "application_role_mapping_unavailable") {
      logAuthDiagnostic("application_role_mapping_unavailable_after_login", { supabaseSessionPresent: true });
      toast.error("Your account's canonical role record is missing or unavailable. An administrator must review the role mapping.");
      return false;
    }
    if (authResolution === "application_role_mapping_conflict") {
      logAuthDiagnostic("application_role_mapping_conflict_after_login", { supabaseSessionPresent: true });
      toast.error("Your account roles do not match. AgriCoop will try to sync them automatically; if this continues, ask a SuperAdmin to open Role reconciliation in System administration.");
      return false;
    }
    if (authResolution === "application_identity_conflict") {
      logAuthDiagnostic("application_identity_conflict_after_login", { supabaseSessionPresent: true });
      toast.error("More than one application or role profile matches this Auth identity. Sign-in is blocked until an administrator resolves the duplicate records.");
      return false;
    }
    if (authResolution === "application_database_schema_unavailable") {
      logAuthDiagnostic("application_database_schema_unavailable_after_login", { supabaseSessionPresent: true });
      toast.error("The AgriCoop database schema is missing or incompatible. An administrator must review the PostgreSQL schema before sign-in can continue.");
      return false;
    }
    if (authResolution === "application_database_unavailable") {
      logAuthDiagnostic("application_database_unavailable_after_login", { supabaseSessionPresent: true });
      toast.error("Supabase sign-in succeeded, but the AgriCoop profile service is unavailable. Try again later.");
      return false;
    }
    if (authResolution === "application_database_access_denied") {
      logAuthDiagnostic("application_database_access_denied_after_login", { supabaseSessionPresent: true });
      toast.error("Supabase sign-in succeeded, but the application database denied access. An administrator must review its grants and row-level security policies.");
      return false;
    }
    if (authResolution === "no_bearer_token" || authResolution === "bearer_rejected") {
      logAuthDiagnostic("backend_did_not_accept_session_after_login", { authResolution });
      toast.error("Supabase sign-in succeeded, but the backend did not receive or accept the session. Please try again.");
      return false;
    }
    if (authResolution === "auth_validation_failed") {
      logAuthDiagnostic("backend_session_validation_failed_after_login", { authResolution });
      toast.error("Supabase sign-in succeeded, but the backend could not validate the session. Try again later.");
      return false;
    }
    if (authResolution !== "application_user_resolved" || !applicationUser) {
      logAuthDiagnostic("application_profile_not_resolved_after_login", {
        supabaseSessionPresent: true,
        authResolution,
      });
      toast.error("Supabase sign-in succeeded, but AgriCoop could not validate the application profile. Check the authentication diagnostics or try again.");
      return false;
    }
    logAuthDiagnostic("application_profile_resolved_after_login", { role: applicationUser.role });
    return true;
  }, [utils]);

  const signInAndResolveApplicationUser = async () => {
    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) {
      if (isEmailConfirmationError(loginError)) {
        setVerificationEmail(email.trim());
        setVerificationState("required");
        return false;
      }
      throw loginError;
    }

    const { data: persistedData, error: sessionError } = await supabase.auth.getSession();
    const session = persistedData.session;
    logAuthDiagnostic("supabase_sign_in_result", {
      signInSessionPresent: Boolean(loginData.session),
      persistedSessionPresent: Boolean(session),
      accessTokenPresent: Boolean(session?.access_token),
      sessionReadError: Boolean(sessionError),
    });
    if (sessionError) throw sessionError;
    if (!session?.access_token) {
      throw new Error("Supabase sign-in returned without a restorable browser session.");
    }
    return resolveApplicationSession(session);
  };

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const returnState = getEmailVerificationReturn(window.location.search, window.location.hash);
    if (returnState === "expired") {
      setVerificationEmail(new URLSearchParams(window.location.search).get("email") ?? "");
      setVerificationState("expired");
      return;
    }
    if (returnState !== "success") return;

    let active = true;
    void supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return;
      const session = data.session;
      if (error || !session?.user.email_confirmed_at) {
        setVerificationEmail(session?.user.email ?? "");
        setVerificationState("expired");
        return;
      }
      setEmail(session.user.email ?? "");
      setVerificationEmail(session.user.email ?? "");
      setVerificationState("verified");
      const resolved = await resolveApplicationSession(session);
      if (active && resolved) {
        toast.success("Email verified. Your AgriCoop account is ready.");
        navigate("/dashboard");
      }
    }).catch(() => {
      if (active) setVerificationState("expired");
    });
    return () => {
      active = false;
    };
  }, [navigate, resolveApplicationSession]);

  useEffect(() => {
    if (resendCooldownSeconds <= 0) return undefined;
    const timer = window.setInterval(() => {
      setResendCooldownSeconds(seconds => (seconds > 1 ? seconds - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldownSeconds]);

  const resendVerificationEmail = async () => {
    if (resendCooldownSeconds > 0 || !verificationEmail.trim()) return;
    setResendNotice("");
    try {
      await resendVerification.mutateAsync({ email: verificationEmail });
      setResendNotice("If this address can receive a confirmation message, a new link is on its way.");
      setResendCooldownSeconds(60);
    } catch (error) {
      setResendNotice(error instanceof Error ? error.message : "Unable to request a verification email. Please try again later.");
    }
  };

  useEffect(() => {
    if (!register || !coop.addNew || coop.newCooperativeName.trim().length < 3) {
      return undefined;
    }
    if (!coop.newCooperativeLocation.trim() || coop.newCooperativeAddress.trim().length < 3) {
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void utils.cooperatives.previewCreate
        .fetch({
          newCooperativeName: coop.newCooperativeName.trim(),
          newCooperativeLocation: coop.newCooperativeLocation.trim(),
          newCooperativeAddress: coop.newCooperativeAddress.trim(),
        })
        .then(() => {
          if (!cancelled) setCoopConflict(null);
        })
        .catch(error => {
          const conflict = cooperativeConflictFromError(error);
          if (!cancelled && conflict) setCoopConflict(conflict);
        });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    register,
    coop.addNew,
    coop.newCooperativeName,
    coop.newCooperativeLocation,
    coop.newCooperativeAddress,
    utils.cooperatives.previewCreate,
  ]);

  const buildRegisterPayload = (confirmSimilarNormalizedName?: string) => {
    const payload: Parameters<typeof registerAccount.mutateAsync>[0] = { email, password, name, role };
    appendNewCooperativeFields(payload, coop);
    if (confirmSimilarNormalizedName) {
      payload.confirmSimilarNormalizedName = confirmSimilarNormalizedName;
    }
    return payload;
  };

  const runRegister = async (confirmSimilarNormalizedName?: string) => {
    try {
      await registerAccount.mutateAsync(buildRegisterPayload(confirmSimilarNormalizedName));
      setCoopConflict(null);
      setVerificationEmail(email.trim());
      setVerificationState("required");
      setResendNotice("");
    } catch (error) {
      const conflict = cooperativeConflictFromError(error);
      if (conflict) {
        setCoopConflict(conflict);
        return;
      }
      throw error;
    }
  };

  const requestPasswordReset = async () => {
    if (!email.trim()) {
      toast.error("Enter the email address for your account.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth`,
      });
      if (error) throw error;
      // Never reveal whether the email is registered.
      setResendNotice("If an account exists for that email, a password reset link is on its way. Check your inbox and spam folder.");
    } catch {
      setResendNotice("If an account exists for that email, a password reset link is on its way. Check your inbox and spam folder.");
    } finally {
      setBusy(false);
    }
  };

  const submitPasswordReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Password updated. You can now sign in.");
      setResetStage("none");
      setNewPassword("");
      setConfirmPassword("");
      setPassword("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update the password. The link may have expired — request a new one.");
    } finally {
      setBusy(false);
    }
  };

  const submitInFlight = useRef(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    if (!isSupabaseConfigured) {
      toast.error("Supabase Auth is not configured for this deployment. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }
    setBusy(true);
    try {
      if (register) {
        const needsCoop = role === "seller" || role === "coop_admin";
        if (needsCoop && !coop.addNew && !coop.cooperativeId) {
          toast.error("Select a cooperative or add a new one.");
          return;
        }
        if (needsCoop && coop.addNew && coop.newCooperativeName.trim().length < 3) {
          toast.error("Enter the new cooperative name.");
          return;
        }
        if (needsCoop && coop.addNew && (!coop.newCooperativeLocation.trim() || coop.newCooperativeAddress.trim().length < 3)) {
          toast.error("Enter the cooperative address and location.");
          return;
        }
        try {
          await runRegister();
        } catch (error) {
          if (cooperativeConflictFromError(error)) return;
          throw error;
        }
        return;
      }
      if (!await signInAndResolveApplicationUser()) return;
      toast.success("Welcome back to AgriCoop.");
      navigate("/dashboard");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed.";
      toast.error(message);
    } finally {
      submitInFlight.current = false;
      setBusy(false);
    }
  };

  const returnToSignIn = () => {
    setRegister(false);
    setPassword("");
    setVerificationState("none");
    setResendNotice("");
    setCoopConflict(null);
  };

  const roleHint = role === "seller"
    ? "Create a Seller / Farmer account. A cooperative is required; Seller access still needs approval."
    : role === "coop_admin"
      ? "Apply for OfficerAdmin access. After verifying your email you will upload your government ID and supporting documents; SuperAdmin approval is required before OfficerAdmin access is granted."
      : "Create a Buyer account. You may link a cooperative during sign-up.";

  return <PageFrame>
    <main className={`${shellContainerClass} py-10`}>
      <div className="agri-card mx-auto max-w-lg p-7">
        <p className="text-xs font-extrabold uppercase tracking-[.13em] text-[#3f6b42]">AgriCoop account</p>
        <h1 className="mt-2 font-display text-3xl font-bold text-[#214b35]">{register ? "Join the cooperative market" : "Welcome back"}</h1>
        <p className="mt-2 text-sm leading-6 text-[#66766b]">
          {register
            ? roleHint
            : "Use your own Supabase account. Role access is still checked server-side before any operation."}
        </p>

        {(verificationState === "required" || verificationState === "expired") && <section role={verificationState === "expired" ? "alert" : "status"} className="mt-6 rounded-xl border border-[#d6e5cb] bg-[#f2f8ee] p-4">
          <h2 className="font-bold text-[#315640]">{verificationState === "expired" ? "Verification link expired or invalid" : "Verify your email to continue"}</h2>
          <p className="mt-2 text-sm leading-6 text-[#617467]">
            {verificationEmail.trim()
              ? <>We sent a confirmation request to <strong className="font-semibold text-[#315640]">{verificationEmail.trim()}</strong>. Delivery is not guaranteed from this screen—check your inbox and spam folder.</>
              : "Enter the email that should receive the confirmation link."}
          </p>
          <p className="mt-2 text-sm leading-6 text-[#617467]">
            {verificationState === "expired"
              ? "Request a fresh confirmation link. Your account cannot use AgriCoop until Supabase confirms the email address."
              : "Confirm the link before signing in. Seller approval and cooperative assignment remain separate."}
          </p>
          <p className="mt-2 text-xs leading-5 text-[#617467]">Tip: look in spam/junk if nothing arrives within a few minutes. Resend is limited to once every 60 seconds.</p>
          <label className="field-label mt-3">Email for confirmation<input required type="email" className="field-control" value={verificationEmail} onChange={event => setVerificationEmail(event.target.value)} /></label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="agri-button text-sm" disabled={resendVerification.isPending || resendCooldownSeconds > 0 || !verificationEmail.trim()} onClick={() => void resendVerificationEmail()}>
              {resendVerification.isPending
                ? "Please wait…"
                : resendCooldownSeconds > 0
                  ? `Resend in ${resendCooldownSeconds}s`
                  : "Resend verification"}
            </button>
            <button
              type="button"
              className="agri-ghost text-sm"
              onClick={() => {
                setVerificationState("none");
                setRegister(true);
                setResendNotice("");
              }}
            >
              Wrong email? Use a different email
            </button>
            <button type="button" className="agri-ghost text-sm" onClick={returnToSignIn}>Back to sign in</button>
          </div>
          {resendNotice && <p role="status" className="mt-3 text-sm text-[#496b50]">{resendNotice}</p>}
        </section>}

        {verificationState === "verified" && <section role="status" className="mt-6 rounded-xl border border-[#d6e5cb] bg-[#f2f8ee] p-4">
          <h2 className="font-bold text-[#315640]">Email verified</h2>
          <p className="mt-2 text-sm leading-6 text-[#617467]">Your email is confirmed. Sign in to continue if you were not redirected automatically.</p>
          <button type="button" className="agri-button mt-3 text-sm" onClick={returnToSignIn}>Continue to sign in</button>
        </section>}

        {resetStage === "request" && <section className="mt-6 rounded-xl border border-[#d6e5cb] bg-[#f2f8ee] p-4">
          <h2 className="font-bold text-[#315640]">Reset your password</h2>
          <p className="mt-2 text-sm leading-6 text-[#617467]">Enter your account email and we will send a secure reset link.</p>
          <label className="field-label mt-3">Email<input required type="email" className="field-control" value={email} onChange={event => setEmail(event.target.value)} /></label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="agri-button text-sm" disabled={busy} onClick={() => void requestPasswordReset()}>{busy ? "Sending…" : "Send reset link"}</button>
            <button type="button" className="agri-ghost text-sm" onClick={() => { setResetStage("none"); setResendNotice(""); }}>Back to sign in</button>
          </div>
          {resendNotice && <p role="status" className="mt-3 text-sm text-[#496b50]">{resendNotice}</p>}
        </section>}

        {resetStage === "complete" && <form onSubmit={submitPasswordReset} className="mt-6 space-y-4">
          <h2 className="font-bold text-[#315640]">Choose a new password</h2>
          <p className="text-sm leading-6 text-[#617467]">Enter a new password for {email || "your account"}. It must be at least 6 characters.</p>
          <label className="field-label" htmlFor="auth-new-password">New password</label>
          <PasswordVisibilityInput id="auth-new-password" required minLength={6} value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" />
          <label className="field-label" htmlFor="auth-confirm-password">Confirm new password</label>
          <PasswordVisibilityInput id="auth-confirm-password" required minLength={6} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" />
          <button disabled={busy} className="agri-button w-full">{busy ? "Updating…" : "Update password"}</button>
          <button type="button" className="w-full text-sm font-bold text-[#3c704b]" onClick={() => { setResetStage("none"); setPassword(""); }}>Cancel</button>
        </form>}

        {verificationState === "none" && resetStage === "none" && <form onSubmit={submit} className="mt-6 space-y-4">
          {register && <>
            <label className="field-label">Full name<input required className="field-control" value={name} onChange={event => setName(event.target.value)} /></label>
            <label className="field-label">Role
              <select
                className="field-control"
                value={role}
                onChange={event => {
                  const next = event.target.value as RegistrationRole;
                  setRole(next);
                  setCoopConflict(null);
                }}
              >
                <option value="buyer">Buyer / Consumer</option>
                <option value="seller">Seller / Farmer</option>
                <option value="coop_admin">OfficerAdmin (OfficerAdmin)</option>
              </select>
            </label>
            <CooperativeSelect
              value={coop}
              onChange={next => {
                setCoop(next);
                setCoopConflict(null);
              }}
              required={role === "seller" || role === "coop_admin"}
              disabled={busy}
            />
            {coopConflict && (
              <CooperativeDuplicateNotice
                {...(coopConflict.mode === "exact"
                  ? {
                      mode: "exact" as const,
                      match: coopConflict.match,
                      onUse: match => {
                        setBusy(true);
                        void runRegister(match.normalizedName)
                          .catch(error => {
                            if (!cooperativeConflictFromError(error)) {
                              toast.error(error instanceof Error ? error.message : "Registration failed.");
                            }
                          })
                          .finally(() => setBusy(false));
                      },
                    }
                  : {
                      mode: "similar" as const,
                      matches: coopConflict.matches,
                      onUse: match => {
                        setBusy(true);
                        void runRegister(match.normalizedName)
                          .catch(error => {
                            if (!cooperativeConflictFromError(error)) {
                              toast.error(error instanceof Error ? error.message : "Registration failed.");
                            }
                          })
                          .finally(() => setBusy(false));
                      },
                      onAddMine: () => {
                        setBusy(true);
                        void runRegister(confirmNormalizedNameForNewCoop(coop))
                          .catch(error => {
                            if (!cooperativeConflictFromError(error)) {
                              toast.error(error instanceof Error ? error.message : "Registration failed.");
                            }
                          })
                          .finally(() => setBusy(false));
                      },
                    })}
              />
            )}
          </>}
          <label className="field-label">Email<input required type="email" className="field-control" value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label className="field-label" htmlFor="auth-password">Password</label>
          <PasswordVisibilityInput id="auth-password" required minLength={6} value={password} onChange={event => setPassword(event.target.value)} autoComplete={register ? "new-password" : "current-password"} />
          <button disabled={busy} className="agri-button w-full">{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button>
          {!register && <button type="button" className="w-full text-sm font-bold text-[#3c704b]" onClick={() => { setResetStage("request"); setResendNotice(""); }}>Forgot password?</button>}
        </form>}
        {(verificationState === "none" || verificationState === "verified") && resetStage === "none" && <button className="mt-5 w-full text-sm font-bold text-[#3c704b]" onClick={() => setRegister(!register)}>
          {register ? "Already registered? Sign in" : "New to AgriCoop? Create an account"}
        </button>}
      </div>
    </main>
  </PageFrame>;
}
