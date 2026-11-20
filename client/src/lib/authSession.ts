import { isSupabaseConfigured, supabase } from "./supabase";
import { createAuthSessionManager, type AuthSessionDiagnostic } from "./authSessionManager";

export const authDiagnosticsEnabled = import.meta.env.DEV || import.meta.env.VITE_AUTH_DIAGNOSTICS === "true";

export function logAuthDiagnostic(event: string, details: Record<string, boolean | string | null> = {}) {
  if (authDiagnosticsEnabled) {
    console.info("[AuthDiagnostic]", { event, ...details });
  }
}

function logSessionDiagnostic(diagnostic: AuthSessionDiagnostic) {
  logAuthDiagnostic(diagnostic.event, {
    sessionPresent: diagnostic.sessionPresent,
    accessTokenPresent: diagnostic.accessTokenPresent,
    ...(diagnostic.authEvent ? { authEvent: diagnostic.authEvent } : {}),
    ...(diagnostic.errorPresent !== undefined ? { errorPresent: diagnostic.errorPresent } : {}),
  });
}

export const authSession = createAuthSessionManager(
  isSupabaseConfigured
    ? {
        getSession: async () => {
          const { data, error } = await supabase.auth.getSession();
          return { session: data.session, errorPresent: Boolean(error) };
        },
        onAuthStateChange: callback => {
          const { data } = supabase.auth.onAuthStateChange((event, session) => callback(event, session));
          return () => data.subscription.unsubscribe();
        },
      }
    : null,
  logSessionDiagnostic,
);

// Supabase redirects recovery/verification links to the project Site URL,
// which is not necessarily /auth. PASSWORD_RECOVERY means a recovery session
// was established from the link hash; send the user to the reset form.
// Error redirects (expired/invalid links) carry error params in the URL and
// are surfaced on /auth instead of leaving the user on an unrelated page.
if (isSupabaseConfigured && typeof window !== "undefined") {
  supabase.auth.onAuthStateChange(event => {
    if (event !== "PASSWORD_RECOVERY") return;
    if (window.location.pathname === "/auth" && new URLSearchParams(window.location.search).get("recovery") === "1") return;
    window.location.assign("/auth?recovery=1");
  });
  const url = window.location;
  const hasErrorParams = /(?:^|[#?&])(?:error|error_code)=/.test(url.hash) || /[?&](?:error|error_code)=/.test(url.search);
  if (hasErrorParams && url.pathname !== "/auth") {
    url.pathname = "/auth";
  }
}
