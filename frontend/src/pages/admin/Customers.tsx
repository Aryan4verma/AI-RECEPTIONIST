import { useEffect, useState } from "react";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { adminApi, type Customer } from "../../lib/admin";
import { ApiError } from "../../lib/api";
import { Badge, Button, EmptyState, ErrorNote, Field, Input, Modal, PageHeading, Spinner, Textarea } from "../../components/ui";
import { relativeTime } from "../../lib/format";

export default function Customers() {
  const { user } = useAdminAuth();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmAnon, setConfirmAnon] = useState<Customer | null>(null);

  async function refresh() {
    if (!user) return;
    try {
      const r = await adminApi.customers(user.token);
      setCustomers(r.customers);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load customers.");
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const filtered = (customers ?? []).filter(
    (c) =>
      !query ||
      c.displayName.toLowerCase().includes(query.toLowerCase()) ||
      (c.contactEmail ?? "").toLowerCase().includes(query.toLowerCase()) ||
      (c.contactPhone ?? "").includes(query),
  );

  return (
    <>
      <PageHeading
        title="Customers"
        sub="People the receptionist has collected details for."
        actions={<Button onClick={() => setAdding(true)}>Add customer</Button>}
      />
      {error && <ErrorNote onRetry={refresh}>{error}</ErrorNote>}
      {customers === null ? (
        <div className="flex justify-center py-24 text-ink-3"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={query ? "No matching customers" : "No customers yet"}
          body={query ? "Try a different search." : "Customers appear here as the receptionist collects their details."}
        />
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, or phone…"
            aria-label="Search customers"
            className="w-full border-b border-line px-4 py-2.5 text-sm outline-none placeholder:text-ink-3/70"
          />
          <ul className="divide-y divide-line">
            {filtered.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {c.displayName === "[deleted customer]" ? <span className="text-ink-3 italic">Deleted customer</span> : c.displayName}
                  </p>
                  <p className="truncate text-[13px] text-ink-2">
                    {[c.contactEmail, c.contactPhone].filter(Boolean).join(" · ") || "No contact details"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {c.notes && <span className="hidden max-w-40 truncate text-xs text-ink-3 sm:block" title={c.notes}>{c.notes}</span>}
                  {c.displayName !== "[deleted customer]" && (
                    <Button size="sm" variant="danger" onClick={() => setConfirmAnon(c)}>
                      Delete
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AddModal open={adding} onClose={() => setAdding(false)} onDone={refresh} token={user?.token ?? ""} />
      <AnonModal
        customer={confirmAnon}
        onClose={() => setConfirmAnon(null)}
        onDone={refresh}
        token={user?.token ?? ""}
      />
    </>
  );
}

function AddModal({ open, onClose, onDone, token }: { open: boolean; onClose: () => void; onDone: () => void; token: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.createCustomer(token, {
        displayName: name.trim(),
        contactEmail: email.trim() || undefined,
        contactPhone: phone.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onDone();
      onClose();
      setName(""); setEmail(""); setPhone(""); setNotes("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the customer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add customer"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="add-customer" loading={busy}>Save</Button>
        </>
      }>
      <form id="add-customer" onSubmit={submit} className="space-y-3.5">
        <Field label="Name" htmlFor="c-name"><Input id="c-name" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email" htmlFor="c-email" hint="Optional"><Input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Phone" htmlFor="c-phone" hint="Optional"><Input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Notes" htmlFor="c-notes" hint="Optional"><Textarea id="c-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}

function AnonModal({ customer, onClose, onDone, token }: { customer: Customer | null; onClose: () => void; onDone: () => void; token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doAnon() {
    if (!customer) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.anonymizeCustomer(token, customer.id);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete this customer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={customer !== null}
      onClose={onClose}
      title="Delete customer?"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Keep</Button>
          <Button variant="danger" loading={busy} onClick={doAnon}>Delete & anonymize</Button>
        </>
      }
    >
      <p>
        <strong>{customer?.displayName}</strong>'s personal details (name, email, phone, notes) will be permanently removed.
        Appointment history is retained for business records without personal information.
      </p>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
    </Modal>
  );
}
