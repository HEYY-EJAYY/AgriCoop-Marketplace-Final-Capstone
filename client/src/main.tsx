import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { goToAuth } from "./const";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import "./index.css";

const queryClient = new QueryClient();
let supabaseAccessToken = "";
if (isSupabaseConfigured) {
  supabase.auth.getSession().then(({ data }) => { supabaseAccessToken = data.session?.access_token ?? ""; });
  supabase.auth.onAuthStateChange((_event, session) => { supabaseAccessToken = session?.access_token ?? ""; });
}

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError) || typeof window === "undefined" || error.message !== UNAUTHED_ERR_MSG) return;
  goToAuth();
};
queryClient.getQueryCache().subscribe(event => { if (event.type === "updated" && event.action.type === "error") { redirectToLoginIfUnauthorized(event.query.state.error); console.error("[API Query Error]", event.query.state.error); } });
queryClient.getMutationCache().subscribe(event => { if (event.type === "updated" && event.action.type === "error") { redirectToLoginIfUnauthorized(event.mutation.state.error); console.error("[API Mutation Error]", event.mutation.state.error); } });

const trpcClient = trpc.createClient({ links: [httpBatchLink({ url: "/api/trpc", transformer: superjson, headers: () => supabaseAccessToken ? { Authorization: `Bearer ${supabaseAccessToken}` } : {}, fetch(input, init) { return globalThis.fetch(input, { ...(init ?? {}), credentials: "include" }); } })] });

createRoot(document.getElementById("root")!).render(<trpc.Provider client={trpcClient} queryClient={queryClient}><QueryClientProvider client={queryClient}><App /></QueryClientProvider></trpc.Provider>);
