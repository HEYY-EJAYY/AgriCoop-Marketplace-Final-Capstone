import { goToAuth } from "@/const";
import { clearSupabaseAuthState } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import { authSession, logAuthDiagnostic } from "@/lib/authSession";
import { shouldRedirectToAuth } from "@/lib/authSessionManager";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

type UseAuthOptions = { redirectOnUnauthenticated?: boolean; redirectPath?: string };

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const utils = trpc.useUtils();
  const sessionState = useSyncExternalStore(authSession.subscribe, authSession.getSnapshot, authSession.getSnapshot);
  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: sessionState.initialized,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const logoutMutation = trpc.auth.logout.useMutation({ onSuccess: () => utils.auth.me.setData(undefined, null) });
  const logout = useCallback(async () => {
    try { await logoutMutation.mutateAsync(); }
    catch (error: unknown) { if (!(error instanceof TRPCClientError) || error.data?.code !== "UNAUTHORIZED") throw error; }
    finally {
      await clearSupabaseAuthState();
      utils.auth.me.setData(undefined, null);
      await utils.invalidate();
      if (typeof window !== "undefined") {
        logAuthDiagnostic("navigation_to_auth", { component: "useAuth.logout", destination: "/auth" });
        window.location.replace("/auth");
      }
    }
  }, [logoutMutation, utils]);
  const authQueryLoading = meQuery.isLoading || (!meQuery.data && meQuery.isFetching);
  const state = useMemo(() => ({
    user: meQuery.data ?? null,
    loading: !sessionState.initialized || authQueryLoading || logoutMutation.isPending,
    sessionLoading: !sessionState.initialized,
    accessTokenPresent: sessionState.accessTokenPresent,
    error: meQuery.error ?? logoutMutation.error ?? null,
    isAuthenticated: Boolean(meQuery.data),
  }), [sessionState, authQueryLoading, meQuery.data, meQuery.error, logoutMutation.error, logoutMutation.isPending]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (redirectPath && window.location.pathname === redirectPath) return;
    const shouldRedirect = shouldRedirectToAuth({
      sessionInitialized: sessionState.initialized,
      authLoading: authQueryLoading || logoutMutation.isPending,
      userPresent: Boolean(state.user),
      unauthenticated: redirectOnUnauthenticated,
    });
    if (shouldRedirect) {
      goToAuth("useAuth");
    }
  }, [redirectOnUnauthenticated, redirectPath, logoutMutation.isPending, authQueryLoading, sessionState.initialized, state.user]);
  return { ...state, refresh: () => meQuery.refetch(), logout };
}
