import "dotenv/config";
import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import { loadEnv, ConfigValidationError, type Env } from "../config/env.js";
import { createLogger, type Logger } from "../observability/logger.js";
import { createDbClients, type DbClients } from "../db/clients.js";
import {
  PgAuditRepo,
  PgBookingStateRepo,
  PgBusinessConfigRepo,
  PgConsentRepo,
  PgConversationRepo,
  PgCustomerRepo,
} from "../db/pg/repos.js";
import { MockCalendarAdapter } from "../calendar/mockAdapter.js";
import { GoogleCalendarAdapter } from "../calendar/google/googleCalendarAdapter.js";
import { GoogleIntegrationService } from "../calendar/google/integration.js";
import { PgGoogleIntegrationStore } from "../calendar/google/store.js";
import type { CalendarProvider } from "../calendar/types.js";
import type { LLMProvider } from "../ai/types.js";
import { OllamaProvider } from "../ai/ollamaProvider.js";
import { BookingService } from "../domain/booking/service.js";
import { ConversationService } from "../domain/conversation/service.js";
import { ExtractionService } from "../domain/extraction/service.js";
import { KnowledgeService } from "../domain/knowledge/service.js";
import { ModelRegistry } from "../ai/registry.js";
import { RegistryBackedProvider } from "../ai/registryProvider.js";
import { PgModelProviderRepo } from "../db/pg/repos.js";
import { secretStoreFromVerification, verifyVault } from "../secrets/vault.js";
import { SidecarLifecycle, SidecarSpeechToText } from "../speech/sidecar.js";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { buildApp } from "./app.js";

/** Initial selected local runtime model (registry/switching arrives in Stage 4). */
const INITIAL_LOCAL_MODEL = "qwen3:1.7b";

export interface ProductionApp {
  app: FastifyInstance;
  env: Env;
  logger: Logger;
  db: DbClients;
  /** Exposed for composition verification and operational tooling. */
  services: { conversationService: ConversationService; bookingService: BookingService };
  shutdown: (signal: string) => Promise<void>;
}

/**
 * Real production composition (E2E hardening 1): every service receives its
 * full dependency set — the ConversationService includes the functioning
 * BookingService, extraction, knowledge and bookingState; the BookingService
 * includes audit, customer persistence, conversation linkage and the
 * escalation hook. Building performs no network I/O (clients are lazy), so
 * the exact composition is testable without credentials.
 */
export async function createProductionApp(
  rawEnv: Record<string, string | undefined>,
  opts: { localDatabase?: boolean; overrides?: { provider?: LLMProvider; calendar?: CalendarProvider } } = {},
): Promise<ProductionApp> {
  const env = loadEnv(rawEnv, opts.localDatabase ? { localDatabase: true } : undefined);
  const logger = createLogger(env);
  const db = createDbClients(env);

  const audit = new PgAuditRepo(db.pgPool);
  const config = new PgBusinessConfigRepo(db.pgPool);
  const bookingState = new PgBookingStateRepo(db.pgPool);
  const customers = new PgCustomerRepo(db.pgPool);
  const conversations = new PgConversationRepo(db.pgPool);
  const provider = opts.overrides?.provider ?? new OllamaProvider(env.OLLAMA_BASE_URL, INITIAL_LOCAL_MODEL);

  // ADR-0002 v0.2: read-only Vault verification at startup decides the store
  // (vault-active or fail-closed disabled). Local Ollama never depends on it.
  // Failure-safe: any verification error (including unreachable database)
  // yields the fail-closed disabled store — composition never blocks on I/O.
  const vaultVerification = await verifyVault(db.pgPool).catch(
    (err): { ok: false; reasons: string[] } => ({
      ok: false,
      reasons: [`verification unreachable: ${err instanceof Error ? err.message : "unknown"}`],
    }),
  );
  if (!vaultVerification.ok) {
    logger.warn({ reasons: vaultVerification.reasons }, "secret store fail-closed: Vault verification failed");
  }
  const secretStore = secretStoreFromVerification(vaultVerification, db.pgPool);
  const registry = new ModelRegistry({ repo: new PgModelProviderRepo(db.pgPool), localProvider: provider, secretStore });

  // Inference wiring (FR-17): conversation/extraction inference runs through
  // the registry — an admin model switch applies on the next inference.
  const inferenceProvider = opts.overrides?.provider ?? new RegistryBackedProvider({
    registry,
    makeLocal: (model) => new OllamaProvider(env.OLLAMA_BASE_URL, model),
    defaultLocalModel: INITIAL_LOCAL_MODEL, // documented owner-controlled default (qwen3:1.7b)
  });
  const extraction = new ExtractionService({ provider: inferenceProvider, config });
  const knowledge = new KnowledgeService(config);

  // Google Calendar (Stage 7 / Q3): the integration service is composed when
  // the OAuth environment is configured; the adapter becomes the active
  // CalendarProvider ONLY in CALENDAR_MODE=google. The adapter stays inert
  // until the owner completes the OAuth connection in the admin console, and
  // genuine event writes remain gated by the Q3 action authorization.
  let googleIntegration: GoogleIntegrationService | null = null;
  let calendar: CalendarProvider = opts.overrides?.calendar ?? new MockCalendarAdapter();
  if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI && env.GOOGLE_CALENDAR_ID) {
    googleIntegration = new GoogleIntegrationService({
      // Isolated persistence (migration-0007 table). Until the owner approves
      // the DDL, every store operation fails honestly and status reports the
      // pending migration — the mock calendar remains active.
      store: new PgGoogleIntegrationStore(db.pgPool),
      secretStore,
      audit,
      creds: {
        clientId: env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
        calendarId: env.GOOGLE_CALENDAR_ID,
      },
    });
    if (env.CALENDAR_MODE === "google") {
      calendar = new GoogleCalendarAdapter({ integration: googleIntegration, calendarId: env.GOOGLE_CALENDAR_ID });
      logger.info({ calendarId: env.GOOGLE_CALENDAR_ID }, "calendar mode: google (inert until the OAuth connection is completed in the admin console)");
    }
  }

  // The escalation hook resolves lazily — the booking service is constructed
  // before the conversation service, and the hook only fires at runtime.
  let conversationServiceRef: ConversationService | undefined;
  const bookingService = new BookingService({
    bookingState,
    calendar,
    tokenHashSecret: env.TOKEN_HASH_SECRET,
    offerTtlMinutes: 15,
    audit,
    customers,
    conversations,
    escalate: (conversationId, reason) => conversationServiceRef?.escalate(conversationId, reason) ?? Promise.resolve(),
  });
  const conversationService = new ConversationService({
    conversations,
    consent: new PgConsentRepo(db.pgPool),
    audit,
    config,
    provider: inferenceProvider,
    tokenHashSecret: env.TOKEN_HASH_SECRET,
    extraction,
    knowledge,
    bookingState,
    booking: bookingService,
  });
  conversationServiceRef = conversationService;

  // Speech sidecar (ADR-0005): on-demand lifecycle with a RAM admission
  // check; STT holds the shared inference gate (sequential with the LLM).
  const speechPython = resolve(process.platform === "win32" ? "sidecar/whisper/.venv/Scripts/python.exe" : "sidecar/whisper/.venv/bin/python");
  const sidecar = new SidecarLifecycle({
    port: env.WHISPER_SIDECAR_PORT,
    pythonCmd: existsSync(speechPython) ? speechPython : process.platform === "win32" ? "python" : "python3",
    appPath: resolve("sidecar/whisper/app.py"),
    minFreeBytes: 1_200_000_000, // 1.2 GB admission floor for tiny-int8
  });
  const speech = new SidecarSpeechToText({ baseUrl: sidecar.baseUrl, timeoutMs: env.MAX_AUDIO_SECONDS * 1000 + 10_000 });

  const app = await buildApp({
    env,
    logger,
    pgPool: db.pgPool,
    ollamaBase: env.OLLAMA_BASE_URL,
    conversationService,
    bookingService,
    audio: {
      conversationService,
      speech: {
        transcribe: async (audio, maxSeconds) => {
          await sidecar.ensureStarted();
          return speech.transcribe(audio, maxSeconds);
        },
        healthCheck: () => speech.healthCheck(),
        stop: () => sidecar.stop(),
      },
      maxAudioBytes: env.MAX_AUDIO_MB * 1024 * 1024,
      maxAudioSeconds: env.MAX_AUDIO_SECONDS,
    },
    admin: {
      registry,
      verifyAdmin: async (token) => {
        const { data, error } = await db.supabase.auth.getUser(token);
        return error || !data?.user ? null : { userId: data.user.id };
      },
      isAdminMember: async (userId) => {
        const { data } = await db.supabase
          .from("app_admins")
          .select("user_id")
          .eq("user_id", userId)
          .maybeSingle();
        return data !== null;
      },
      config,
      customers,
      conversations,
      appointments: bookingState,
      booking: bookingService,
      audit,
      googleIntegration,
    },
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await app.close();
    await sidecar.stop();
    await db.close();
  };

  return { app, env, logger, db, services: { conversationService, bookingService }, shutdown };
}

export async function main(): Promise<void> {
  let production: ProductionApp;
  try {
    production = await createProductionApp(process.env);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      // Fail fast, without echoing any values.
      for (const issue of err.issues) console.error(`config: ${issue}`);
      process.exit(1);
    }
    throw err;
  }

  process.on("SIGTERM", () => void production.shutdown("SIGTERM").then(() => process.exit(0)));
  process.on("SIGINT", () => void production.shutdown("SIGINT").then(() => process.exit(0)));

  await production.app.listen({ port: production.env.PORT, host: "127.0.0.1" });
  production.logger.info({ port: production.env.PORT }, "ai-receptionist backend listening (loopback only)");
}

// Canonical ESM entry check — works for tsx (src) and the compiled dist file.
const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
