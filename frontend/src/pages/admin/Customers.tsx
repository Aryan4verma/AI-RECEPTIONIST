import { useEffect, useState } from "react";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { adminApi, type Customer } from "../../lib/admin";
import { ApiError } from "../../lib/api";
import { Badge, Button, EmptyState, ErrorNote, Field, Input, Modal, PageHeading, Spinner, Textarea, SearchField, LoadingState } from "../../components/ui";
import { relativeTime } from "../../lib/format";

export default function Customers() {
  const { user } = useAdminAuth();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmAnon, setConfirmAnon] = useState<Customer | null>(null);
  const [details, setDetails] = useState<Customer | null>(null);

  async function refresh() {
    if (!user) return;
    setError(null);
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
        sub="Every relationship starts with a little context. Keep it here."
        actions={<Button onClick={() => setAdding(true)}>Add customer</Button>}
      />
      {error && <ErrorNote onRetry={refresh}>{error}</ErrorNote>}
      {customers === null ? (!error && <LoadingState label="Loading customers" />) : (
        <section className="collection" aria-label="Customer directory">
          <div className="collection-toolbar"><SearchField value={query} onChange={setQuery} placeholder="Name, email or phone" label="Search customers" /><p className="text-xs text-ink-3">{filtered.length} of {customers.length} customers</p></div>
          {filtered.length === 0 ? <EmptyState title={query ? "No matching customers" : "A place for your customers"} body={query ? "Try another search. Your directory is unchanged." : "Add a customer, or let the receptionist collect their details during a conversation."} /> :
          <ul className="divide-y divide-line">
            {filtered.map((c) => (
              <li key={c.id} className="record-row">
                <div className="record-identity"><span className="record-avatar" aria-hidden="true">{c.displayName === "[deleted customer]" ? "—" : c.displayName.trim().slice(0, 1).toUpperCase()}</span><div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {c.displayName === "[deleted customer]" ? <span className="text-ink-3 italic">Deleted customer</span> : c.displayName}
                  </p>
                  <p className="record-meta">
                    {[c.contactEmail, c.contactPhone].filter(Boolean).join(" · ") || "No contact details"}
                  </p>
                </div></div>
                <div className="record-actions">
                  <Button size="sm" variant="secondary" onClick={() => setDetails(c)}>Details</Button>
                  {c.displayName !== "[deleted customer]" && (
                    <Button size="sm" variant="ghost" className="text-danger-fg" onClick={() => setConfirmAnon(c)}>
                      Anonymize
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>}
        </section>
      )}

      <AddModal open={adding} onClose={() => setAdding(false)} onDone={refresh} token={user?.token ?? ""} />
      <Modal open={details !== null} onClose={() => setDetails(null)} title={details?.displayName === "[deleted customer]" ? "Anonymized customer" : details?.displayName ?? "Customer details"} variant="drawer" sub="Customer information held by your receptionist.">
        {details && <dl className="space-y-6">{[["Email", details.contactEmail], ["Phone", details.contactPhone], ["Notes", details.notes], ["Customer ID", details.id]].map(([label, value]) => <div key={label}><dt className="section-kicker mb-2">{label}</dt><dd className="m-0 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{value || "Not provided"}</dd></div>)}</dl>}
      </Modal>
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
    if (!name.trim()) { setError("Enter a customer name."); return; }
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
    <Modal open={open} onClose={onClose} dismissible={!busy} title="Add a customer" sub="A few details now make every future conversation more personal."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="add-customer" loading={busy}>Save</Button>
        </>
      }>
      <form id="add-customer" onSubmit={submit} className="space-y-5">
        <Field label="Name" htmlFor="c-name"><Input id="c-name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email" htmlFor="c-email" hint="Optional"><Input id="c-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Phone" htmlFor="c-phone" hint="Optional"><Input id="c-phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
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
      title="Anonymize personal details?"
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>Keep customer</Button>
          <Button variant="danger" loading={busy} onClick={doAnon}>Anonymize details</Button>
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
