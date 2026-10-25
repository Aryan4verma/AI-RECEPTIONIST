import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { adminApi, type AppointmentRow, type ConversationRow, type Customer } from "../../lib/admin";
import { Badge, Card, CardHead, ErrorNote, Spinner, StatTile } from "../../components/ui";
import { formatDate, formatDateTime, relativeTime, STATUS_LABELS, statusTone } from "../../lib/format";
import { ApiError } from "../../lib/api";
import { IconAlert, IconCalendar, IconChip, IconMessages } from "../../components/icons";

/**
 * Operational dashboard — every number is computed from the real admin lists
 * (no invented metrics). Empty states are accurate, not decorated.
 */
export default function Overview() {
  const { user } = useAdminAuth();
  const [load, setLoad] = useState<
    | { state: "loading" }
    | { state: "error"; message: string }
    | {
        state: "ok";
        conversations: ConversationRow[];
        appointments: AppointmentRow[];
        customers: Customer[];
        ai: { reachable: boolean; models: number; activeProvider: string | null };
      }
  >({ state: "loading" });

  useEffect(() => {
    if (!user) return;
    Promise.all([
      adminApi.conversations(user.token),
      adminApi.appointments(user.token),
      adminApi.customers(user.token),
      adminApi.providers(user.token).catch(() => ({ providers: [] as { isActive: boolean; displayName: string; modelId: string | null }[] })),
      adminApi.localModels(user.token).catch(() => ({ ollama: { reachable: false, models: [] as unknown[] } })),
    ])
      .then(([c, a, cu, p, m]) => {
        const active = (p.providers ?? []).find((x) => x.isActive);
        setLoad({
          state: "ok",
          conversations: c.conversations,
          appointments: a.appointments,
          customers: cu.customers,
          ai: {
            reachable: m.ollama?.reachable ?? false,
            models: m.ollama?.models?.length ?? 0,
            activeProvider: active ? `${active.displayName}${active.modelId ? ` · ${active.modelId}` : ""}` : null,
          },
        });
      })
      .catch((e) => setLoad({ state: "error", message: e instanceof ApiError ? e.message : "Failed to load data." }));
  }, [user]);

  if (load.state === "loading")
    return (
      <div className="flex justify-center py-24 text-ink-3">
        <Spinner />
      </div>
    );
  if (load.state === "error") return <ErrorNote>{load.message}</ErrorNote>;

  const escalated = load.conversations.filter((c) => c.status === "escalated");
  const upcoming = load.appointments
    .filter((a) => a.status === "confirmed" && new Date(a.scheduled_start).getTime() > Date.now())
    .sort((x, y) => x.scheduled_start.localeCompare(y.scheduled_start))
    .slice(0, 5);
  const open = load.conversations.filter((c) => c.status === "active");
  const recent = [...load.conversations]
    .sort((x, y) => +new Date(y.startedAt) - +new Date(x.startedAt))
    .slice(0, 6);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] leading-tight text-ink">The front desk today</h1>
          <p className="mt-1 text-sm text-ink-2">Everything below is live from your receptionist service.</p>
        </div>
        <p className="text-[11.5px] text-ink-3">{formatDate(new Date().toISOString())}</p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link to="/admin/appointments" className="rounded-tile border border-line bg-surface px-4 py-3.5 shadow-card transition-colors hover:border-pine-400">
          <p className="micro">Upcoming appointments</p>
          <p className="tabular mt-1.5 font-display text-[28px] leading-none text-pine-700">{upcoming.length}</p>
          <p className="mt-1.5 text-[11.5px] text-ink-3">{upcoming[0] ? `Next ${relativeTime(upcoming[0].scheduled_start)}` : "confirmed, ahead of now"}</p>
        </Link>
        <Link to="/admin/conversations" className="rounded-tile border border-line bg-surface px-4 py-3.5 shadow-card transition-colors hover:border-pine-400">
          <p className="micro">Open conversations</p>
          <p className="tabular mt-1.5 font-display text-[28px] leading-none text-ink">{open.length}</p>
          <p className="mt-1.5 text-[11.5px] text-ink-3">{load.conversations.length} all-time</p>
        </Link>
        <Link to="/admin/conversations" className="rounded-tile border border-line bg-surface px-4 py-3.5 shadow-card transition-colors hover:border-pine-400">
          <p className="micro">Waiting for a person</p>
          <p className={`tabular mt-1.5 font-display text-[28px] leading-none ${escalated.length > 0 ? "text-warn-fg" : "text-ink"}`}>{escalated.length}</p>
          <p className="mt-1.5 text-[11.5px] text-ink-3">{escalated.length > 0 ? "Needs follow-up" : "Nothing escalated"}</p>
        </Link>
        <Link to="/admin/customers" className="rounded-tile border border-line bg-surface px-4 py-3.5 shadow-card transition-colors hover:border-pine-400">
          <p className="micro">Customers</p>
          <p className="tabular mt-1.5 font-display text-[28px] leading-none text-ink">{load.customers.length}</p>
          <p className="mt-1.5 text-[11.5px] text-ink-3">On file</p>
        </Link>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        {/* Upcoming appointments */}
        <Card>
          <CardHead
            title="Next appointments"
            sub="Confirmed bookings, soonest first"
            actions={
              <Link to="/admin/appointments" className="flex items-center gap-1 text-[12.5px] font-semibold text-pine-700 hover:underline">
                View all <IconCalendar className="size-3.5" />
              </Link>
            }
          />
          {upcoming.length === 0 ? (
            <EmptyRow text="No confirmed upcoming appointments. New bookings appear here the moment customers confirm them." />
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate font-display text-[15px] text-ink">{formatDateTime(a.scheduled_start)}</p>
                    <p className="mt-0.5 truncate text-[12.5px] text-ink-2">
                      {a.purpose ?? "Appointment"} · {a.duration_minutes} min · {a.timezone}
                    </p>
                  </div>
                  <Badge tone={statusTone(a.status)}>{STATUS_LABELS[a.status] ?? a.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Receptionist status */}
        <Card>
          <CardHead title="Receptionist status" sub="Model & inference service" actions={<IconChip className="size-4 text-ink-3" />} />
          <div className="space-y-3.5 px-5 py-4">
            <StatusRow label="Active model" value={load.ai.activeProvider ?? (load.ai.reachable ? "Local default (qwen3)" : "Not set")} />
            <StatusRow
              label="Local inference"
              value={load.ai.reachable ? `Reachable · ${load.ai.models} installed` : "Unreachable"}
              tone={load.ai.reachable ? "ok" : "warn"}
            />
            <StatusRow label="Voice recognition" value="Local, RAM-gated" tone="warn" />
            <p className="pt-1 text-[11.5px] leading-relaxed text-ink-3">
              Real Google Calendar writes and cloud inference stay off until separately authorized by the business owner.
            </p>
          </div>
        </Card>
      </div>

      {/* Recent conversations */}
      <Card className="mt-5">
        <CardHead
          title="Recent conversations"
          sub="Latest customer sessions across chat and calls"
          actions={
            <Link to="/admin/conversations" className="flex items-center gap-1 text-[12.5px] font-semibold text-pine-700 hover:underline">
              View all <IconMessages className="size-3.5" />
            </Link>
          }
        />
        {recent.length === 0 ? (
          <EmptyRow text="No conversations yet. When customers chat or call, their sessions appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium text-ink">
                    {c.channel === "voice" ? "Voice conversation" : "Chat conversation"}
                    <span className="ml-2 font-normal text-ink-3">{relativeTime(c.startedAt)}</span>
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-ink-3">{c.id}</p>
                </div>
                {c.status === "escalated" ? (
                  <Badge tone="warn">
                    <IconAlert className="mr-1 size-3" /> Waiting for a person
                  </Badge>
                ) : (
                  <Badge tone={c.status === "active" ? "accent" : "neutral"}>{c.status}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-5 py-8 text-center text-[13px] leading-relaxed text-ink-3">{text}</p>;
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-ink-2">{label}</span>
      <span className={`text-[13px] font-semibold ${tone === "ok" ? "text-success-fg" : tone === "warn" ? "text-warn-fg" : "text-ink"}`}>{value}</span>
    </div>
  );
}
