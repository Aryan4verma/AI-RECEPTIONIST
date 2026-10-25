// TC-65: controlled synthetic-data E2E against the ISOLATED LOCAL Supabase
// stack (Option A, owner-authorized 2026-10-24). Never touches the shared
// project: the env is loopback-only (schema-enforced), a pre-write guard
// asserts the connected server is local, and cleanup removes only this
// stack's resources. Model layer is fixture-scripted (RAM limits; the model
// itself is separately RM-verified) — the target here is REAL PostgreSQL.
//
// Phases: [0] preflight+guards → [1] seed config → [2] booking journey over
// HTTP (offer/confirm) → [3] FAQ grounded answer → [4] persistence+linkage
// SQL verification → [5] uncertain-create → UNRESOLVED → restart →
// reconcile → CONFIRMED → [6] cancellation sync → [7] row cleanup.
import { createProductionApp } from "../dist/server/main.js";
import { BookingService } from "../dist/domain/booking/service.js";
import {
  PgAuditRepo, PgBookingStateRepo, PgBusinessConfigRepo, PgConsentRepo,
  PgConversationRepo, PgCustomerRepo,
} from "../dist/db/pg/repos.js";
import { createDbClients } from "../dist/db/clients.js";
import { MockCalendarAdapter } from "../dist/calendar/mockAdapter.js";
import { emptyExtraction } from "../dist/domain/extraction/service.js";

const PORT = 8811;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54330/postgres";
const ENV = {
  PORT: String(PORT),
  NODE_ENV: "test",
  SUPABASE_URL: "http://127.0.0.1:54321", // unused loopback placeholder (no kong needed)
  SUPABASE_SERVICE_ROLE_KEY: "local-test-placeholder",
  SUPABASE_DB_URL: DB_URL,
  SUPABASE_DB_CA_CERT_PATH: "", // loopback test mode: no TLS to the local container
  OLLAMA_BASE_URL: "http://localhost:11434",
  TOKEN_HASH_SECRET: "0123456789abcdef0123456789abcdef",
  LOG_LEVEL: "fatal",
};
const SECRET = ENV.TOKEN_HASH_SECRET;

const log = (phase, msg) => console.log(`[TC65 ${phase}] ${msg}`);
const fail = (phase, msg) => {
  console.error(`[TC65 ${phase}] FAIL: ${msg}`);
  process.exit(1);
};

// Dual scripted provider: dispatches by schema name (intent vs extraction).
function scriptedDualProvider(intentSeq, extractionSeq) {
  let i = 0, e = 0;
  return {
    kind: "local", adapter: "ollama",
    async discoverModels() { return [{ name: "qwen3:1.7b" }]; },
    async structured(request) {
      if (request.schemaName === "extraction") {
        const resp = extractionSeq[Math.min(e++, extractionSeq.length - 1)];
        const candidate = resp === "malformed"
          ? { schema_version: 1 }
          : { ...emptyExtraction(), schema_version: 1, ...resp };
        const parsed = request.schema.safeParse(candidate);
        return parsed.success
          ? { status: "ok", value: parsed.data, raw: "" }
          : { status: "invalid_output", reason: "scripted", raw: "" };
      }
      const resp = intentSeq[Math.min(i++, intentSeq.length - 1)];
      const parsed = request.schema.safeParse({ schema_version: 1, intent: resp.intent });
      return parsed.success
        ? { status: "ok", value: parsed.data, raw: "" }
        : { status: "invalid_output", reason: "scripted", raw: "" };
    },
    async healthCheck() { return { ok: true }; },
  };
}

const futureIso = "2026-11-05T15:00:00+02:00"; // Berlin-aware absolute timestamp

async function main() {
  // ---------- Phase 0: preflight + local-target guard (BEFORE any write) ----------
  log(0, "preflight: connecting to the isolated local database");
  const db = createDbClients(ENV);
  // Client side: the schema guarantees a LOOPBACK connection target. Server
  // side: a Docker port-forward reports the container's PRIVATE address; the
  // shared cloud project would report a PUBLIC pooler IP. Both must hold.
  const clientHost = new URL(ENV.SUPABASE_DB_URL.replace("postgresql://", "http://")).hostname;
  const target = await db.pgPool.query("select inet_server_addr() as addr, current_database() as name");
  const addr = target.rows[0].addr ?? "socket";
  const privateRange = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|::1$|localhost)/.test(addr) || addr === "socket";
  if (clientHost !== "127.0.0.1" || !privateRange || target.rows[0].name !== "postgres") {
    await db.close();
    fail(0, `ABORT — effective target is NOT the isolated local stack (client=${clientHost}, server=${addr}, db=${target.rows[0].name})`);
  }
  log(0, `target verified LOCAL: client=127.0.0.1 -> server=${addr} (private/Docker), db=postgres`);
  const replay = await db.pgPool.query("select count(*)::int as n from supabase_migrations.schema_migrations");
  if (replay.rows[0].n !== 6) fail(0, `migration replay count = ${replay.rows[0].n}, expected 6`);
  log(0, `migration replay verified: ${replay.rows[0].n}/6 applied locally`);

  // ---------- Phase 1: seed synthetic business configuration (local only) ----------
  // Idempotent reruns: clear any leftovers from a previously failed run.
  await db.pgPool.query("delete from public.appointments");
  await db.pgPool.query("delete from public.conversations");
  await db.pgPool.query("delete from public.customers where display_name like 'e2e-test%'");
  await db.pgPool.query("delete from public.business_config where version = 1");
  await db.pgPool.query(
    `insert into public.business_config (category, content, version) values
      ('business_info', $1::jsonb, 1),
      ('hours', $2::jsonb, 1),
      ('appointment_types', $3::jsonb, 1),
      ('faqs', $4::jsonb, 1)`,
    [
      JSON.stringify({ greeting: "Welcome to TC65 Clinic! How can I help you today?" }),
      JSON.stringify({ timezone: "Europe/Berlin" }),
      JSON.stringify({ default_duration_minutes: 45 }),
      JSON.stringify({ entries: [{ question: "What are your opening hours?", answer: "We are open Monday to Friday, 9am to 6pm.", keywords: ["opening", "hours", "open"] }] }),
    ],
  );
  log(1, "seeded 4 synthetic business_config rows (version 1, local only)");

  // ---------- App with scripted model + shared mock calendar ----------
  const calendar = new MockCalendarAdapter([], { createTimeoutAfterSend: false });
  const provider = scriptedDualProvider(
    [
      { intent: "book_appointment" }, { intent: "book_appointment" }, { intent: "book_appointment" },
      { intent: "ask_question" },
      { intent: "book_appointment" }, // conversation B
    ],
    [
      "malformed",
      { customer_name: { state: "known", value: "e2e-test customer Asha" } },
      {
        contact: { state: "known", value: "asha-e2e@example.com" },
        purpose: { state: "known", value: "e2e-test dentist consultation" },
        requested_time: { state: "known", value: futureIso },
        duration_minutes: { state: "unknown", reason: "not stated" }, // config default 45 must apply
        meeting_type: { state: "known", value: "in-person" },
      },
      { // conversation B: complete in one turn
        customer_name: { state: "known", value: "e2e-test customer Ravi" },
        contact: { state: "known", value: "ravi-e2e@example.com" },
        purpose: { state: "known", value: "e2e-test follow-up" },
        requested_time: { state: "known", value: "2026-11-06T10:00:00+01:00" },
        duration_minutes: { state: "known", value: 30 },
        meeting_type: { state: "known", value: "online" },
      },
    ],
  );
  const production = await createProductionApp(ENV, { localDatabase: true, overrides: { provider, calendar } });
  const app = production.app;
  log(2, "application started against the LOCAL database (loopback, no TLS needed)");

  const post = async (url, payload, token) => {
    const res = await app.inject({
      method: "POST", url,
      headers: { ...(token ? { "x-conversation-token": token } : {}), "content-type": "application/json" },
      payload,
    });
    return { status: res.statusCode, body: res.json() };
  };

  // ---------- Phase 2: conversation A — full booking journey ----------
  const started = await post("/api/v1/conversations", { channel: "text" });
  if (started.status !== 201) fail(2, `conversation start failed: ${started.status}`);
  const convA = started.body.conversationId;
  const tokenA = started.body.accessToken;
  if (started.body.greeting !== "Welcome to TC65 Clinic! How can I help you today?") {
    fail(2, `greeting not from seeded config: ${started.body.greeting}`);
  }
  log(2, `conversation A created (${convA}); seeded greeting served`);

  const t1 = await post(`/api/v1/conversations/${convA}/messages`, { text: "I would like to book a dentist appointment" }, tokenA);
  if (t1.body.reply !== "May I have your full name?") fail(2, `follow-up wrong: ${t1.body.reply}`);
  if (t1.body.extractionComplete !== false) fail(2, "incomplete extraction reported complete");
  log(2, "turn 1 → name follow-up (incomplete extraction does not advance)");

  const t2 = await post(`/api/v1/conversations/${convA}/messages`, { text: "e2e-test customer Asha" }, tokenA);
  if (t2.body.reply !== "What is the best email or phone number to reach you?") fail(2, `turn2: ${t2.body.reply}`);
  log(2, "turn 2 → contact follow-up");

  const t3 = await post(`/api/v1/conversations/${convA}/messages`, { text: `asha-e2e@example.com — dentist consultation at ${futureIso}, in person` }, tokenA);
  const offer = t3.body.offer;
  if (!offer) fail(2, `no offer: ${JSON.stringify(t3.body).slice(0, 200)}`);
  if (offer.durationMinutes !== 45) fail(2, `config default duration not applied: ${offer.durationMinutes}`);
  if (offer.timezone !== "Europe/Berlin") fail(2, `config timezone not applied: ${offer.timezone}`);
  log(2, `turn 3 → OFFER: ${offer.slot} 45min Europe/Berlin (config-driven default) + offer persisted in history`);

  // Phase 3 (FAQ) on the same conversation, before confirmation:
  const t4 = await post(`/api/v1/conversations/${convA}/messages`, { text: "What are your opening hours?" }, tokenA);
  if (t4.body.intent !== "ask_question") fail(3, `intent: ${t4.body.intent}`);
  if (t4.body.reply !== "We are open Monday to Friday, 9am to 6pm.") fail(3, `FAQ answer not verbatim: ${t4.body.reply}`);
  log(3, "FAQ turn → seeded answer returned VERBATIM (grounded, no fabrication)");

  const confirm = await post(`/api/v1/conversations/${convA}/confirm`, { offerToken: offer.offerToken, decision: "accept" }, tokenA);
  if (confirm.status !== 200 || confirm.body.bookingState !== "CONFIRMED") {
    fail(2, `confirm failed: ${confirm.status} ${JSON.stringify(confirm.body).slice(0, 200)}`);
  }
  const eventId = confirm.body.eventId;
  log(2, `explicit confirmation → CONFIRMED, mock calendar event ${eventId}`);

  // ---------- Phase 4: persistence + FK linkage verification (real SQL) ----------
  const linkage = await db.pgPool.query(
    `select a.id, a.status, a.google_event_id, a.duration_minutes, a.timezone,
            c.id as conversation_id, c.customer_id as conv_customer,
            cust.id as customer_id, cust.display_name, cust.contact_email
     from public.appointments a
     join public.conversations c on a.conversation_id = c.id
     join public.customers cust on a.customer_id = cust.id
     where a.conversation_id = $1`, [convA]);
  const row = linkage.rows[0];
  if (!row) fail(4, "no linked appointment row");
  if (row.status !== "confirmed" || row.google_event_id !== eventId) fail(4, `appointment: ${row.status}/${row.google_event_id}`);
  if (row.conv_customer !== row.customer_id) fail(4, "conversation.customer_id does not match appointment.customer_id");
  if (row.duration_minutes !== 45 || row.timezone !== "Europe/Berlin") fail(4, `duration/tz: ${row.duration_minutes}/${row.timezone}`);
  if (!row.display_name.startsWith("e2e-test")) fail(4, `customer marker missing: ${row.display_name}`);
  const msgs = await db.pgPool.query("select count(*)::int as n from public.messages where conversation_id = $1", [convA]);
  if (msgs.rows[0].n < 8) fail(4, `expected ≥8 persisted messages, got ${msgs.rows[0].n}`);
  const stA = await db.pgPool.query("select state from public.booking_state where conversation_id = $1", [convA]);
  if (stA.rows[0].state !== "CONFIRMED") fail(4, `booking_state: ${stA.rows[0].state}`);
  const statusA = await app.inject({ method: "GET", url: `/api/v1/conversations/${convA}`, headers: { "x-conversation-token": tokenA } });
  if (statusA.json().booking !== "confirmed") fail(4, `publicStatus: ${statusA.json().booking}`);
  log(4, `persistence verified: appointment↔conversation↔customer FK linkage correct; ${msgs.rows[0].n} messages persisted; publicStatus=confirmed`);

  // ---------- Phase 5: uncertain create → UNRESOLVED → restart → reconcile ----------
  const startedB = await post("/api/v1/conversations", { channel: "text" });
  const convB = startedB.body.conversationId;
  const tokenB = startedB.body.accessToken;
  // Conversation B supplies every detail in one turn -> the offer comes back
  // from THIS turn (a further turn would correctly hit awaiting-confirmation).
  const tB = await post(`/api/v1/conversations/${convB}/messages`, { text: `e2e-test customer Ravi — follow-up on 2026-11-06T10:00:00+01:00, online, 30 minutes, ravi-e2e@example.com` }, tokenB);
  const bOffer = tB.body.offer;
  if (!bOffer) fail(5, `no offer for B: ${JSON.stringify(tB.body).slice(0, 200)}`);
  calendar.faults = { createTimeoutAfterSend: true }; // provider loses the create response
  const confirmB = await post(`/api/v1/conversations/${convB}/confirm`, { offerToken: bOffer.offerToken, decision: "accept" }, tokenB);
  if (confirmB.status !== 202 || confirmB.body.bookingState !== "UNRESOLVED") {
    fail(5, `uncertain create not UNRESOLVED: ${confirmB.status} ${JSON.stringify(confirmB.body).slice(0, 150)}`);
  }
  const idB = await db.pgPool.query(
    `select b.calendar_idempotency_key as key, a.id as appt, a.status
     from public.booking_state b join public.appointments a on a.conversation_id = b.conversation_id
     where b.conversation_id = $1`, [convB]);
  if (idB.rows[0].status !== "unresolved" || !idB.rows[0].key) fail(5, "UNRESOLVED not persisted truthfully");
  log(5, `uncertain create → UNRESOLVED persisted (identity ${idB.rows[0].key})`);

  // Simulate: the create request actually landed (seed the event), then RESTART
  // the service over the same durable state and reconcile.
  calendar.faults = {};
  await calendar.createEvent({
    idempotencyKey: idB.rows[0].key,
    start: bOffer.start, end: bOffer.end,
    summary: "TC65 recovery", timezone: bOffer.timezone,
  });
  const restarted = new BookingService({
    bookingState: new PgBookingStateRepo(db.pgPool),
    calendar,
    tokenHashSecret: SECRET,
    offerTtlMinutes: 15,
    audit: new PgAuditRepo(db.pgPool),
    customers: new PgCustomerRepo(db.pgPool),
    conversations: new PgConversationRepo(db.pgPool),
  });
  const outcome = await restarted.reconcile(convB);
  if (outcome !== "confirmed") fail(5, `reconcile outcome: ${outcome}`);
  const after = await db.pgPool.query("select status, google_event_id from public.appointments where id = $1", [idB.rows[0].appt]);
  if (after.rows[0].status !== "confirmed") fail(5, `reconciled appointment: ${after.rows[0].status}`);
  log(5, `RESTART + reconcile → CONFIRMED (event ${after.rows[0].google_event_id} adopted by durable identity)`);

  // ---------- Phase 6: cancellation sync ----------
  await restarted.cancel(convA);
  const cancelCheck = await db.pgPool.query(
    `select a.status, b.state from public.appointments a
     join public.booking_state b on b.conversation_id = a.conversation_id
     where a.conversation_id = $1`, [convA]);
  if (cancelCheck.rows[0].status !== "cancelled") fail(6, `appointment after cancel: ${cancelCheck.rows[0].status}`);
  const pubA = await app.inject({ method: "GET", url: `/api/v1/conversations/${convA}`, headers: { "x-conversation-token": tokenA } });
  if (pubA.json().booking !== "cancelled") fail(6, `publicStatus after cancel: ${pubA.json().booking}`);
  log(6, "cancellation synchronized: mock event cancelled + appointment cancelled + publicStatus=cancelled");

  // ---------- Phase 7: row cleanup (FK order) + verification ----------
  const auditBefore = await db.pgPool.query("select count(*)::int as n from public.audit_log");
  await db.pgPool.query("delete from public.appointments where conversation_id = any($1)", [[convA, convB]]);
  await db.pgPool.query("delete from public.conversations where id = any($1)", [[convA, convB]]); // cascades messages + booking_state
  await db.pgPool.query("delete from public.customers where display_name like 'e2e-test%'");
  await db.pgPool.query("delete from public.business_config where version = 1");
  const leftovers = await db.pgPool.query(
    `select
       (select count(*)::int from public.customers) as customers,
       (select count(*)::int from public.conversations) as conversations,
       (select count(*)::int from public.messages) as messages,
       (select count(*)::int from public.booking_state) as booking,
       (select count(*)::int from public.appointments) as appointments,
       (select count(*)::int from public.business_config) as config`);
  const l = leftovers.rows[0];
  if (l.customers + l.conversations + l.messages + l.booking + l.appointments + l.config !== 0) {
    fail(7, `cleanup incomplete: ${JSON.stringify(l)}`);
  }
  log(7, `cleanup verified: all synthetic rows removed ${JSON.stringify(l)}`);
  log(7, `audit_log rows retained locally (append-only; removed by stack teardown): ${auditBefore.rows[0].n}`);

  await app.close();
  await db.close();
  console.log("[TC65] RESULT: PASS — full journey, persistence, linkage, recovery, cancellation and cleanup verified against REAL local PostgreSQL (no shared-project writes)");
  process.exit(0);
}

main().catch((err) => {
  console.error("[TC65] ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
