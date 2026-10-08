import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL || "";
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const isSupabaseConfigured = Boolean(url && key);
export const supabase = createClient(url || "https://supabase-not-configured.invalid", key || "supabase-not-configured");

/** Explicit logout must also remove Supabase's persisted refresh session. */
export async function clearSupabaseAuthState() {
  if (isSupabaseConfigured) await supabase.auth.signOut({ scope: "global" });
  if (typeof window === "undefined") return;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const storageKey = storage.key(index);
      if (storageKey?.startsWith("sb-") || storageKey?.includes("supabase")) storage.removeItem(storageKey);
    }
  }
}
