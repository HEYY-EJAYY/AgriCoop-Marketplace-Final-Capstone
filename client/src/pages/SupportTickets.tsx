import { WorkspaceHeader } from "@/components/AgriShell";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatDateTimeManila } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { SupportTicketStatusSelect } from "@/components/SupportTicketStatusSelect";
import { Loader2, MessageSquareText, Send } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

export default function SupportTickets() {
  const { user, loading } = useAuth();
  const isStaff = user?.role === "admin" || user?.role === "superadmin";
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("general");
  const [description, setDescription] = useState("");
  const [supportCooperativeId, setSupportCooperativeId] = useState<number | null>(null);
  const [supportQueueInitialized, setSupportQueueInitialized] = useState(false);
  const [reply, setReply] = useState("");
  const utils = trpc.useUtils();
  const cooperatives = trpc.cooperatives.list.useQuery(undefined, {
    enabled: !!user && !isStaff,
  });
  const mine = trpc.support.myTickets.useQuery(undefined, { enabled: !!user && !isStaff });
  const managed = trpc.support.listAll.useQuery(undefined, { enabled: !!user && !!isStaff });
  const tickets = isStaff
    ? (managed.data ?? []).map(({ ticket, userName, assignedToName }) => ({ ...ticket, userName: userName ?? null, assignedToName: assignedToName ?? null }))
    : (mine.data ?? []).map(ticket => ({ ...ticket, userName: null, assignedToName: null }));
  const activeTicket = tickets.find(ticket => ticket.id === selectedId);
  const assignableUsers = trpc.support.assignableUsers.useQuery(
    { ticketId: selectedId ?? 0 },
    { enabled: !!selectedId && !!user && isStaff },
  );
  const messages = trpc.support.messages.useQuery(
    { ticketId: selectedId ?? 0 },
    { enabled: !!selectedId && !!user },
  );
  const create = trpc.support.createTicket.useMutation({
    onSuccess: async result => {
      toast.success("Support ticket submitted.");
      setSubject("");
      setCategory("general");
      setDescription("");
      setSelectedId(result.ticketId);
      await Promise.all([utils.support.myTickets.invalidate(), utils.support.listAll.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });
  const sendReply = trpc.support.reply.useMutation({
    onSuccess: async () => {
      setReply("");
      await Promise.all([
        utils.support.messages.invalidate({ ticketId: selectedId ?? 0 }),
        utils.support.myTickets.invalidate(),
        utils.support.listAll.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });
  const updateStatus = trpc.support.updateStatus.useMutation({
    onSuccess: async () => {
      toast.success("Ticket status updated.");
      await Promise.all([utils.support.myTickets.invalidate(), utils.support.listAll.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });
  const assignTicket = trpc.support.assign.useMutation({
    onSuccess: async () => {
      toast.success("Support ticket assignment updated.");
      await utils.support.listAll.invalidate();
      await assignableUsers.refetch();
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (!tickets.some(ticket => ticket.id === selectedId)) {
      setSelectedId(tickets[0]?.id ?? null);
    }
  }, [selectedId, tickets]);

  useEffect(() => {
    if (!loading && user && !supportQueueInitialized) {
      setSupportCooperativeId(user.cooperativeId);
      setSupportQueueInitialized(true);
    }
  }, [loading, supportQueueInitialized, user]);

  if (loading) return <div className="grid min-h-screen place-items-center bg-[#f8f5ee]"><Loader2 className="animate-spin text-[#4e8257]"/></div>;
  if (!user) return <><WorkspaceHeader title="Support tickets" description="Sign in to open or follow a support request."/><main className="mx-auto max-w-3xl px-4 py-10"><div className="agri-card p-8 text-center"><MessageSquareText className="mx-auto text-[#6d9852]"/><h1 className="mt-4 font-display text-3xl font-bold text-[#254f37]">Sign in to view support tickets</h1><a href="/auth" className="agri-button mt-6 inline-flex no-underline">Sign in</a></div></main></>;

  const ticketsLoading = isStaff ? managed.isLoading : mine.isLoading;
  const ticketError = isStaff ? managed.error : mine.error;
  return <>
    <WorkspaceHeader title="Support tickets" description="Follow replies and status updates for marketplace support requests."/>
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[320px_1fr] lg:px-8">
      <aside className="space-y-5">
        {!isStaff && <form className="agri-card p-5" onSubmit={(event: FormEvent) => {
          event.preventDefault();
          create.mutate({ subject, category, description, priority: "medium", cooperativeId: supportCooperativeId });
        }}>
          <h2 className="font-display text-xl font-bold text-[#264f37]">Open a ticket</h2>
          <label className="field-label mt-4">Subject<input required maxLength={255} className="field-control" value={subject} onChange={event => setSubject(event.target.value)}/></label>
          <label className="field-label mt-3">Category<select className="field-control" value={category} onChange={event => setCategory(event.target.value)}>
            <option value="general">General</option>
            <option value="orders">Orders</option>
            <option value="payments">Payments</option>
            <option value="account">Account</option>
            <option value="technical">Technical issue</option>
          </select></label>
          <label className="field-label mt-3">Support queue<select className="field-control" value={supportCooperativeId ?? ""} onChange={event => setSupportCooperativeId(event.target.value ? Number(event.target.value) : null)}>
            <option value="">Platform-wide support</option>
            {(cooperatives.data ?? []).map(cooperative => <option key={cooperative.id} value={cooperative.id}>{cooperative.name}</option>)}
          </select></label>
          <p className="mt-1 text-xs text-[#718074]">Choose the cooperative related to your request. Platform-wide tickets are handled by SuperAdmins.</p>
          {cooperatives.error && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#a34838]"><span role="alert">Cooperative queues could not be loaded: {cooperatives.error.message}</span><button type="button" className="agri-ghost px-2 py-1" disabled={cooperatives.isFetching} onClick={() => void cooperatives.refetch()}>Retry</button></div>}
          <label className="field-label mt-3">Describe the issue<textarea required maxLength={5000} className="field-control min-h-24" value={description} onChange={event => setDescription(event.target.value)}/></label>
          <button className="agri-button mt-4 w-full text-sm" disabled={create.isPending}>{create.isPending ? <Loader2 className="animate-spin" size={16}/> : <Send size={16}/>} Submit ticket</button>
        </form>}
        <div className="agri-card overflow-hidden">
          <div className="border-b border-[#e3e9de] p-4"><h2 className="font-display text-xl font-bold text-[#264f37]">{isStaff ? "Tickets in your scope" : "Your tickets"}</h2></div>
          {ticketsLoading ? <Loader2 className="mx-auto my-8 animate-spin text-[#5d8a5e]"/> : ticketError ? <div className="p-4 text-sm text-[#a34838]"><p role="alert">{ticketError.message}</p><button type="button" className="agri-ghost mt-2 text-xs" disabled={isStaff ? managed.isFetching : mine.isFetching} onClick={() => void (isStaff ? managed.refetch() : mine.refetch())}>Retry</button></div> : tickets.length ? tickets.map(ticket => <button key={ticket.id} onClick={() => setSelectedId(ticket.id)} className={`w-full border-b border-[#edf0e9] p-4 text-left hover:bg-[#f1f6ee] ${ticket.id === selectedId ? "bg-[#edf4e9]" : ""}`}>
            <p className="font-bold text-[#315640]">{ticket.subject}</p>
            <p className="mt-1 text-xs text-[#718074]">{isStaff ? ticket.userName || "Member" : ticket.category} · {ticket.status}</p>
            <p className="mt-1 text-xs text-[#718074]">{formatDateTimeManila(ticket.updatedAt)}</p>
          </button>) : <p className="p-5 text-sm text-[#6d7d70]">No tickets yet.</p>}
        </div>
      </aside>
      <section className="agri-card flex min-h-[560px] flex-col p-5 sm:p-6">
        {activeTicket ? <>
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e3e9de] pb-4">
            <div><p className="text-xs font-extrabold uppercase tracking-[.13em] text-[#6d9147]">Ticket #{activeTicket.id}</p><h1 className="mt-1 font-display text-2xl font-bold text-[#264f37]">{activeTicket.subject}</h1><p className="mt-1 text-sm text-[#65766b]">{activeTicket.category} · {activeTicket.priority}</p></div>
            {isStaff && <div className="flex flex-wrap gap-3">
              <label className="field-label mt-0">Status<SupportTicketStatusSelect
                status={activeTicket.status}
                disabled={updateStatus.isPending}
                onChange={status => updateStatus.mutate({ ticketId: activeTicket.id, status })}
              /></label>
              <label className="field-label mt-0">Assigned support officer<select className="field-control" value={activeTicket.assignedToUserId ?? ""} onChange={event => assignTicket.mutate({ ticketId: activeTicket.id, assignedToUserId: event.target.value ? Number(event.target.value) : null })} disabled={assignTicket.isPending || assignableUsers.isLoading}>
                <option value="">Unassigned</option>
                {activeTicket.assignedToUserId && !assignableUsers.data?.some(candidate => candidate.id === activeTicket.assignedToUserId) && <option value={activeTicket.assignedToUserId}>{activeTicket.assignedToName || "Current assignee"}</option>}
                {(assignableUsers.data ?? []).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.role}</option>)}
              </select>
                {assignableUsers.error && <span className="mt-1 block text-xs text-[#a34838]"><span role="alert">{assignableUsers.error.message}</span> <button type="button" className="agri-ghost px-2 py-1" disabled={assignableUsers.isFetching} onClick={() => void assignableUsers.refetch()}>Retry</button></span>}
              </label>
            </div>}
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto py-5">
            {messages.isLoading ? <Loader2 className="mx-auto my-8 animate-spin text-[#5d8a5e]"/> : messages.error ? <div className="text-sm text-[#a34838]"><p role="alert">{messages.error.message}</p><button type="button" className="agri-ghost mt-2 text-xs" disabled={messages.isFetching} onClick={() => void messages.refetch()}>Retry</button></div> : messages.data?.length ? messages.data.map(row => <article key={row.message.id} className={`max-w-[85%] rounded-2xl p-4 ${row.message.senderId === user.id ? "ml-auto bg-[#e7f1df]" : "bg-[#f2f6ef]"}`}>
              <p className="text-xs font-bold text-[#52725a]">{row.senderName || "Support"}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#385644]">{row.message.body}</p><p className="mt-2 text-[11px] text-[#78907d]">{formatDateTimeManila(row.message.createdAt)}</p>
            </article>) : <p className="text-sm text-[#6d7d70]">No messages yet.</p>}
          </div>
          <form className="flex gap-2 border-t border-[#e3e9de] pt-4" onSubmit={event => {
            event.preventDefault();
            sendReply.mutate({ ticketId: activeTicket.id, body: reply });
          }}>
            <textarea required maxLength={2000} className="field-control min-h-12 flex-1 resize-none" value={reply} onChange={event => setReply(event.target.value)} placeholder="Reply to this ticket…" disabled={activeTicket.status === "closed"}/>
            <button className="agri-button self-end" disabled={sendReply.isPending || activeTicket.status === "closed"} aria-label="Send ticket reply"><Send size={16}/></button>
          </form>
        </> : <div className="grid flex-1 place-items-center text-center"><div><MessageSquareText className="mx-auto text-[#7ba15b]" size={38}/><h2 className="mt-4 font-display text-2xl font-bold text-[#264f37]">{isStaff ? "Ticket management" : "Support inbox"}</h2><p className="mt-2 text-sm text-[#6d7d70]">Replies and ticket status are kept with the support request.</p></div></div>}
      </section>
    </main>
  </>;
}
