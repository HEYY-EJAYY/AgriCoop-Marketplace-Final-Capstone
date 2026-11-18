import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { goToAuth } from "./const";
import { authSession, logAuthDiagnostic } from "./lib/authSession";
import { shouldRedirectToAuth } from "./lib/authSessionManager";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const redirectToLoginIfUnauthorized = (error: unknown, source: "query" | "mutation") => {
  if (!(error instanceof TRPCClientError) || typeof window === "undefined" || error.message !== UNAUTHED_ERR_MSG) return;
  const sessionState = authSession.getSnapshot();
  const shouldRedirect = shouldRedirectToAuth({
    sessionInitialized: sessionState.initialized,
    authLoading: !sessionState.initialized,
    userPresent: false,
    unauthenticated: true,
  });
  logAuthDiagnostic("unauthorized_response", {
    component: "queryClient",
    source,
    sessionInitialized: sessionState.initialized,
    accessTokenPresent: sessionState.accessTokenPresent,
    redirectScheduled: shouldRedirect,
  });
  if (!shouldRedirect) return;
  goToAuth(`queryClient.${source}`);
};
queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error, "query");
    if (error instanceof TRPCClientError) console.error("[API Query Error]", { code: error.data?.code ?? null });
  }
});
queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error, "mutation");
    if (error instanceof TRPCClientError) console.error("[API Mutation Error]", { code: error.data?.code ?? null });
  }
});

const trpcClient = trpc.createClient({
  links: [httpBatchLink({
    url: "/api/trpc",
    transformer: superjson,
    headers: async ({ opList }) => {
      const stateBeforeWait = authSession.getSnapshot();
      await authSession.waitUntilInitialized();
      const token = authSession.getAccessToken();
      const stateAtSend = authSession.getSnapshot();
      logAuthDiagnostic("trpc_request_auth_state", {
        operationPaths: opList.map(operation => operation.path).join(","),
        sessionInitializedBeforeRequest: stateBeforeWait.initialized,
        sessionInitializedBeforeSend: stateAtSend.initialized,
        accessTokenPresent: Boolean(token),
      });
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
    async fetch(input, init) {
      const friendlyMessage = "Something went wrong on our side. Please try again.";
      try {
        const response = await globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          throw new TRPCClientError(friendlyMessage);
        }
        return response;
      } catch (error) {
        if (error instanceof TRPCClientError) throw error;
        throw new TRPCClientError(friendlyMessage);
      }
    },
  })],
});

// Paint the shell immediately; tRPC headers still await authSession initialization.
logAuthDiagnostic("app_render", {
  sessionInitialized: authSession.getSnapshot().initialized,
  accessTokenPresent: authSession.getSnapshot().accessTokenPresent,
});
createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>,
);
