import { PageFrame } from "@/components/AgriShell";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function Auth() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [register, setRegister] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(() => new URLSearchParams(window.location.search).get("forgot") === "1");
  const [resetNotice, setResetNotice] = useState("");
  const [resetCooldown, setResetCooldown] = useState(0);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState(""); const [role, setRole] = useState("buyer"); const [busy, setBusy] = useState(false);
  const [sellerType, setSellerType] = useState<"individual" | "cooperative">("individual");
  const [cooperativeChoice, setCooperativeChoice] = useState("");
  const [newCooperativeName, setNewCooperativeName] = useState("");
  const cooperatives = trpc.cooperatives.list.useQuery(undefined, { enabled: register && role === "seller" });
  const registerAccount = trpc.auth.register.useMutation();
  useEffect(() => {
    if (resetCooldown <= 0) return;
    const timer = window.setInterval(() => setResetCooldown(seconds => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resetCooldown > 0]);
  const requestPasswordReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isSupabaseConfigured) {
      setResetNotice("If that email has an account, we've sent a reset link.");
      return;
    }
    setResetCooldown(60);
    setResetNotice("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        if (error.status === 429 || error.code === "over_email_send_rate_limit") {
          toast.error("Please wait and try again.");
          return;
        }
      }
      setResetNotice("If that email has an account, we've sent a reset link.");
    } catch (error) {
      const rateLimited = typeof error === "object" && error !== null && "status" in error && error.status === 429;
      if (rateLimited) toast.error("Please wait and try again.");
      else setResetNotice("If that email has an account, we've sent a reset link.");
    }
  };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (!isSupabaseConfigured) { toast.error("Supabase Auth is not configured for this deployment. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."); return; } setBusy(true); try {
    if (register) {
      const result = await registerAccount.mutateAsync({
        email,
        password,
        name,
        role: role as "buyer" | "seller" | "admin",
        ...(role === "seller" ? {
          sellerType,
          ...(sellerType === "cooperative" ? cooperativeChoice === "new"
            ? { cooperativeName: newCooperativeName }
            : { cooperativeId: Number(cooperativeChoice) }
            : {}),
        } : {}),
      });
      const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; await utils.auth.me.invalidate();
      if (result.joinedExistingCooperative) toast.success(`Joined existing cooperative: ${result.joinedExistingCooperative}`);
      else toast.success(role === "admin" ? "Registration submitted. A SuperAdmin must approve your Cooperative Officer account." : result.cooperativeName ? `Account created and joined ${result.cooperativeName}.` : "Account created. Welcome to AgriCoop.");
      navigate("/dashboard");
    }
    else { const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; await utils.auth.me.invalidate(); toast.success("Welcome back to AgriCoop."); navigate("/dashboard"); }
  } catch (error) { const message = error instanceof Error ? error.message : "Authentication failed."; toast.error(message); } finally { setBusy(false); } };
  return <PageFrame><main className="mx-auto max-w-lg px-4 py-16 sm:px-6"><div className="agri-card p-7"><p className="text-xs font-extrabold uppercase tracking-[.13em] text-[#6d9147]">AgriCoop account</p><h1 className="mt-2 font-display text-3xl font-bold text-[#214b35]">{forgotPassword ? "Reset your password" : register ? "Join the cooperative market" : "Welcome back"}</h1><p className="mt-2 text-sm leading-6 text-[#66766b]">{forgotPassword ? "Enter the email associated with your account and we'll send a reset link." : register ? "Create a Buyer, Seller / Farmer, or Cooperative Admin Officer account. Admin Officer registrations remain pending until a SuperAdmin approves them." : "Use your own Supabase account. Role access is still checked server-side before any operation."}</p>{forgotPassword ? <form onSubmit={requestPasswordReset} className="mt-6 space-y-4"><label className="field-label">Email<input required type="email" className="field-control" value={email} onChange={e=>setEmail(e.target.value)} /></label><button disabled={resetCooldown > 0} className="agri-button w-full">{resetCooldown > 0 ? `Try again in ${resetCooldown}s` : "Send reset link"}</button>{resetNotice && <p role="status" className="text-sm text-[#315640]">{resetNotice}</p>}<button type="button" className="w-full text-sm font-bold text-[#3c704b]" onClick={()=>{setForgotPassword(false);setResetNotice("");}}>Back to sign in</button></form> : <><form onSubmit={submit} className="mt-6 space-y-4">{register && <><label className="field-label">Full name<input required className="field-control" value={name} onChange={e=>setName(e.target.value)} /></label><label className="field-label">Role<select className="field-control" value={role} onChange={e=>setRole(e.target.value)}><option value="buyer">Buyer / Consumer</option><option value="seller">Seller / Farmer</option><option value="admin">Cooperative Admin Officer (approval required)</option></select></label>{role === "seller" && <><label className="field-label">Seller type<select className="field-control" value={sellerType} onChange={e=>setSellerType(e.target.value as "individual" | "cooperative")}><option value="individual">Individual seller</option><option value="cooperative">Member of a cooperative</option></select></label>{sellerType === "cooperative" && <><label className="field-label">Cooperative<select required className="field-control" value={cooperativeChoice} onChange={e=>setCooperativeChoice(e.target.value)}><option value="">Select a cooperative</option>{cooperatives.data?.map(cooperative=><option key={cooperative.id} value={cooperative.id}>{cooperative.name}</option>)}<option value="new">My cooperative is not listed</option></select></label>{cooperativeChoice === "new" && <label className="field-label">Cooperative name<input required maxLength={180} className="field-control" value={newCooperativeName} onChange={e=>setNewCooperativeName(e.target.value)} /></label>}</>}</>}</>}<label className="field-label">Email<input required type="email" className="field-control" value={email} onChange={e=>setEmail(e.target.value)} /></label><label className="field-label">Password<input required minLength={6} type="password" className="field-control" value={password} onChange={e=>setPassword(e.target.value)} /></label><button disabled={busy} className="agri-button w-full">{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button></form>{!register && <button type="button" className="mt-3 w-full text-sm font-bold text-[#3c704b]" onClick={()=>{setForgotPassword(true);setResetNotice("");}}>Forgot password?</button>}<button type="button" className="mt-5 w-full text-sm font-bold text-[#3c704b]" onClick={()=>setRegister(!register)}>{register ? "Already registered? Sign in" : "New to AgriCoop? Create an account"}</button></>}</div></main></PageFrame>;
}
