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
      // Hours and Services keep their own category data AND sync generated
      // FAQ entries — FAQs are the receptionist's only retrieval surface, so
      // knowledge saved here must exist there to be answerable.
      const generated =
        cat === "hours" ? hoursFaqs(content)
        : cat === "services" ? servicesFaqs(content)
        : null;
      let r = await adminApi.saveConfig(user.token, cat, content);
      if (generated) {
        const faqs = await adminApi.config(user.token, "faqs");
        const entries: FaqEntry[] = Array.isArray(faqs.content?.["entries"])
          ? (faqs.content["entries"] as FaqEntry[])
          : [];
        const kept = entries.filter((e) => (typeof e.source === "string" ? e.source : "") !== generated.source);
        const nextEntries = [...kept, ...generated.entries];
        r = await adminApi.saveConfig(user.token, "faqs", { ...(faqs.content ?? {}), entries: nextEntries });
        setToast({
          tone: "success",
          msg: `Saved — the receptionist can now answer these ${generated.entries.length ? `(${generated.entries.length} FAQ${generated.entries.length > 1 ? "s" : ""} generated)` : ""}`,
        });
      } else {
        setToast({ tone: "success", msg: `Saved (version ${r.version}) — live on new messages` });
      }
      setVersion(r.version);
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
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              cat === c.id ? "bg-pine-700 text-[#f4f1e8] shadow-card" : "border border-line-strong bg-surface text-ink-2 hover:border-ink-3"
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
          {cat === "services" && <ServicesForm content={content} onChange={setContentNonNull} />}
          {cat === "escalation" && (
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

/* ---------- Hours: per-day editor + generated retrievable FAQ ---------- */
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type Day = (typeof DAYS)[number];

interface DayRow {
  day: Day;
  open: boolean;
  start: string;
  end: string;
}

const DEFAULT_DAYS: DayRow[] = DAYS.map((d) => ({ day: d, open: d !== "saturday" && d !== "sunday", start: "09:00", end: "17:00" }));

function readDays(content: Record<string, unknown>): DayRow[] {
  const raw = Array.isArray(content["days"]) ? (content["days"] as Partial<DayRow>[]) : [];
  return DAYS.map((d, i) => {
    const r = raw.find((x) => x?.day === d) ?? raw[i];
    return {
      day: d,
      open: r?.open === true,
      start: typeof r?.start === "string" ? r.start : "09:00",
      end: typeof r?.end === "string" ? r.end : "17:00",
    };
  });
}

function hoursAnswer(days: DayRow[], tz: string): string {
  const open = days.filter((d) => d.open && d.start && d.end);
  if (open.length === 0) return "We don't have regular opening hours set — please contact us to arrange a time.";
  const parts: string[] = [];
  let i = 0;
  while (i < open.length) {
    const cur = open[i]!;
    let j = i;
    while (j + 1 < open.length && open[j + 1]!.start === cur.start && open[j + 1]!.end === cur.end) j++;
    const label = i === j ? cap(cur.day) : `${cap(cur.day)} to ${cap(open[j]!.day)}`;
    parts.push(`${label} ${cur.start}–${cur.end}`);
    i = j + 1;
  }
  return `Our opening hours are: ${parts.join(", ")}${tz ? ` (${tz})` : ""}.`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** FAQ entries generated from the hours editor (tagged, replaced on re-save). */
function hoursFaqs(content: Record<string, unknown>): { source: string; entries: FaqEntry[] } {
  const tz = typeof content["timezone"] === "string" ? content["timezone"] : "";
  const days = readDays(content);
  return {
    source: "auto:hours",
    entries: [
      {
        question: "What are your opening hours?",
        answer: hoursAnswer(days, tz),
        keywords: ["open", "opening", "hours"],
        source: "auto:hours",
      },
    ],
  };
}

function HoursForm({ content, onChange }: { content: Record<string, unknown>; onChange: React.Dispatch<React.SetStateAction<Record<string, unknown>>> }) {
  const tz = useField(content, onChange as Setter, "timezone");
  const days = readDays(content);
  const validTz = (() => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz.value });
      return true;
    } catch {
      return false;
    }
  })();
  const setDay = (i: number, patch: Partial<DayRow>) => {
    const next = days.map((d, idx) => (idx === i ? { ...d, ...patch } : d));
    onChange((c) => ({ ...c, days: next }));
  };
  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-ink-2">
        Regular hours per day. Saving also updates the receptionist's "opening hours" answer automatically.
      </p>
      <Field
        label="IANA timezone"
        htmlFor="h-tz"
        hint="Times are interpreted in this timezone (e.g. Europe/Berlin)."
        error={tz.value && !validTz ? "Not a valid IANA timezone." : undefined}
      >
        <Input id="h-tz" value={tz.value} onChange={(e) => tz.set(e.target.value)} placeholder="Europe/Berlin" />
      </Field>
      <div className="divide-y divide-line rounded-xl border border-line">
        {days.map((d, i) => (
          <div key={d.day} className="flex items-center gap-3 px-3.5 py-2.5">
            <label className="flex w-28 items-center gap-2 text-[13px] font-medium text-ink">
              <input type="checkbox" checked={d.open} onChange={(e) => setDay(i, { open: e.target.checked })} className="accent-pine-600" />
              {cap(d.day)}
            </label>
            {d.open ? (
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  aria-label={`${cap(d.day)} opens`}
                  value={d.start}
                  onChange={(e) => setDay(i, { start: e.target.value })}
                  className="tabular rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-[13px] text-ink focus:border-pine-600 focus:outline-none"
                />
                <span className="text-ink-3">–</span>
                <input
                  type="time"
                  aria-label={`${cap(d.day)} closes`}
                  value={d.end}
                  onChange={(e) => setDay(i, { end: e.target.value })}
                  className="tabular rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-[13px] text-ink focus:border-pine-600 focus:outline-none"
                />
              </div>
            ) : (
              <span className="text-[13px] text-ink-3">Closed</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Services: structured editor + generated retrievable FAQs ---------- */
interface ServiceItem {
  name: string;
  description: string;
  durationMinutes: number | null;
}

function readServices(content: Record<string, unknown>): ServiceItem[] {
  const raw = Array.isArray(content["items"]) ? (content["items"] as Partial<ServiceItem>[]) : [];
  return raw.map((r) => ({
    name: typeof r?.name === "string" ? r.name : "",
    description: typeof r?.description === "string" ? r.description : "",
    durationMinutes: typeof r?.durationMinutes === "number" ? r.durationMinutes : null,
  }));
}

function nameTokens(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
}

/** FAQ entries generated from the services editor (tagged, replaced on re-save). */
function servicesFaqs(content: Record<string, unknown>): { source: string; entries: FaqEntry[] } {
  const items = readServices(content).filter((s) => s.name.trim().length > 0);
  const entries: FaqEntry[] = items.map((s) => {
    const dur = s.durationMinutes ? ` (${s.durationMinutes} minutes)` : "";
    const desc = s.description ? ` — ${s.description}` : "";
    return {
      question: `Do you offer ${s.name}?`,
      answer: `Yes, we offer ${s.name}${dur}${desc}.`,
      keywords: nameTokens(s.name),
      source: "auto:services",
    };
  });
  if (items.length > 1) {
    entries.push({
      question: "What services do you offer?",
      answer: `We offer: ${items.map((s) => s.name).join(", ")}.`,
      keywords: ["services", "offer"],
      source: "auto:services",
    });
  }
  return { source: "auto:services", entries };
}

function ServicesForm({ content, onChange }: { content: Record<string, unknown>; onChange: React.Dispatch<React.SetStateAction<Record<string, unknown>>> }) {
  const items = readServices(content);
  const update = (i: number, patch: Partial<ServiceItem>) =>
    onChange((c) => {
      const next = readServices(c).map((s, idx) => (idx === i ? { ...s, ...patch } : s));
      return { ...c, items: next };
    });
  const remove = (i: number) => onChange((c) => ({ ...c, items: readServices(c).filter((_, idx) => idx !== i) }));
  const add = () => onChange((c) => ({ ...c, items: [...readServices(c), { name: "", description: "", durationMinutes: null }] }));
  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-ink-2">
        Services your business offers. Saving makes each one answerable by the receptionist ("Do you offer…?").
      </p>
      {items.map((s, i) => (
        <fieldset key={i} className="space-y-2.5 rounded-xl border border-line p-4">
          <legend className="micro">Service {i + 1}</legend>
          <div className="flex flex-wrap gap-2.5">
            <div className="min-w-44 flex-1">
              <Field label="Name" htmlFor={`sv-n-${i}`}>
                <Input id={`sv-n-${i}`} value={s.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Consultation" />
              </Field>
            </div>
            <div className="w-36">
              <Field label="Minutes (optional)" htmlFor={`sv-d-${i}`}>
                <Input
                  id={`sv-d-${i}`}
                  inputMode="numeric"
                  className="tabular"
                  value={s.durationMinutes ?? ""}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    update(i, { durationMinutes: e.target.value !== "" && Number.isFinite(n) && n > 0 ? n : null });
                  }}
                  placeholder="45"
                />
              </Field>
            </div>
          </div>
          <Field label="Short description (optional)" htmlFor={`sv-s-${i}`}>
            <Input id={`sv-s-${i}`} value={s.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="A 45-minute initial assessment" />
          </Field>
          <Button size="sm" variant="danger" onClick={() => remove(i)}>Remove</Button>
        </fieldset>
      ))}
      <Button variant="secondary" size="sm" onClick={add}>+ Add service</Button>
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

interface FaqEntry {
  question?: string;
  answer?: string;
  keywords?: string[];
  /** Marker for entries generated from the Hours/Services tabs. */
  source?: string;
}

function FaqForm({ content, onChange }: { content: Record<string, unknown>; onChange: React.Dispatch<React.SetStateAction<Record<string, unknown>>> }) {
  const entries: FaqEntry[] = Array.isArray(content["entries"]) ? (content["entries"] as FaqEntry[]) : [];
  const update = (i: number, patch: Partial<FaqEntry>) =>
    onChange((c) => {
      const next = entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e));
      return { ...c, entries: next };
    });
  const remove = (i: number) => onChange((c) => ({ ...c, entries: entries.filter((_, idx) => idx !== i) }));
  const add = () =>
    onChange((c) => ({ ...c, entries: [...entries, { question: "", answer: "", keywords: [] }] }));

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-ink-2">
        The receptionist answers questions with these entries <em>exactly as written</em>. Entries marked{" "}
        <span className="rounded bg-pine-50 px-1.5 py-0.5 text-[11px] font-semibold text-pine-700">Auto</span> are generated
        from Hours/Services and replaced when those tabs are saved.
      </p>
      {entries.length === 0 && <p className="text-sm text-ink-3">No FAQs yet — add ones customers actually ask.</p>}
      {entries.map((f, i) => (
        <fieldset key={i} className="space-y-2.5 rounded-xl border border-line p-4">
          <legend className="micro flex items-center gap-2">
            FAQ {i + 1}
            {f.source && (
              <span className="rounded bg-pine-50 px-1.5 py-0.5 text-[11px] font-semibold text-pine-700">Auto</span>
            )}
          </legend>
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
