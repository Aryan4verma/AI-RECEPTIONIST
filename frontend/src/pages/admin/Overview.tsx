import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { adminApi, type AppointmentRow, type ConversationRow, type Customer, type GoogleCalendarStatus } from "../../lib/admin";
import { Badge, Button, Card, CardHead, ErrorNote, Spinner } from "../../components/ui";
import { Photo } from "../../components/Photo";
import { formatDate, formatDateTime, relativeTime, STATUS_LABELS, statusTone } from "../../lib/format";
import { ApiError } from "../../lib/api";
import { IconAlert, IconArrowRight, IconCalendar, IconChat, IconChip, IconMessages, IconUsers } from "../../components/icons";

/**
 * Operational dashboard — every number is computed from the real admin lists
 * (no invented metrics). Empty states are accurate, not decorated. The hero
 * quote is the receptionist's REAL configured greeting, not placeholder copy.
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
        greeting: string | null;
        google: GoogleCalendarStatus | null;
        ai: { reachable: boolean; models: number; activeProvider: string | null };
      }
  >({ state: "loading" });
  const [refreshTick, setRefreshTick] = useState(0);
  const [gcalBusy, setGcalBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      adminApi.conversations(user.token),
      adminApi.appointments(user.token),
      adminApi.customers(user.token),
      adminApi.providers(user.token).catch(() => ({ providers: [] as { isActive: boolean; displayName: string; modelId: string | null }[] })),
      adminApi.localModels(user.token).catch(() => ({ ollama: { reachable: false, models: [] as unknown[] } })),
      adminApi.config(user.token, "business_info").catch(() => null),
      adminApi.googleStatus(user.token).catch(() => null),
    ])
      .then(([c, a, cu, p, m, cfg, gcal]) => {
        const active = (p.providers ?? []).find((x) => x.isActive);
        const greeting = typeof (cfg?.content as { greeting?: unknown } | undefined)?.greeting === "string"
          ? ((cfg?.content as { greeting: string }).greeting)
          : null;
        setLoad({
          state: "ok",
          conversations: c.conversations,
          appointments: a.appointments,
          customers: cu.customers,
          greeting,
          google: gcal,
          ai: {
            reachable: m.ollama?.reachable ?? false,
            models: m.ollama?.models?.length ?? 0,
            activeProvider: active ? `${active.displayName}${active.modelId ? ` · ${active.modelId}` : ""}` : null,
          },
        });
      })
      .catch((e) => setLoad({ state: "error", message: e instanceof ApiError ? e.message : "Failed to load data." }));
  }, [user, refreshTick]);

  if (load.state === "loading")
    return (
      <div className="flex justify-center py-24 text-ink-3">
        <Spinner />
      </div>
    );
  if (load.state === "error") return <ErrorNote>{load.message}</ErrorNote>;

  const escalated = load.conversations.filter((c) => c.status === "escalated");
  const allUpcoming = load.appointments
    .filter((a) => a.status === "confirmed" && new Date(a.scheduled_start).getTime() > Date.now())
    .sort((x, y) => x.scheduled_start.localeCompare(y.scheduled_start));
  const upcoming = allUpcoming.slice(0, 5);
  const open = load.conversations.filter((c) => c.status === "active");
  const recent = [...load.conversations]
    .sort((x, y) => +new Date(y.startedAt) - +new Date(x.startedAt))
    .slice(0, 6);

  return (
    <>
      {/* Hero — greeting line + photographic card carrying the REAL configured greeting */}
      <div className="mb-7 grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col justify-center">
          <p className="section-kicker mb-3">{formatDate(new Date().toISOString())} / Your daily brief</p>
          <h1 className="type-h1 text-ink">At the front desk.</h1>
          <p className="mt-3 max-w-md border-l-2 border-pine-300 pl-3.5 text-[13px] leading-relaxed text-ink-2">
            {load.greeting ? (
              <>
                <span className="font-display-italic text-[14.5px] text-ink">“{load.greeting}”</span>
                <span className="mt-1 block text-[11.5px] text-ink-3">
                  Your receptionist's current greeting — edit it in Business settings.
                </span>
              </>
            ) : (
              <span className="text-ink-3">
                No greeting configured yet — set one in Business settings so every conversation opens warmly.
              </span>
            )}
          </p>
        </div>
        <Photo src="/images/admin-hero.jpg" className="h-36 rounded-card shadow-card">
          <div className="absolute inset-0 bg-gradient-to-t from-pine-950/55 via-pine-950/10 to-transparent" />
          <p className="absolute bottom-3 left-4 right-4 font-display-italic text-[13px] leading-snug text-[#f4f1e8]">
            Every conversation, appointment and handoff in one place.
          </p>
        </Photo>
      </div>

      {/* Stat cards — tinted icon tiles, serif numbers, circular arrow */}
      <div className="overview-metrics grid grid-cols-2 overflow-hidden rounded-card border border-line bg-surface lg:grid-cols-4">
        <StatCard
          to="/admin/appointments"
          icon={<IconCalendar className="size-4.5" />}
          tileClass="bg-pine-100 text-pine-700"
          value={allUpcoming.length}
          label="Upcoming appointments"
          hint={upcoming[0] ? `Next ${relativeTime(upcoming[0].scheduled_start)}` : "Confirmed, ahead of now"}
          accent
        />
        <StatCard
          to="/admin/conversations"
          icon={<IconChat className="size-4.5" />}
          tileClass="bg-brass-300/30 text-brass-600"
          value={open.length}
          label="Open conversations"
          hint={`${load.conversations.length} all-time`}
        />
        <StatCard
          to="/admin/conversations"
          icon={<IconAlert className="size-4.5" />}
          tileClass={escalated.length > 0 ? "bg-warn-bg text-warn-fg" : "bg-canvas-deep text-ink-3"}
          value={escalated.length}
          label="Waiting for a person"
          hint={escalated.length > 0 ? "Needs follow-up" : "Nothing escalated"}
          valueClass={escalated.length > 0 ? "text-warn-fg" : undefined}
        />
        <StatCard
          to="/admin/customers"
          icon={<IconUsers className="size-4.5" />}
          tileClass="bg-pine-100 text-pine-700"
          value={load.customers.length}
          label="Customers"
          hint="On file"
        />
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        {/* Upcoming appointments */}
        <Card className="xl:col-start-1 xl:row-start-1">
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
                    <p className="truncate font-display text-[15px] text-ink">{formatDateTime(a.scheduled_start, a.timezone)}</p>
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

        {/* Status column: receptionist + Google Calendar connection */}
        <div className="grid min-w-0 items-start gap-5 md:grid-cols-2 xl:col-start-2 xl:row-start-1 xl:row-span-2 xl:grid-cols-1">
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

          <GoogleCalendarCard
            user={user}
            status={load.google}
            busy={gcalBusy}
            onChanged={() => setRefreshTick((t) => t + 1)}
            setBusy={setGcalBusy}
          />
        </div>
      {/* Recent conversations */}
      <Card className="xl:col-start-1 xl:row-start-2">
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
                    Waiting for a person
                  </Badge>
                ) : (
                  <Badge tone={c.status === "active" ? "accent" : "neutral"}>{c.status}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      </div>
    </>
  );
}

function StatCard({
  to,
  icon,
  tileClass,
  value,
  label,
  hint,
  accent,
  valueClass,
}: {
  to: string;
  icon: React.ReactNode;
  tileClass: string;
  value: number;
  label: string;
  hint: string;
  accent?: boolean;
  valueClass?: string;
}) {
  return (
    <Link
      to={to}
      className="group min-w-0 rounded-card border border-line bg-surface p-4 sm:p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-slip"
    >
      <div className="flex items-start justify-between">
        <span className={`flex size-10 items-center justify-center rounded-full ${tileClass}`}>{icon}</span>
        <span className="flex size-7 items-center justify-center rounded-full border border-line-strong text-ink-3 opacity-0 transition-opacity group-hover:opacity-100">
          <IconArrowRight className="size-3.5" />
        </span>
      </div>
      <p className={`type-metric mt-4 text-[34px] leading-none ${valueClass ?? (accent ? "text-pine-700" : "text-ink")}`}>
        {value}
      </p>
      <p className="mt-2.5 text-[13px] font-semibold leading-snug text-ink-2">{label}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-3">{hint}</p>
    </Link>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="max-w-lg px-5 py-7 text-[13px] leading-relaxed text-ink-3">{text}</p>;
}

/**
 * Google Calendar connection (Stage 7). Shows the real connection status;
 * Connect opens the Google consent page in a new tab (the callback returns
 * to the backend, then the status refreshes). Tokens never reach the browser.
 */
function GoogleCalendarCard({
  user,
  status,
  busy,
  setBusy,
  onChanged,
}: {
  user: { email: string; token: string } | null;
  status: GoogleCalendarStatus | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onChanged: () => void;
}) {
  const [copyNote, setCopyNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => setCopyNote(""), [status?.calendarId]);
  async function copyCalendarId() {
    if (!status?.calendarId) return;
    try {
      await navigator.clipboard.writeText(status.calendarId);
      setCopyNote("Calendar ID copied.");
    } catch {
      setCopyNote("Copy unavailable. Open the full ID below to select it.");
    }
  }
  async function connect() {
    if (!user) return;
    setBusy(true);
    setActionError(null);
    try {
      const { authUrl } = await adminApi.googleConnect(user.token);
      window.open(authUrl, "_blank", "noopener");
      // The consent round trip takes the owner a while; refresh on return.
      window.addEventListener("focus", () => onChanged(), { once: true });
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Couldn't start the connection. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    if (!user) return;
    setBusy(true);
    setActionError(null);
    try {
      await adminApi.googleDisconnect(user.token);
      onChanged();
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Couldn't disconnect. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHead title="Google Calendar" sub="Dedicated calendar integration" actions={status?.connected ? <Badge tone="success">Connected</Badge> : undefined} />
      <div className="space-y-4 px-5 py-4">
        {actionError && <ErrorNote>{actionError}</ErrorNote>}
        {!status ? (
          <p className="text-[13px] leading-relaxed text-ink-3">
            Calendar status couldn't be loaded. Refresh the page to try again.
          </p>
        ) : !status.configured ? (
          <p className="text-[13px] leading-relaxed text-ink-3">
            Not configured. Add the Google OAuth variables to the server .env (see .env.example) — the mock calendar
            remains active until then.
          </p>
        ) : status.connected ? (
          <>
            <dl className="space-y-3">
              <div>
                <dt className="mb-1.5 text-xs font-medium text-ink-3">Calendar ID</dt>
                <dd className="m-0 min-w-0">
                  <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2">
                    <code className="min-w-0 flex-1 truncate text-xs leading-5 text-ink-2" title={status.calendarId ?? undefined}>{status.calendarId ?? "—"}</code>
                    <button type="button" onClick={() => void copyCalendarId()} disabled={!status.calendarId} aria-label="Copy calendar ID" className="shrink-0 rounded px-1 py-0.5 text-xs font-semibold text-pine-700 hover:bg-pine-50 disabled:opacity-40">Copy</button>
                  </div>
                  {status.calendarId && <details className="mt-2 text-xs text-ink-3">
                    <summary className="w-fit cursor-pointer rounded font-medium hover:text-pine-700">View full ID</summary>
                    <code className="mt-2 block select-all break-all rounded-lg bg-canvas p-2.5 text-xs leading-relaxed text-ink-2">{status.calendarId}</code>
                  </details>}
                  <p className="sr-only" role="status" aria-live="polite">{copyNote}</p>
                  {copyNote && <p className="mt-2 text-xs leading-relaxed text-ink-2" aria-hidden="true">{copyNote}</p>}
                </dd>
              </div>
              <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-3 text-[13px] leading-5">
                <dt className="text-ink-3">Access level</dt>
                <dd className={`m-0 min-w-0 break-words font-semibold capitalize ${["owner", "writer"].includes(status.accessRole ?? "") ? "text-success-fg" : "text-warn-fg"}`}>{status.accessRole ?? "Unknown"}</dd>
              </div>
            </dl>
            {status.lastError && <p className="break-words text-xs leading-relaxed text-danger-fg">{status.lastError}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
              <p className="max-w-[24ch] flex-1 text-xs leading-relaxed text-ink-3">Real event writes require separate owner approval.</p>
              <Button variant="danger" size="sm" onClick={() => void disconnect()} disabled={busy} loading={busy}>Disconnect</Button>
            </div>
          </>
        ) : (
          <>
            <StatusRow label="Connection" value="Not connected" tone="warn" />
            {status.lastError && <p className="text-[12px] leading-relaxed text-danger-fg">{status.lastError}</p>}
            <p className="text-[11.5px] leading-relaxed text-ink-3">
              Connect your Google account to verify real availability. The mock calendar stays active until
              CALENDAR_MODE=google is set.
            </p>
            <Button size="sm" onClick={() => void connect()} disabled={busy} loading={busy}>
              Connect Google account
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start gap-3 text-[13px] leading-5">
      <span className="text-ink-3">{label}</span>
      <span className={`min-w-0 text-right font-medium [overflow-wrap:anywhere] ${tone === "ok" ? "text-success-fg" : tone === "warn" ? "text-warn-fg" : "text-ink"}`}>{value}</span>
    </div>
  );
}
