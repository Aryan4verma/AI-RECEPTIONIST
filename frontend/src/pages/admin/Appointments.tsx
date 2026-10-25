import { useEffect, useState } from "react";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { adminApi, type AppointmentRow } from "../../lib/admin";
import { ApiError } from "../../lib/api";
import { Badge, Button, EmptyState, ErrorNote, Modal, PageHeading, Spinner, Toast } from "../../components/ui";
import { formatDateTime, STATUS_LABELS, statusTone } from "../../lib/format";

export default function Appointments() {
  const { user } = useAdminAuth();
  const [rows, setRows] = useState<AppointmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AppointmentRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ tone: "success" | "error" | "info"; msg: string } | null>(null);

  async function refresh() {
    if (!user) return;
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
            ? "Cancellation couldn't be verified with the calendar — nothing was changed. Try again shortly."
            : "Couldn't cancel this appointment.",
      });
      setCancelTarget(null);
    } finally {
      setBusy(false);
    }
  }

  const sorted = (rows ?? []).slice().sort((a, b) => b.scheduled_start.localeCompare(a.scheduled_start));

  return (
    <>
      <PageHeading title="Appointments" sub="Bookings made through the receptionist." />
      {error && <ErrorNote onRetry={refresh}>{error}</ErrorNote>}
      {rows === null ? (
        <div className="flex justify-center py-24 text-ink-3"><Spinner /></div>
      ) : sorted.length === 0 ? (
        <EmptyState title="No appointments yet" body="Confirmed bookings will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-2.5 text-xs font-semibold text-ink-3">When</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-ink-3">Purpose</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-ink-3">Duration</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-ink-3">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sorted.map((a) => (
                <tr key={a.id} className="hover:bg-canvas/60">
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">{formatDateTime(a.scheduled_start)}</td>
                  <td className="max-w-56 truncate px-4 py-3 text-ink-2">{a.purpose ?? a.service_type ?? "—"}</td>
                  <td className="tabular whitespace-nowrap px-4 py-3 text-ink-2">{a.duration_minutes} min · {a.timezone}</td>
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
      )}

      <Modal
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title="Cancel this appointment?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelTarget(null)}>Keep</Button>
            <Button variant="danger" loading={busy} onClick={doCancel}>Cancel appointment</Button>
          </>
        }
      >
        <p>
          {cancelTarget && formatDateTime(cancelTarget.scheduled_start)} will be cancelled for the customer. If the calendar
          can't confirm the cancellation, nothing changes and you can retry.
        </p>
      </Modal>
      {toast && <Toast tone={toast.tone} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </>
  );
}
