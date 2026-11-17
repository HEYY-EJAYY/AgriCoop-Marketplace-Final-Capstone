import { shellContainerClass, WorkspaceHeader } from "@/components/AgriShell";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatDateTimeManila } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";
import { Loader2, MessageCircle, Pin, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useSearch } from "wouter";

export default function Messages() {
  const { user, loading } = useAuth();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search.startsWith("?") ? search.slice(1) : search), [search]);
  const [selectedId, setSelectedId] = useState<number | null>(Number(params.get("id")) || null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [archivedView, setArchivedView] = useState(false);
  const [reply, setReply] = useState("");
  const utils = trpc.useUtils();
  const threadsQuery = trpc.conversations.mine.useQuery({ kind: "messages", archived: archivedView }, { enabled: !!user, refetchInterval: 15_000 });
  const threads = threadsQuery.data ?? [];
  const activeId = selectedId && threads.some(t => t.conversation.id === selectedId)
    ? selectedId
    : threads[0]?.conversation.id ?? null;
  const messagesQuery = trpc.conversations.messages.useQuery(
    { conversationId: activeId! },
    { enabled: !!activeId, refetchInterval: 5_000 },
  );
  const send = trpc.conversations.send.useMutation({
    onSuccess: () => {
      setReply("");
      void utils.conversations.messages.invalidate({ conversationId: activeId! });
      void utils.conversations.mine.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const inbox = trpc.conversations.updateInbox.useMutation({
    onSuccess: () => {
      setSelectedIds([]);
      void utils.conversations.mine.invalidate();
      toast.success("Inbox updated.");
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });

  useEffect(() => {
    const id = Number(params.get("id"));
    if (Number.isFinite(id) && id > 0) setSelectedId(id);
  }, [params]);

  if (loading) return <div className="grid min-h-screen place-items-center bg-[#f8f5ee]"><Loader2 className="animate-spin text-[#4e8257]" /></div>;
  if (!user) {
    return (
      <>
        <WorkspaceHeader title="Messages" description="Sign in to view buyer–seller order chats." />
        <main className={`${shellContainerClass} py-10`}><div className="agri-card p-8 text-center"><MessageCircle className="mx-auto text-[#6d9852]" /><h1 className="mt-4 font-display text-3xl font-bold text-[#254f37]">Sign in to open messages</h1></div></main>
      </>
    );
  }

  const toggleAll = () => {
    if (selectedIds.length === threads.length) setSelectedIds([]);
    else setSelectedIds(threads.map(t => t.conversation.id));
  };

  const runBulk = (action: "read" | "pin" | "unpin" | "archive" | "unarchive" | "delete" | "restore") => {
    if (!selectedIds.length) return toast.error("Select at least one conversation.");
    inbox.mutate({ threadIds: selectedIds, action });
  };

  return (
    <>
      <WorkspaceHeader title="Messages" description="Order and listing chats between buyers and sellers. Platform help lives under Support; formal cases live under Tickets." />
      <main className={`${shellContainerClass} py-8`}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button type="button" className={`min-h-11 rounded-xl px-3 text-sm font-bold ${!archivedView ? "bg-[#1f4f36] text-white" : "bg-[#edf3e9] text-[#315640]"}`} onClick={() => setArchivedView(false)}>Inbox</button>
          <button type="button" className={`min-h-11 rounded-xl px-3 text-sm font-bold ${archivedView ? "bg-[#1f4f36] text-white" : "bg-[#edf3e9] text-[#315640]"}`} onClick={() => setArchivedView(true)}>Archived</button>
          {!archivedView && (
            <button
              type="button"
              className="agri-ghost min-h-11 text-xs"
              onClick={() => {
                const unread = threads.filter(t => t.inbox?.isRead === 0).map(t => t.conversation.id);
                if (!unread.length) return toast.message("No unread conversations.");
                inbox.mutate({ threadIds: unread, action: "read" });
              }}
            >
              Read all
            </button>
          )}
        </div>
        {selectedIds.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2 rounded-xl border border-[#dce4d6] bg-[#fffdf8] p-3">
            <span className="self-center text-sm font-bold text-[#315640]">{selectedIds.length} selected</span>
            {!archivedView ? (
              <>
                <button type="button" className="agri-ghost min-h-11 text-xs" onClick={() => runBulk("read")}>Mark read</button>
                <button type="button" className="agri-ghost min-h-11 text-xs" onClick={() => runBulk("pin")}>Pin</button>
                <button type="button" className="agri-ghost min-h-11 text-xs" onClick={() => runBulk("unpin")}>Unpin</button>
                <button type="button" className="agri-ghost min-h-11 text-xs" onClick={() => runBulk("archive")}>Archive</button>
                <button type="button" className="agri-ghost min-h-11 text-xs text-[#a34838]" onClick={() => runBulk("delete")}>Delete</button>
              </>
            ) : (
              <>
                <button type="button" className="agri-ghost min-h-11 text-xs" onClick={() => runBulk("unarchive")}>Unarchive</button>
                <button type="button" className="agri-ghost min-h-11 text-xs" onClick={() => runBulk("restore")}>Restore</button>
              </>
            )}
          </div>
        )}
        <div className="grid gap-7 lg:grid-cols-[320px_1fr]">
          <aside className="agri-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#e3e9de] p-3">
              <h2 className="font-display text-lg font-bold text-[#264f37]">Conversations</h2>
              <label className="flex items-center gap-2 text-xs font-bold text-[#56705c]">
                <input type="checkbox" checked={threads.length > 0 && selectedIds.length === threads.length} onChange={toggleAll} />
                Select all
              </label>
            </div>
            {threadsQuery.isLoading ? <Loader2 className="mx-auto my-8 animate-spin text-[#5d8a5e]" /> : threads.length ? (
              <div>
                {threads.map(row => {
                  const unread = row.inbox?.isRead === 0;
                  const pinned = !!row.inbox?.pinnedAt;
                  return (
                    <div key={row.conversation.id} className={`flex items-start gap-2 border-b border-[#edf0e9] p-3 ${row.conversation.id === activeId ? "bg-[#edf4e9]" : unread ? "bg-[#f7fbf4]" : ""}`}>
                      <input type="checkbox" className="mt-1" checked={selectedIds.includes(row.conversation.id)} onChange={() => setSelectedIds(ids => ids.includes(row.conversation.id) ? ids.filter(id => id !== row.conversation.id) : [...ids, row.conversation.id])} />
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setSelectedId(row.conversation.id); if (unread) inbox.mutate({ threadIds: [row.conversation.id], action: "read" }); }}>
                        <p className={`flex items-center gap-1 ${unread ? "font-extrabold" : "font-bold"} text-[#315640]`}>
                          {pinned && <Pin size={12} />}
                          {row.conversation.subject}
                        </p>
                        <p className="mt-1 text-xs text-[#718074]">
                          {row.conversation.orderId ? `Order #${row.conversation.orderId} · ` : ""}
                          {row.productName ? `${row.productName} · ` : ""}
                          {formatDateTimeManila(row.conversation.updatedAt)}
                        </p>
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : <p className="p-5 text-sm text-[#6d7d70]">No order chats yet. Open Message from an order or product.</p>}
          </aside>
          <section className="agri-card flex min-h-[540px] flex-col p-5 sm:p-6">
            {activeId ? (
              <>
                <div className="border-b border-[#e3e9de] pb-4">
                  <p className="text-xs font-extrabold uppercase tracking-[.13em] text-[#6d9147]">Order inquiry</p>
                  <h2 className="mt-1 font-display text-2xl font-bold text-[#264f37]">{threads.find(t => t.conversation.id === activeId)?.conversation.subject}</h2>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto py-5">
                  {messagesQuery.isLoading ? <Loader2 className="mx-auto my-8 animate-spin text-[#5d8a5e]" /> : (messagesQuery.data ?? []).map(row => (
                    <div key={row.message.id} className={`max-w-[85%] rounded-2xl p-4 ${row.message.senderId === user.id ? "ml-auto bg-[#e7f1df]" : "bg-[#f2f6ef]"}`}>
                      <p className="text-xs font-bold text-[#52725a]">{row.senderName || "Member"}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#385644]">{row.message.body}</p>
                      <p className="mt-2 text-[11px] text-[#78907d]">{formatDateTimeManila(row.message.createdAt)}</p>
                    </div>
                  ))}
                </div>
                <form onSubmit={e => { e.preventDefault(); send.mutate({ conversationId: activeId, body: reply }); }} className="flex gap-2 border-t border-[#e3e9de] pt-4">
                  <textarea required maxLength={2000} className="field-control min-h-12 flex-1 resize-none" value={reply} onChange={e => setReply(e.target.value)} placeholder="Write a message…" />
                  <button className="agri-button min-h-11 self-end" disabled={send.isPending}>{send.isPending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}</button>
                </form>
              </>
            ) : (
              <div className="grid flex-1 place-items-center text-center">
                <div>
                  <MessageCircle className="mx-auto text-[#7ba15b]" size={38} />
                  <h2 className="mt-4 font-display text-2xl font-bold text-[#264f37]">Your message inbox</h2>
                  <p className="mt-2 text-sm text-[#6d7d70]">Buyer–seller chats for orders and listings appear here.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
