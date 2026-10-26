import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { adminApi, type ConversationRow } from "../../lib/admin";
import { ApiError } from "../../lib/api";
import { Badge, EmptyState, ErrorNote, FilterButtons, LoadingState, Modal, PageHeading, SearchField } from "../../components/ui";
import { IconArrowRight, IconChat, IconPhone } from "../../components/icons";
import { formatDateTime, relativeTime } from "../../lib/format";

interface Transcript {
  conversation: ConversationRow;
  messages: Array<{ id: string; role: string; content: string; contentType: string; createdAt: string }> | null;
  error?: string;
}

export default function Conversations() {
  const { user } = useAdminAuth();
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Transcript | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const transcriptRequest = useRef(0);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    adminApi.conversations(user.token).then(result => { if (!cancelled) setRows(result.conversations); })
      .catch(err => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load conversations."); });
    return () => { cancelled = true; transcriptRequest.current++; };
  }, [user]);

  async function openTranscript(conversation: ConversationRow) {
    if (!user) return;
    const request = ++transcriptRequest.current;
    setOpen({ conversation, messages: null });
    try {
      const result = await adminApi.transcript(user.token, conversation.id);
      if (request === transcriptRequest.current) setOpen({ conversation, messages: result.messages });
    } catch (err) {
      if (request === transcriptRequest.current) setOpen({ conversation, messages: [], error: err instanceof ApiError ? err.message : "Couldn't load this transcript." });
    }
  }
  const visible = (rows ?? []).filter(row => (filter === "all" || row.status === filter) &&
    `${row.id} ${row.channel} ${row.status}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return <>
    <PageHeading title="Conversations" sub="The full conversation, whenever you need the context." />
    {error ? <ErrorNote onRetry={() => window.location.reload()}>{error}</ErrorNote> : rows === null ? <LoadingState label="Loading conversations" /> :
      <section className="collection" aria-label="Conversation directory">
        <div className="collection-toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Search ID, channel or status" label="Search conversations" />
          <FilterButtons label="Conversation status" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "escalated", label: "Needs a person" }, { value: "active", label: "Open" }]} />
        </div>
        <div className="collection-caption"><span>{visible.length} of {rows.length} conversations</span><span>Newest first · Chat & browser voice</span></div>
        {visible.length === 0 ? <EmptyState title={query || filter !== "all" ? "No matching conversations" : "Your conversation history starts here"} body={query || filter !== "all" ? "Try another search or select All." : "Customer conversations appear here, ready for review and follow-up."} /> :
          <ul className="divide-y divide-line">{visible.map(row => <li key={row.id}>
            <button type="button" onClick={() => void openTranscript(row)} className="record-row w-full text-left">
              <div className="record-identity"><span className="record-avatar">{row.channel === "voice" ? <IconPhone className="size-4" /> : <IconChat className="size-4" />}</span>
                <div className="min-w-0"><p className="text-sm font-semibold text-ink">{row.channel === "voice" ? "Browser voice" : "Customer chat"}<span className="ml-2 font-normal text-ink-3">{relativeTime(row.startedAt)}</span></p><p className="record-meta">{formatDateTime(row.startedAt)}</p><p className="mt-1 truncate font-mono text-[10px] text-ink-3">{row.id}</p></div>
              </div>
              <div className="record-actions"><Badge tone={row.status === "escalated" ? "warn" : row.status === "active" ? "accent" : "neutral"}>{row.status === "escalated" ? "Needs a person" : row.status === "active" ? "Open" : row.status}</Badge><span className="flex items-center gap-2 text-xs font-semibold text-pine-700">Read transcript <IconArrowRight className="size-4" /></span></div>
            </button>
          </li>)}</ul>}
      </section>}
    <Modal open={open !== null} onClose={() => { transcriptRequest.current++; setOpen(null); }} title="Conversation transcript" variant="drawer" sub={open ? `${open.conversation.channel === "voice" ? "Browser voice" : "Customer chat"} · ${formatDateTime(open.conversation.startedAt)}` : undefined}>
      {open?.messages === null ? <LoadingState label="Loading transcript" /> : open?.error ? <ErrorNote onRetry={() => void openTranscript(open.conversation)}>{open.error}</ErrorNote> : open?.messages.length === 0 ? <EmptyState title="No messages recorded" body="This session has no saved transcript." /> :
        <ol className="space-y-5">{open?.messages?.map(message => <li key={message.id} className={`transcript-message ${message.role === "customer" ? "is-customer" : ""}`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-3"><span className="font-semibold text-pine-700">{message.role === "customer" ? "Customer" : message.role === "assistant" ? "Cleardesk" : "System"}{message.contentType === "transcript" ? " · Voice" : ""}</span><time dateTime={message.createdAt}>{new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time></div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{message.content}</p>
        </li>)}</ol>}
    </Modal>
  </>;
}
