import { useEffect, useState } from "react";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { adminApi, type AppointmentRow } from "../../lib/admin";
import { ApiError } from "../../lib/api";
import { Badge, Button, EmptyState, ErrorNote, Modal, PageHeading, Toast, LoadingState, FilterButtons, SearchField } from "../../components/ui";
import { IconCalendar } from "../../components/icons";
import { formatDateTime, STATUS_LABELS, statusTone } from "../../lib/format";

export default function Appointments() {
  const { user } = useAdminAuth();
  const [rows, setRows] = useState<AppointmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AppointmentRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [details, setDetails] = useState<AppointmentRow | null>(null);
  const [toast, setToast] = useState<{ tone: "success" | "error" | "info"; msg: string } | null>(null);

  async function refresh() {
    if (!user) return;
    setError(null);
    try {
      const r = await adminApi.appointments(user.token);
      setRows(r.appointments);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load appointments.");
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function doCancel() {
    if (!user || !cancelTarget) return;
    setBusy(true);
    try {
      const r = await adminApi.cancelAppointment(user.token, cancelTarget.id);
      setToast({
        tone: r.calendarCancelled ? "success" : "info",
        msg: r.calendarCancelled ? "Appointment cancelled (calendar updated)" : "Appointment cancelled",
      });
      setCancelTarget(null);
      await refresh();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setToast({
        tone: "error",
        msg:
          code === "CALENDAR_UNAVAILABLE"
            ? "Cancellation couldn't be verified. Review the current booking status before retrying."
            : "Couldn't cancel this appointment.",
      });
      setCancelTarget(null);
    } finally {
      setBusy(false);
    }
  }

  const sorted = (rows ?? []).filter(a => (filter === "all" || (filter === "upcoming" ? a.status === "confirmed" && new Date(a.scheduled_start).getTime() > Date.now() : a.status === "cancelled")) && `${a.purpose ?? ""} ${a.service_type ?? ""} ${a.id} ${a.status}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => filter === "upcoming" ? a.scheduled_start.localeCompare(b.scheduled_start) : b.scheduled_start.localeCompare(a.scheduled_start));

  return (
    <>
      <PageHeading title="Appointments" sub="A clear view of what’s booked, what’s next, and what needs attention." />
      {error && <ErrorNote onRetry={refresh}>{error}</ErrorNote>}
      {rows === null ? (!error && <LoadingState label="Loading appointments" />) : <section className="collection" aria-label="Appointment directory">
        <div className="collection-toolbar"><SearchField value={query} onChange={setQuery} placeholder="Purpose, ID or status" label="Search appointments" /><FilterButtons label="Appointment filter" value={filter} onChange={setFilter} options={[{ value: "all", label: "All bookings" }, { value: "upcoming", label: "Upcoming" }, { value: "cancelled", label: "Cancelled" }]} /></div>
        <div className="collection-caption"><span>{sorted.length} of {rows.length} appointments</span><span>Customer confirmation required for booking</span></div>
        {sorted.length === 0 ? <EmptyState icon={<IconCalendar className="size-5" />} title={query || filter !== "all" ? "No matching appointments" : "Make room for what’s next"} body={query || filter !== "all" ? "Choose All bookings or adjust your search." : "Appointments appear here after customers complete the booking flow. There’s nothing to manage just yet."} /> : <>
        <div className="hidden overflow-x-auto md:block">
          <table className="data-table">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-2.5 text-xs font-semibold text-ink-3">When</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-ink-3">Purpose</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-ink-3">Duration</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-ink-3">Status</th>
                <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sorted.map((a) => (
                <tr key={a.id} className="hover:bg-canvas/60">
                  <td className="px-4 py-3 font-medium text-ink"><button className="text-left hover:text-pine-700" onClick={() => setDetails(a)}>{formatDateTime(a.scheduled_start)}</button></td>
                  <td className="max-w-56 truncate px-4 py-3 text-ink-2">{a.purpose ?? a.service_type ?? "—"}</td>
                  <td className="tabular px-4 py-3 text-ink-2">{a.duration_minutes} min <span className="mt-1 block text-xs text-ink-3">{a.timezone}</span></td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(a.status)}>{STATUS_LABELS[a.status] ?? a.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {(a.status === "confirmed" || a.status === "pending_confirmation") && (
                      <Button size="sm" variant="danger" onClick={() => setCancelTarget(a)}>
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="divide-y divide-line md:hidden">{sorted.map(a => <li key={a.id} className="space-y-4 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-display text-lg leading-snug">{formatDateTime(a.scheduled_start)}</p><p className="record-meta">{a.duration_minutes} min · {a.timezone}</p></div><Badge tone={statusTone(a.status)}>{STATUS_LABELS[a.status] ?? a.status}</Badge></div><p className="text-sm text-ink-2 [overflow-wrap:anywhere]">{a.purpose ?? a.service_type ?? "Appointment"}</p><div className="record-actions"><Button size="sm" variant="secondary" onClick={() => setDetails(a)}>View details</Button>{(a.status === "confirmed" || a.status === "pending_confirmation") && <Button size="sm" variant="danger" onClick={() => setCancelTarget(a)}>Cancel appointment</Button>}</div></li>)}</ul>
        </>}
      </section>}

      <Modal open={details !== null} onClose={() => setDetails(null)} title="Appointment details" variant="drawer" sub={details ? formatDateTime(details.scheduled_start) : undefined}>{details && <dl className="space-y-5">{[["Purpose", details.purpose ?? details.service_type], ["Duration", `${details.duration_minutes} minutes`], ["Timezone", details.timezone], ["Status", STATUS_LABELS[details.status] ?? details.status], ["Appointment ID", details.id]].map(([label, value]) => <div key={label}><dt className="section-kicker mb-2">{label}</dt><dd className="m-0 text-sm [overflow-wrap:anywhere]">{value || "Not provided"}</dd></div>)}</dl>}</Modal>

      <Modal
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title="Cancel this appointment?"
        dismissible={!busy}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setCancelTarget(null)}>Keep appointment</Button>
            <Button variant="danger" loading={busy} onClick={doCancel}>Cancel appointment</Button>
          </>
        }
      >
        <p>
          {cancelTarget && formatDateTime(cancelTarget.scheduled_start)} will be cancelled for the customer. If the calendar
          can't verify the outcome, review the current status before retrying.
        </p>
      </Modal>
      {toast && <Toast tone={toast.tone} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </>
  );
}
