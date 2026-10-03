import { WorkspaceHeader } from "@/components/AgriShell";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";

const when = (value: Date | string) => new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });

export default function Support() {
  const { user, loading } = useAuth();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const { data: threads = [], isLoading: threadsLoading } = trpc.conversations.mine.useQuery(undefined, { enabled: !!user });
  const activeId = selectedId ?? threads[0]?.conversation.id ?? null;
  const { data: messages = [], isLoading: messagesLoading } = trpc.conversations.messages.useQuery({ conversationId: activeId! }, { enabled: !!activeId });
  const utils = trpc.useUtils();
  const create = trpc.conversations.create.useMutation({ onSuccess: data => { setSubject(""); setBody(""); setSelectedId(data.conversationId); utils.conversations.mine.invalidate(); toast.success("Inquiry sent to AgriCoop support."); }, onError: error => toast.error(error.message) });
  const send = trpc.conversations.send.useMutation({ onSuccess: () => { setReply(""); utils.conversations.messages.invalidate({ conversationId: activeId! }); utils.conversations.mine.invalidate(); }, onError: error => toast.error(error.message) });
  useEffect(() => {
    if (!activeId) return;
    let source: EventSource | null = null;
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled || !data.session?.access_token) return;
      source = new EventSource(`/api/conversations/${activeId}/stream?access_token=${encodeURIComponent(data.session.access_token)}`);
      source.addEventListener("message", () => { utils.conversations.messages.invalidate({ conversationId: activeId }); utils.conversations.mine.invalidate(); });
    });
    return () => { cancelled = true; source?.close(); };
  }, [activeId, utils]);

  if (loading) return <div className="grid min-h-screen place-items-center bg-[#f8f5ee]"><Loader2 className="animate-spin text-[#4e8257]" /></div>;
  if (!user) return <><WorkspaceHeader title="Support and inquiries" description="Sign in to contact AgriCoop support." /><main className="mx-auto max-w-3xl px-4 py-10"><div className="agri-card p-8 text-center"><MessageCircle className="mx-auto text-[#6d9852]" /><h1 className="mt-4 font-display text-3xl font-bold text-[#254f37]">Sign in to open an inquiry</h1></div></main></>;

  return <><WorkspaceHeader title="Support and inquiries" description="Keep order, quotation, payment coordination, and handover questions in one simple conversation." /><main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"><div className="grid gap-7 lg:grid-cols-[300px_1fr]"><aside className="space-y-5"><form onSubmit={event => { event.preventDefault(); create.mutate({ subject, body }); }} className="agri-card p-5"><h2 className="font-display text-xl font-bold text-[#264f37]">New inquiry</h2><label className="field-label mt-4">Subject<input required maxLength={180} className="field-control" value={subject} onChange={event => setSubject(event.target.value)} placeholder="e.g. Pickup schedule" /></label><label className="field-label mt-4">Message<textarea required maxLength={2000} className="field-control min-h-24 resize-y" value={body} onChange={event => setBody(event.target.value)} placeholder="Tell support what you need." /></label><button className="agri-button mt-4 w-full text-sm" disabled={create.isPending}>{create.isPending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />} Send to support</button></form><div className="agri-card overflow-hidden"><div className="border-b border-[#e3e9de] p-4"><h2 className="font-display text-xl font-bold text-[#264f37]">Conversations</h2><p className="mt-1 text-xs text-[#718074]">Admins can see and reply to every inquiry.</p></div>{threadsLoading ? <Loader2 className="mx-auto my-8 animate-spin text-[#5d8a5e]" /> : threads.length ? <div>{threads.map(row => <button key={row.conversation.id} onClick={() => setSelectedId(row.conversation.id)} className={`w-full border-b border-[#edf0e9] p-4 text-left transition hover:bg-[#f1f6ee] ${row.conversation.id === activeId ? "bg-[#edf4e9]" : ""}`}><p className="font-bold text-[#315640]">{row.conversation.subject}</p><p className="mt-1 text-xs text-[#718074]">{row.ownerName || "Member"} · {when(row.conversation.updatedAt)}</p></button>)}</div> : <p className="p-5 text-sm text-[#6d7d70]">No conversations yet. Start an inquiry above.</p>}</div></aside><section className="agri-card flex min-h-[540px] flex-col p-5 sm:p-6">{activeId ? <><div className="border-b border-[#e3e9de] pb-4"><p className="text-xs font-extrabold uppercase tracking-[.13em] text-[#6d9147]">Support thread</p><h2 className="mt-1 font-display text-2xl font-bold text-[#264f37]">{threads.find(row => row.conversation.id === activeId)?.conversation.subject || "Conversation"}</h2></div><div className="flex-1 space-y-3 overflow-y-auto py-5">{messagesLoading ? <Loader2 className="mx-auto my-8 animate-spin text-[#5d8a5e]" /> : messages.length ? messages.map(row => <div key={row.message.id} className={`max-w-[85%] rounded-2xl p-4 ${row.message.senderId === user.id ? "ml-auto bg-[#e7f1df]" : "bg-[#f2f6ef]"}`}><p className="text-xs font-bold text-[#52725a]">{row.senderName || "AgriCoop support"}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#385644]">{row.message.body}</p><p className="mt-2 text-[11px] text-[#78907d]">{when(row.message.createdAt)}</p></div>) : <p className="text-sm text-[#6d7d70]">No messages yet.</p>}</div><form onSubmit={event => { event.preventDefault(); send.mutate({ conversationId: activeId, body: reply }); }} className="flex gap-2 border-t border-[#e3e9de] pt-4"><textarea required maxLength={2000} className="field-control min-h-12 flex-1 resize-none" value={reply} onChange={event => setReply(event.target.value)} placeholder="Reply to this conversation..." /><button className="agri-button self-end" disabled={send.isPending}>{send.isPending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}</button></form></> : <div className="grid flex-1 place-items-center text-center"><div><MessageCircle className="mx-auto text-[#7ba15b]" size={38} /><h2 className="mt-4 font-display text-2xl font-bold text-[#264f37]">Your support inbox</h2><p className="mt-2 text-sm text-[#6d7d70]">Order and quotation requests will open a conversation here automatically.</p></div></div>}</section></div></main></>;
}
