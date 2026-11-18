import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { PageFrame, shellContainerClass } from "@/components/AgriShell";
import { CooperativeSelect, type CooperativeSelectValue } from "@/components/CooperativeSelect";
import { authSession, logAuthDiagnostic } from "@/lib/authSession";
import { getEmailVerificationReturn } from "@/lib/emailVerification";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";

type VerificationState = "none" | "required" | "verified" | "expired";
type RegistrationRole = "buyer" | "seller" | "coop_admin";

type CoopSuggestion = {
  id: number;
  name: string;
  normalizedName: string;
  location: string;
};

function isEmailConfirmationError(error: { code?: string; message?: string }) {
  return error.code === "email_not_confirmed" || /email not confirmed/i.test(error.message ?? "");
}

function emptyCoopValue(): CooperativeSelectValue {
  return {
    cooperativeId: null,
    newCooperativeName: "",
    newCooperativeLocation: "Philippines",
    addNew: false,
  };
}

export default function Auth() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [register, setRegister] = useState(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return params.get("register") === "1" || params.get("mode") === "register";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<RegistrationRole>("buyer");
  const [coop, setCoop] = useState<CooperativeSelectValue>(emptyCoopValue);
  const [coopSuggestion, setCoopSuggestion] = useState<CoopSuggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [verificationState, setVerificationState] = useState<VerificationState>("none");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [resendNotice, setResendNotice] = useState("");
  const registerAccount = trpc.auth.register.useMutation();
  const resendVerification = trpc.auth.resendVerification.useMutation();

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
    if (authResolution === "application_user_missing") {
      logAuthDiagnostic("application_user_missing_after_login", { supabaseSessionPresent: true });
      toast.error("Supabase sign-in succeeded, but no AgriCoop application account is linked to this Auth identity. Contact an administrator to verify the account mapping.");
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

  const resendVerificationEmail = async () => {
    setResendNotice("");
    try {
      await resendVerification.mutateAsync({ email: verificationEmail });
      setResendNotice("If this address can receive a confirmation message, a new link is on its way.");
    } catch (error) {
      setResendNotice(error instanceof Error ? error.message : "Unable to request a verification email. Please try again later.");
    }
  };

  const buildRegisterPayload = (confirmSimilarNormalizedName?: string) => {
    const payload: {
      email: string;
      password: string;
      name: string;
      role: RegistrationRole;
      cooperativeId?: number;
      newCooperativeName?: string;
      newCooperativeLocation?: string;
      confirmSimilarNormalizedName?: string;
    } = { email, password, name, role };

    if (coop.addNew && coop.newCooperativeName.trim()) {
      payload.newCooperativeName = coop.newCooperativeName.trim();
      payload.newCooperativeLocation = coop.newCooperativeLocation.trim() || "Philippines";
    } else if (coop.cooperativeId) {
      payload.cooperativeId = coop.cooperativeId;
    }
    if (confirmSimilarNormalizedName) {
      payload.confirmSimilarNormalizedName = confirmSimilarNormalizedName;
    }
    return payload;
  };

  const runRegister = async (confirmSimilarNormalizedName?: string) => {
    await registerAccount.mutateAsync(buildRegisterPayload(confirmSimilarNormalizedName));
    setCoopSuggestion(null);
    setVerificationEmail(email.trim());
    setVerificationState("required");
    setResendNotice("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
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
        try {
          await runRegister();
        } catch (error) {
          const message = error instanceof Error ? error.message : "Authentication failed.";
          const suggestionMatch = /Did you mean "([^"]+)"/i.exec(message);
          if (suggestionMatch && coop.addNew) {
            // Server embeds suggestion in message; fetch list to resolve id/normalizedName.
            const list = await utils.cooperatives.listActive.fetch();
            const found = list.find(row => row.name === suggestionMatch[1]);
            if (found) {
              setCoopSuggestion({
                id: found.id,
                name: found.name,
                normalizedName: found.normalizedName,
                location: found.location,
              });
              return;
            }
          }
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
      setBusy(false);
    }
  };

  const returnToSignIn = () => {
    setRegister(false);
    setPassword("");
    setVerificationState("none");
    setResendNotice("");
    setCoopSuggestion(null);
  };

  const roleHint = role === "seller"
    ? "Create a Seller / Farmer account. A cooperative is required; Seller access still needs approval."
    : role === "coop_admin"
      ? "Create a Cooperative Admin application account. You start with Buyer access until SuperAdmin approves your documents."
      : "Create a Buyer account. Choosing a cooperative is optional.";

  return <PageFrame>
    <main className={`${shellContainerClass} py-16`}>
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
            {verificationState === "expired"
              ? "Request a fresh confirmation link. Your account cannot use AgriCoop until Supabase confirms the email address."
              : "If this address can be registered, Supabase will send a confirmation link. Confirm it before signing in. Seller approval and cooperative assignment remain separate."}
          </p>
          <label className="field-label mt-3">Email for confirmation<input required type="email" className="field-control" value={verificationEmail} onChange={event => setVerificationEmail(event.target.value)} /></label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="agri-button text-sm" disabled={resendVerification.isPending || !verificationEmail.trim()} onClick={() => void resendVerificationEmail()}>
              {resendVerification.isPending ? "Please wait…" : "Resend verification"}
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

        {verificationState === "none" && <form onSubmit={submit} className="mt-6 space-y-4">
          {register && <>
            <label className="field-label">Full name<input required className="field-control" value={name} onChange={event => setName(event.target.value)} /></label>
            <label className="field-label">Role
              <select
                className="field-control"
                value={role}
                onChange={event => {
                  const next = event.target.value as RegistrationRole;
                  setRole(next);
                  setCoopSuggestion(null);
                }}
              >
                <option value="buyer">Buyer / Consumer</option>
                <option value="seller">Seller / Farmer</option>
                <option value="coop_admin">Cooperative Admin (Officer Admin)</option>
              </select>
            </label>
            <CooperativeSelect
              value={coop}
              onChange={next => {
                setCoop(next);
                setCoopSuggestion(null);
              }}
              required={role === "seller" || role === "coop_admin"}
              disabled={busy}
            />
            {coopSuggestion && (
              <section role="alertdialog" aria-labelledby="coop-did-you-mean-title" className="rounded-xl border border-[#e2c48a] bg-[#fff8ea] p-4">
                <h2 id="coop-did-you-mean-title" className="font-bold text-[#6a4e16]">Did you mean…?</h2>
                <p className="mt-2 text-sm text-[#6a4e16]">
                  A similar cooperative already exists: <strong>{coopSuggestion.name}</strong> ({coopSuggestion.location}).
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="agri-button text-sm"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void runRegister(coopSuggestion.normalizedName)
                        .catch(error => toast.error(error instanceof Error ? error.message : "Registration failed."))
                        .finally(() => setBusy(false));
                    }}
                  >
                    Use {coopSuggestion.name}
                  </button>
                  <button
                    type="button"
                    className="agri-ghost text-sm"
                    disabled={busy}
                    onClick={() => {
                      const normalized = coop.newCooperativeName.trim().toLowerCase().replace(/[^a-z0-9]+/gi, "");
                      setBusy(true);
                      void runRegister(normalized || coopSuggestion.normalizedName)
                        .catch(error => toast.error(error instanceof Error ? error.message : "Registration failed."))
                        .finally(() => setBusy(false));
                    }}
                  >
                    Create mine anyway
                  </button>
                </div>
              </section>
            )}
          </>}
          <label className="field-label">Email<input required type="email" className="field-control" value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label className="field-label">Password<input required minLength={6} type="password" className="field-control" value={password} onChange={event => setPassword(event.target.value)} /></label>
          <button disabled={busy} className="agri-button w-full">{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button>
        </form>}
        {(verificationState === "none" || verificationState === "verified") && <button className="mt-5 w-full text-sm font-bold text-[#3c704b]" onClick={() => setRegister(!register)}>
          {register ? "Already registered? Sign in" : "New to AgriCoop? Create an account"}
        </button>}
      </div>
    </main>
  </PageFrame>;
}
