import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { adminApi, type AppointmentRow, type ConversationRow, type Customer } from "../../lib/admin";
import { Badge, ErrorNote, PageHeading, Spinner } from "../../components/ui";
import { formatDateTime, relativeTime, STATUS_LABELS, statusTone } from "../../lib/format";
import { ApiError } from "../../lib/api";

export default function Overview() {
  const { user } = useAdminAuth();
  const [load, setLoad] = useState<
    { state: "loading" } | { state: "error"; message: string } | { state: "ok"; conversations: ConversationRow[]; appointments: AppointmentRow[]; customers: Customer[] }
  >({ state: "loading" });

  useEffect(() => {
    if (!user) return;
    Promise.all([adminApi.conversations(user.token), adminApi.appointments(user.token), adminApi.customers(user.token)])
      .then(([c, a, cu]) => setLoad({ state: "ok", conversations: c.conversations, appointments: a.appointments, customers: cu.customers }))
      .catch((e) => setLoad({ state: "error", message: e instanceof ApiError ? e.message : "Failed to load data." }));
  }, [user]);

  if (load.state === "loading")
    return (
      <div className="flex justify-center py-24 text-ink-3">
        <Spinner />
      </div>
    );
  if (load.state === "error")
    return (
      <ErrorNote>{load.message}</ErrorNote>
    );

  const escalated = load.conversations.filter((c) => c.status === "escalated");
  const upcoming = load.appointments
    .filter((a) => a.status === "confirmed" && new Date(a.scheduled_start).getTime() > Date.now())
    .sort((x, y) => x.scheduled_start.localeCompare(y.scheduled_start))
    .slice(0, 6);
  const recent = load.conversations.slice(0, 6);

  return (
    <>
      <PageHeading title="Overview" sub="Today at the front desk." />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat to="appointments" label="Upcoming appointments" value={upcoming.length} sub="confirmed, ahead of now" />
        <Stat to="conversations" label="Open conversations" value={load.conversations.filter((c) => c.status === "active").length} sub={`${load.conversations.length} total`} />
        <Stat to="conversations" label="Waiting for a person" value={escalated.length} sub="escalated to staff" tone={escalated.length > 0 ? "warn" : undefined} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="upcoming-h">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="upcoming-h" className="font-display text-lg text-ink">Next appointments</h2>
            <Link to="/admin/appointments" className="text-[13px] font-medium text-pine-600 hover:underline">
              View all
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <PanelEmpty>No confirmed upcoming appointments.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-line rounded-card border border-line bg-surface">
              {upcoming.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{formatDateTime(a.scheduled_start)}</p>
                    <p className="truncate text-[13px] text-ink-2">
                      {a.purpose ?? "Appointment"} · {a.duration_minutes} min
                    </p>
                  </div>
                  <Badge tone={statusTone(a.status)}>{STATUS_LABELS[a.status] ?? a.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="recent-h">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="recent-h" className="font-display text-lg text-ink">Recent conversations</h2>
            <Link to="/admin/conversations" className="text-[13px] font-medium text-pine-600 hover:underline">
              View all
            </Link>
          </div>
          {recent.length === 0 ? (
            <PanelEmpty>No conversations yet.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-line rounded-card border border-line bg-surface">
              {recent.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">
                      {c.channel === "voice" ? "Voice conversation" : "Chat conversation"}
                    </p>
                    <p className="text-[13px] text-ink-3">{relativeTime(c.startedAt)}</p>
                  </div>
                  <Badge tone={c.status === "escalated" ? "warn" : "neutral"}>{c.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function Stat({ to, label, value, sub, tone }: { to: string; label: string; value: number; sub: string; tone?: "warn" }) {
  return (
    <Link
      to={to}
      className="rounded-card border border-line bg-surface p-5 transition-colors hover:border-pine-400"
    >
      <p className="micro">{label}</p>
      <p className={`tabular mt-2 font-display text-4xl ${tone === "warn" && value > 0 ? "text-warn-fg" : "text-ink"}`}>{value}</p>
      <p className="mt-1 text-[13px] text-ink-3">{sub}</p>
    </Link>
  );
}

function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-card border border-dashed border-line-strong bg-surface/60 px-4 py-10 text-center text-sm text-ink-3">{children}</div>;
}
