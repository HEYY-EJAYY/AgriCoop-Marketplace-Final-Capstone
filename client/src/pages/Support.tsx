import { useAuth } from "@/_core/hooks/useAuth";
import { WorkspaceHeader } from "@/components/AgriShell";
import { AlertCircle, Loader2, MessageCircle } from "lucide-react";

export default function Support() {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="grid min-h-screen place-items-center bg-[#f8f5ee]">
        <Loader2 className="animate-spin text-[#4e8257]" />
      </div>
    );
  if (!user)
    return (
      <>
        <WorkspaceHeader
          title="Support and inquiries"
          description="Sign in to contact AgriCoop support."
        />
        <main className="mx-auto max-w-3xl px-4 py-10">
          <div className="agri-card p-8 text-center">
            <MessageCircle className="mx-auto text-[#6d9852]" />
            <h1 className="mt-4 font-display text-3xl font-bold text-[#254f37]">
              Sign in to open an inquiry
            </h1>
            <p className="mt-3 text-[#65766b]">
              Support messaging is not available to anonymous visitors.
            </p>
          </div>
        </main>
      </>
    );
  return (
    <>
      <WorkspaceHeader
        title="Support and inquiries"
        description="Keep order, quotation, payment coordination, and handover questions in one simple conversation."
      />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="agri-card p-8 text-center">
          <AlertCircle className="mx-auto text-[#a34838]" />
          <h1 className="mt-4 font-display text-2xl font-bold text-[#254f37]">
            Support messaging needs a database decision
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#65766b]">
            The live Supabase schema does not contain conversation or message
            tables. The legacy MySQL support endpoints were disabled during this
            repair so the application cannot create or display records in a
            database that is not configured.
          </p>
          <p className="mt-4 text-sm leading-6 text-[#65766b]">
            Orders and quotations remain available through the marketplace and
            cooperative workspaces. A conversation schema and row-level security
            policy are required before this inbox can be re-enabled.
          </p>
        </div>
      </main>
    </>
  );
}
