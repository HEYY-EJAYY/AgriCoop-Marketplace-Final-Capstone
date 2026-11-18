import { PageFrame, marketingShellClass } from "@/components/AgriShell";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatDateTimeManila } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { supabase } from "@/lib/supabase";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";
import { useEffect, useMemo, useState } from "react";
import { Loader2, MessageCircle, Pin, Send } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function Support() {
  const { user, loading } = useAuth();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [archivedView, setArchivedView] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const utils = trpc.useUtils();
  const threadsQuery = trpc.conversations.mine.useQuery(
    { kind: "support", archived: archivedView },
    { enabled: !!user, refetchInterval: 15_000 },
  );
  const threads = threadsQuery.data ?? [];
  const activeId = selectedId && threads.some(t => t.conversation.id === selectedId)
    ? selectedId
    : threads[0]?.conversation.id ?? null;
  const messagesQuery = trpc.conversations.messages.useQuery(
    { conversationId: activeId! },
    { enabled: !!activeId, refetchInterval: 5_000, refetchOnWindowFocus: true },
  );
  const create = trpc.conversations.create.useMutation({
    onSuccess: data => {
      setSubject("");
      setBody("");
      setSelectedId(data.conversationId);
      void utils.conversations.mine.invalidate();
      toast.success("Inquiry sent to AgriCoop support.");
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
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
    if (!activeId) return;
    let cancelled = false;
    let controller: AbortController | null = null;
    let retryTimer: number | null = null;
    let retryDelay = 1_000;
    const connect = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session?.access_token) throw new Error("No active session.");
        controller = new AbortController();
        const response = await fetch(`/api/conversations/${activeId}/stream`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error("Conversation stream is unavailable.");
        retryDelay = 1_000;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const eventName = block.split("\n").find(line => line.startsWith("event:"))?.slice(6).trim();
            if (eventName === "message") {
              void utils.conversations.messages.invalidate({ conversationId: activeId });
              void utils.conversations.mine.invalidate();
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
        if (!cancelled) throw new Error("Conversation stream closed.");
      } catch {
        if (!cancelled) {
          retryTimer = window.setTimeout(() => void connect(), retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30_000);
        }
      }
    };
    void connect();
    return () => {
      cancelled = true;
      controller?.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [activeId, utils]);

  const toggleAll = () => {
    if (selectedIds.length === threads.length) setSelectedIds([]);
    else setSelectedIds(threads.map(t => t.conversation.id));
  };

  const runBulk = (action: "read" | "pin" | "unpin" | "archive" | "unarchive" | "delete" | "restore") => {
    if (!selectedIds.length) return toast.error("Select at least one conversation.");
    inbox.mutate({ threadIds: selectedIds, action });
  };

  const activeThread = useMemo(() => threads.find(row => row.conversation.id === activeId), [threads, activeId]);

  if (loading) {
    return (
      <PageFrame>
        <main className={`${marketingShellClass} py-16`}>
          <div className="grid min-h-[40vh] place-items-center" data-testid="support-auth-loading">
            <Loader2 className="animate-spin text-[#4e8257]" aria-label="Loading" />
          </div>
        </main>
      </PageFrame>
    );
  }

  if (!user) {
    return (
      <PageFrame>
        <main className={`${marketingShellClass} py-10`}>
          <div className="agri-card p-8 text-center">
            <MessageCircle className="mx-auto text-[#6d9852]" />
            <h1 className="mt-4 font-display text-3xl font-bold text-[#254f37]">Sign in to open an inquiry</h1>
            <p className="mt-2 text-sm text-[#6d7d70]">Order coordination with sellers belongs under Messages, not here.</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link href="/auth" className="agri-ghost inline-flex min-h-11 items-center no-underline">Login</Link>
              <Link href="/auth?register=1" className="agri-button inline-flex min-h-11 items-center no-underline">Join AgriCoop</Link>
            </div>
          </div>
        </main>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <main className={`${marketingShellClass} py-8`}>
        <div className="mb-6">
          <p className="text-sm font-extrabold uppercase tracking-[.13em] text-[#668d49]">Platform support</p>
          <h1 className="mt-1 font-display text-3xl font-bold text-[#244e36]">Account and platform help</h1>
          <p className="mt-2 max-w-2xl text-sm text-[#6d7d70]">
            Account, billing, and AgriCoop platform help. For buyer–seller order chat, use Messages instead.
          </p>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button type="button" className={`min-h-11 rounded-xl px-3 text-sm font-bold ${!archivedView ? "bg-[#1f4f36] text-white" : "bg-[#edf3e9] text-[#315640]"}`} onClick={() => setArchivedView(false)}>Inbox</button>
          <button type="button" className={`min-h-11 rounded-xl px-3 text-sm font-bold ${archivedView ? "bg-[#1f4f36] text-white" : "bg-[#edf3e9] text-[#315640]"}`} onClick={() => setArchivedView(true)}>Archived</button>
        </div>
        {selectedIds.length > 0 && (
          <div className="sticky top-0 z-10 mb-4 flex flex-wrap gap-2 rounded-xl border border-[#dce4d6] bg-[#fffdf8] p-3">
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
          <aside className="space-y-5">
            <form
              onSubmit={event => {
                event.preventDefault();
                create.mutate({ subject, body });
              }}
              className="agri-card p-5"
            >
              <h2 className="font-display text-xl font-bold text-[#264f37]">New inquiry</h2>
              <p className="mt-1 text-xs text-[#718074]">Platform help only — not for messaging sellers about an order.</p>
              <label className="field-label mt-4">
                Subject
                <input required maxLength={180} className="field-control" value={subject} onChange={event => setSubject(event.target.value)} placeholder="e.g. Account access" />
              </label>
              <label className="field-label mt-4">
                Message
                <textarea required maxLength={2000} className="field-control min-h-24 resize-y" value={body} onChange={event => setBody(event.target.value)} placeholder="Tell support what you need." />
              </label>
              <button className="agri-button mt-4 w-full min-h-11 text-sm" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />} Send to support
              </button>
            </form>
            <div className="agri-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-[#e3e9de] p-4">
                <h2 className="font-display text-lg font-bold text-[#264f37]">Conversations</h2>
                <label className="flex items-center gap-2 text-xs font-bold text-[#56705c]">
                  <input type="checkbox" checked={threads.length > 0 && selectedIds.length === threads.length} onChange={toggleAll} />
                  Select all
                </label>
              </div>
              <p className="border-b border-[#e3e9de] px-4 pb-3 text-xs text-[#718074]">Admins can see and reply to platform inquiries.</p>
              {threadsQuery.isLoading ? <Loader2 className="mx-auto my-8 animate-spin text-[#5d8a5e]" /> : threads.length ? (
                <div>
                  {threads.map(row => {
                    const unread = row.inbox?.isRead === 0;
                    const pinned = !!row.inbox?.pinnedAt;
                    return (
                      <div key={row.conversation.id} className={`flex items-start gap-2 border-b border-[#edf0e9] p-3 ${row.conversation.id === activeId ? "bg-[#edf4e9]" : unread ? "bg-[#f7fbf4]" : ""}`}>
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selectedIds.includes(row.conversation.id)}
                          onChange={() => setSelectedIds(ids => ids.includes(row.conversation.id) ? ids.filter(id => id !== row.conversation.id) : [...ids, row.conversation.id])}
                        />
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => {
                            setSelectedId(row.conversation.id);
                            if (unread) inbox.mutate({ threadIds: [row.conversation.id], action: "read" });
                          }}
                        >
                          <p className={`flex items-center gap-1 ${unread ? "font-extrabold" : "font-bold"} text-[#315640]`}>
                            {pinned && <Pin size={12} />}
                            {row.conversation.subject}
                          </p>
                          <p className="mt-1 text-xs text-[#718074]">
                            {row.ownerName || "Member"} · {formatDateTimeManila(row.conversation.updatedAt)}
                          </p>
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="p-5 text-sm text-[#6d7d70]">No platform inquiries yet. Start one above.</p>
              )}
            </div>
          </aside>
          <section className="agri-card flex min-h-[540px] flex-col p-5 sm:p-6">
            {activeId ? (
              <>
                <div className="border-b border-[#e3e9de] pb-4">
                  <p className="text-xs font-extrabold uppercase tracking-[.13em] text-[#6d9147]">Platform support</p>
                  <h2 className="mt-1 font-display text-2xl font-bold text-[#264f37]">{activeThread?.conversation.subject ?? "Conversation"}</h2>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto py-5">
                  {messagesQuery.isLoading ? <Loader2 className="mx-auto my-8 animate-spin text-[#5d8a5e]" /> : (messagesQuery.data ?? []).length ? (messagesQuery.data ?? []).map(row => (
                    <div key={row.message.id} className={`max-w-[85%] rounded-2xl p-4 ${row.message.senderId === user.id ? "ml-auto bg-[#e7f1df]" : "bg-[#f2f6ef]"}`}>
                      <p className="text-xs font-bold text-[#52725a]">{row.senderName || "AgriCoop support"}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#385644]">{row.message.body}</p>
                      <p className="mt-2 text-[11px] text-[#78907d]" title={formatDateTimeManila(row.message.createdAt)}>{formatDateTimeManila(row.message.createdAt)}</p>
                    </div>
                  )) : <p className="text-sm text-[#6d7d70]">No messages yet.</p>}
                </div>
                <form
                  onSubmit={event => {
                    event.preventDefault();
                    send.mutate({ conversationId: activeId, body: reply });
                  }}
                  className="flex gap-2 border-t border-[#e3e9de] pt-4"
                >
                  <textarea required maxLength={2000} className="field-control min-h-12 flex-1 resize-none" value={reply} onChange={event => setReply(event.target.value)} placeholder="Reply to this conversation…" />
                  <button className="agri-button min-h-11 self-end" disabled={send.isPending}>{send.isPending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}</button>
                </form>
              </>
            ) : (
              <div className="grid flex-1 place-items-center text-center">
                <div>
                  <MessageCircle className="mx-auto text-[#7ba15b]" size={38} />
                  <h2 className="mt-4 font-display text-2xl font-bold text-[#264f37]">Your support inbox</h2>
                  <p className="mt-2 text-sm text-[#6d7d70]">Platform help threads appear here. Order chat with sellers lives under Messages.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </PageFrame>
  );
}
