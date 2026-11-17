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
