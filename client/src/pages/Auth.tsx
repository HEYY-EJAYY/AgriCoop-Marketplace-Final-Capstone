import { PageFrame } from "@/components/AgriShell";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function Auth() {
  const [, navigate] = useLocation();
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState(""); const [role, setRole] = useState("buyer"); const [busy, setBusy] = useState(false);
  const registerAccount = trpc.auth.register.useMutation();
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (!isSupabaseConfigured) { toast.error("Supabase Auth is not configured for this deployment. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."); return; } setBusy(true); try {
    if (register) { await registerAccount.mutateAsync({ email, password, name, role: role as "buyer" | "seller" }); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; toast.success("Account created. Welcome to AgriCoop."); navigate("/dashboard"); }
    else { const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; toast.success("Welcome back to AgriCoop."); navigate("/dashboard"); }
  } catch (error) { const message = error instanceof Error ? error.message : "Authentication failed."; toast.error(message); } finally { setBusy(false); } };
  return <PageFrame><main className="mx-auto max-w-lg px-4 py-16 sm:px-6"><div className="agri-card p-7"><p className="text-xs font-extrabold uppercase tracking-[.13em] text-[#6d9147]">AgriCoop account</p><h1 className="mt-2 font-display text-3xl font-bold text-[#214b35]">{register ? "Join the cooperative market" : "Welcome back"}</h1><p className="mt-2 text-sm leading-6 text-[#66766b]">{register ? "Create your account instantly—no confirmation email is required for this demo marketplace." : "Use your own Supabase account. Role access is still checked server-side before any operation."}</p><form onSubmit={submit} className="mt-6 space-y-4">{register && <><label className="field-label">Full name<input required className="field-control" value={name} onChange={e=>setName(e.target.value)} /></label><label className="field-label">Role<select className="field-control" value={role} onChange={e=>setRole(e.target.value)}><option value="buyer">Buyer</option><option value="seller">Seller / Farmer</option></select></label></>}<label className="field-label">Email<input required type="email" className="field-control" value={email} onChange={e=>setEmail(e.target.value)} /></label><label className="field-label">Password<input required minLength={6} type="password" className="field-control" value={password} onChange={e=>setPassword(e.target.value)} /></label><button disabled={busy} className="agri-button w-full">{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button></form><button className="mt-5 w-full text-sm font-bold text-[#3c704b]" onClick={()=>setRegister(!register)}>{register ? "Already registered? Sign in" : "New to AgriCoop? Create an account"}</button></div></main></PageFrame>;
}
