import { WorkspaceHeader } from "@/components/AgriShell";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatDateTimeManila } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Redirect } from "wouter";

export default function AuditLogs() {
  const { user, loading } = useAuth();
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const filters = useMemo(() => ({
    limit: 50,
    offset: 0,
    action: action.trim() || undefined,
    entityType: entityType.trim() || undefined,
  }), [action, entityType]);
  const query = trpc.auditLogs.list.useQuery(filters, {
    enabled: !!user && (user.role === "admin" || user.role === "superadmin"),
  });

  if (loading) return <div className="grid min-h-screen place-items-center text-sm text-[#65766b]">Loading…</div>;
  if (!user) return <Redirect to="/auth" />;
  if (user.role !== "admin" && user.role !== "superadmin") return <Redirect to="/dashboard" />;

  return <>
    <WorkspaceHeader
      title="Audit logs"
      description={user.role === "superadmin"
        ? "Platform-wide append-only activity for SuperAdmin review."
        : "Cooperative-scoped append-only activity for your assigned cooperative."}
    />
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <form
        className="mb-6 flex flex-wrap gap-3 agri-card p-4"
        onSubmit={event => {
          event.preventDefault();
          void query.refetch();
        }}
      >
        <label className="field-label min-w-48 flex-1">Action filter
          <input className="field-control" value={action} onChange={e => setAction(e.target.value)} placeholder="e.g. product_approved" />
        </label>
        <label className="field-label min-w-48 flex-1">Entity type
          <input className="field-control" value={entityType} onChange={e => setEntityType(e.target.value)} placeholder="e.g. product" />
        </label>
        <button type="submit" className="agri-button self-end text-sm">Apply filters</button>
      </form>

      {query.error ? (
        <div className="agri-card p-6 text-sm text-[#a34838]" role="alert">
          <p>{query.error.message}</p>
          <button type="button" className="agri-ghost mt-3 text-xs" disabled={query.isFetching} onClick={() => void query.refetch()}>Retry</button>
        </div>
      ) : query.isLoading ? (
        <Loader2 className="mx-auto my-12 animate-spin text-[#5d8a5e]" aria-label="Loading audit logs" />
      ) : query.data?.items.length ? (
        <div className="agri-card overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-[#f1f6ee] text-xs uppercase tracking-wide text-[#718174]">
              <tr>
                <th className="p-3">When</th>
                <th className="p-3">Actor</th>
                <th className="p-3">Action</th>
                <th className="p-3">Entity</th>
                <th className="p-3">Coop</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map(row => (
                <tr key={row.id} className="border-t border-[#e3e9de]">
                  <td className="p-3 whitespace-nowrap">{formatDateTimeManila(row.createdAt)}</td>
                  <td className="p-3">{row.actorName || `User #${row.actorUserId}`}</td>
                  <td className="p-3 font-medium text-[#315640]">{row.action}</td>
                  <td className="p-3">{row.entityType}{row.entityId != null ? ` #${row.entityId}` : ""}</td>
                  <td className="p-3">{row.cooperativeId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="agri-card p-8 text-center text-sm text-[#6d7d70]">No audit events match these filters.</p>
      )}
    </main>
  </>;
}
