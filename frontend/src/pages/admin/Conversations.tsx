import { useEffect, useState } from "react";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { adminApi, type ConversationRow } from "../../lib/admin";
import { ApiError } from "../../lib/api";
import { Badge, Button, EmptyState, ErrorNote, PageHeading, Spinner } from "../../components/ui";
import { formatDateTime, relativeTime } from "../../lib/format";

interface Transcript {
  conversation: ConversationRow;
  messages: Array<{ id: string; role: string; content: string; contentType: string; createdAt: string }>;
}

export default function Conversations() {
  const { user } = useAdminAuth();
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Transcript | null>(null);
  const [loadingT, setLoadingT] = useState(false);

  useEffect(() => {
    if (!user) return;
    adminApi
      .conversations(user.token)
      .then((r) => setRows(r.conversations))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load conversations."));
  }, [user]);

  async function openTranscript(c: ConversationRow) {
    if (!user) return;
    setLoadingT(true);
    try {
      const r = await adminApi.transcript(user.token, c.id);
      setOpen({ conversation: c, messages: r.messages });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the transcript.");
    } finally {
      setLoadingT(false);
    }
  }

  return (
    <>
      <PageHeading title="Conversations" sub="Every customer conversation, with transcripts." />
      {error && <ErrorNote onRetry={() => window.location.reload()}>{error}</ErrorNote>}
      {rows === null ? (
        <div className="flex justify-center py-24 text-ink-3"><Spinner /></div>
      ) : rows.length === 0 ? (
        <EmptyState title="No conversations yet" body="Conversations appear here once customers start chatting." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  {c.channel === "voice" ? "Voice" : "Chat"} · {relativeTime(c.startedAt)}
                </p>
                <p className="text-[13px] text-ink-3">{formatDateTime(c.startedAt)}</p>
              </div>
              <div className="flex items-center gap-2.5">
                <Badge tone={c.status === "escalated" ? "warn" : c.status === "active" ? "info" : "neutral"}>{c.status}</Badge>
                <Button size="sm" variant="secondary" loading={loadingT && open?.conversation.id === c.id} onClick={() => openTranscript(c)}>
                  Transcript
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/25" onClick={() => setOpen(null)}>
          <div
            className="pane-scroll h-full w-full max-w-lg overflow-y-auto border-l border-line bg-raised p-6 shadow-slip"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Conversation transcript"
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="font-display text-xl text-ink">Transcript</h2>
                <p className="mt-0.5 text-[13px] text-ink-3">
                  {open.conversation.channel} · {formatDateTime(open.conversation.startedAt)} · {open.conversation.status}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setOpen(null)} aria-label="Close transcript">Close</Button>
            </div>
            {open.messages.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-3">No messages were recorded.</p>
            ) : (
              <ol className="space-y-3">
                {open.messages.map((m) => (
                  <li
                    key={m.id}
                    className={`rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      m.role === "customer"
                        ? "border border-line bg-surface text-ink"
                        : m.role === "assistant"
                          ? "bg-pine-50 text-ink"
                          : "bg-canvas text-ink-3"
                    }`}
                  >
                    <span className="micro mb-1 block">
                      {m.role === "customer" ? "Customer" : m.role === "assistant" ? "Receptionist" : "System"}
                      {m.contentType === "transcript" ? " · voice" : ""}
                    </span>
                    {m.content}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </>
  );
}
