import { useEffect, useState } from "react";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { adminApi } from "../../lib/admin";
import { ApiError } from "../../lib/api";
import { Button, ErrorNote, Field, Input, PageHeading, Spinner, Textarea, Toast } from "../../components/ui";

const CATEGORIES = [
  { id: "business_info", label: "Business info" },
  { id: "hours", label: "Hours & timezone" },
  { id: "appointment_types", label: "Appointment types" },
  { id: "faqs", label: "FAQs" },
  { id: "services", label: "Services" },
  { id: "escalation", label: "Escalation rules" },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

export default function BusinessConfig() {
  const { user } = useAdminAuth();
  const [cat, setCat] = useState<CategoryId>("business_info");
  const [content, setContent] = useState<Record<string, unknown> | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ tone: "success" | "error"; msg: string } | null>(null);

  // Forms are only rendered when content is non-null; adapt the setter type.
  const setContentNonNull: React.Dispatch<React.SetStateAction<Record<string, unknown>>> = setContent as never;

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setError(null);
    adminApi
      .config(user.token, cat)
      .then((r) => {
        setContent(r.content ?? {});
        setVersion(r.version ?? 0);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load settings."))
      .finally(() => setLoading(false));
  }, [user, cat]);

  async function save() {
    if (!user || !content) return;
    setSaving(true);
    try {
      const r = await adminApi.saveConfig(user.token, cat, content);
      setVersion(r.version);
      setToast({ tone: "success", msg: `Saved (version ${r.version}) — live on new messages` });
    } catch (e) {
      setToast({ tone: "error", msg: e instanceof ApiError ? e.message : "Couldn't save." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeading
        title="Business settings"
        sub="What the receptionist knows and says. Changes take effect on new messages."
        actions={
          <Button onClick={save} loading={saving} disabled={!content}>
            Save changes
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap gap-1.5" role="tablist" aria-label="Settings categories">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={cat === c.id}
            onClick={() => setCat(c.id)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
              cat === c.id ? "bg-pine-600 text-white" : "border border-line-strong bg-surface text-ink-2 hover:border-ink-3"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-24 text-ink-3"><Spinner /></div>
      ) : error ? (
        <ErrorNote>{error}</ErrorNote>
      ) : content ? (
        <div className="max-w-2xl rounded-card border border-line bg-surface p-5">
          {cat === "business_info" && <BusinessInfoForm content={content} onChange={setContentNonNull} />}
          {cat === "hours" && <HoursForm content={content} onChange={setContentNonNull} />}
          {cat === "appointment_types" && <AppointmentTypesForm content={content} onChange={setContentNonNull} />}
          {cat === "faqs" && <FaqForm content={content} onChange={setContentNonNull} />}
          {(cat === "services" || cat === "escalation") && (
            <JsonForm content={content} onChange={setContentNonNull} hint="Raw JSON for this category — edited by an administrator." />
          )}
          <p className="mt-4 text-xs text-ink-3">Current version: {version}</p>
        </div>
      ) : null}
      {toast && <Toast tone={toast.tone} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </>
  );
}

type Setter = (updater: (c: Record<string, unknown>) => Record<string, unknown>) => void;

function useField(content: Record<string, unknown>, onChange: Setter, key: string) {
  const value = typeof content[key] === "string" ? (content[key] as string) : "";
  return {
    value,
    set: (v: string) => onChange((c) => ({ ...c, [key]: v })),
  };
}

function BusinessInfoForm({ content, onChange }: { content: Record<string, unknown>; onChange: React.Dispatch<React.SetStateAction<Record<string, unknown>>> }) {
  const greeting = useField(content, onChange as Setter, "greeting");
  const name = useField(content, onChange as Setter, "name");
  return (
    <div className="space-y-4">
      <Field label="Business name" htmlFor="bi-name">
        <Input id="bi-name" value={name.value} onChange={(e) => name.set(e.target.value)} placeholder="Acme Clinic" />
      </Field>
      <Field label="Greeting" htmlFor="bi-greeting" hint="Spoken at the start of every conversation.">
        <Input id="bi-greeting" value={greeting.value} onChange={(e) => greeting.set(e.target.value)} placeholder="Welcome to Acme Clinic! How can I help you today?" />
      </Field>
    </div>
  );
}

function HoursForm({ content, onChange }: { content: Record<string, unknown>; onChange: React.Dispatch<React.SetStateAction<Record<string, unknown>>> }) {
  const tz = useField(content, onChange as Setter, "timezone");
  const tzValid = tz.value === "" || Intl.DateTimeFormat().resolvedOptions().timeZone !== undefined;
  void tzValid;
  const validTz = (() => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz.value });
      return true;
    } catch {
      return false;
    }
  })();
  return (
    <div className="space-y-4">
      <Field
        label="IANA timezone"
        htmlFor="h-tz"
        hint="Times are interpreted in this timezone (e.g. Europe/Berlin)."
        error={tz.value && !validTz ? "Not a valid IANA timezone." : undefined}
      >
        <Input id="h-tz" value={tz.value} onChange={(e) => tz.set(e.target.value)} placeholder="Europe/Berlin" />
      </Field>
    </div>
  );
}

function AppointmentTypesForm({ content, onChange }: { content: Record<string, unknown>; onChange: React.Dispatch<React.SetStateAction<Record<string, unknown>>> }) {
  const num = typeof content["default_duration_minutes"] === "number" ? String(content["default_duration_minutes"]) : "";
  const [text, setText] = useState(num);
  const parsed = Number(text);
  const valid = text !== "" && Number.isFinite(parsed) && parsed >= 5 && parsed <= 480;
  return (
    <div className="space-y-4">
      <Field
        label="Default duration (minutes)"
        htmlFor="at-dur"
        hint="Used when the customer doesn't specify a length (5–480)."
        error={text !== "" && !valid ? "Enter minutes between 5 and 480." : undefined}
      >
        <Input
          id="at-dur"
          inputMode="numeric"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (valid) onChange((c) => ({ ...c, default_duration_minutes: parsed }));
          }}
          placeholder="45"
          className="tabular w-32"
        />
      </Field>
    </div>
  );
}

interface Faq {
  question?: string;
  answer?: string;
  keywords?: string[];
}

function FaqForm({ content, onChange }: { content: Record<string, unknown>; onChange: React.Dispatch<React.SetStateAction<Record<string, unknown>>> }) {
  const entries: Faq[] = Array.isArray(content["entries"]) ? (content["entries"] as Faq[]) : [];
  const update = (i: number, patch: Partial<Faq>) =>
    onChange((c) => {
      const next = entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e));
      return { ...c, entries: next };
    });
  const remove = (i: number) => onChange((c) => ({ ...c, entries: entries.filter((_, idx) => idx !== i) }));
  const add = () =>
    onChange((c) => ({ ...c, entries: [...entries, { question: "", answer: "", keywords: [] }] }));

  return (
    <div className="space-y-4">
      {entries.length === 0 && <p className="text-sm text-ink-3">No FAQs yet — add ones customers actually ask.</p>}
      {entries.map((f, i) => (
        <fieldset key={i} className="space-y-2.5 rounded-xl border border-line p-4">
          <legend className="micro">FAQ {i + 1}</legend>
          <Field label="Question" htmlFor={`fq-${i}`}>
            <Input id={`fq-${i}`} value={f.question ?? ""} onChange={(e) => update(i, { question: e.target.value })} placeholder="What are your opening hours?" />
          </Field>
          <Field label="Answer (returned exactly as written)" htmlFor={`fa-${i}`}>
            <Textarea id={`fa-${i}`} rows={2} className="font-sans" value={f.answer ?? ""} onChange={(e) => update(i, { answer: e.target.value })} placeholder="We are open Monday to Friday, 9am to 6pm." />
          </Field>
          <Field label="Keywords" htmlFor={`fk-${i}`} hint="Comma-separated words that should match this question.">
            <Input
              id={`fk-${i}`}
              value={(f.keywords ?? []).join(", ")}
              onChange={(e) => update(i, { keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              placeholder="opening, hours, open"
            />
          </Field>
          <Button size="sm" variant="danger" onClick={() => remove(i)}>Remove FAQ</Button>
        </fieldset>
      ))}
      <Button variant="secondary" size="sm" onClick={add}>+ Add FAQ</Button>
    </div>
  );
}

function JsonForm({ content, onChange, hint }: { content: Record<string, unknown>; onChange: React.Dispatch<React.SetStateAction<Record<string, unknown>>>; hint: string }) {
  const [text, setText] = useState(JSON.stringify(content, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  return (
    <div className="space-y-2.5">
      <Field label="Configuration (JSON)" htmlFor="json-cfg" hint={hint} error={parseError ?? undefined}>
        <Textarea
          id="json-cfg"
          rows={12}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            try {
              const parsed = JSON.parse(e.target.value) as Record<string, unknown>;
              onChange(() => parsed);
              setParseError(null);
            } catch (err) {
              setParseError(`Invalid JSON: ${err instanceof Error ? err.message : ""}`);
            }
          }}
        />
      </Field>
    </div>
  );
}
