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
import { OllamaProvider } from "../ai/ollamaProvider.js";
import { BookingService } from "../domain/booking/service.js";
import { ConversationService } from "../domain/conversation/service.js";
import { ExtractionService } from "../domain/extraction/service.js";
import { KnowledgeService } from "../domain/knowledge/service.js";
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
export async function createProductionApp(rawEnv: Record<string, string | undefined>): Promise<ProductionApp> {
  const env = loadEnv(rawEnv);
  const logger = createLogger(env);
  const db = createDbClients(env);

  const audit = new PgAuditRepo(db.pgPool);
  const config = new PgBusinessConfigRepo(db.pgPool);
  const bookingState = new PgBookingStateRepo(db.pgPool);
  const customers = new PgCustomerRepo(db.pgPool);
  const conversations = new PgConversationRepo(db.pgPool);
  const provider = new OllamaProvider(env.OLLAMA_BASE_URL, INITIAL_LOCAL_MODEL);
  const extraction = new ExtractionService({ provider, config });
  const knowledge = new KnowledgeService(config);

  // The escalation hook resolves lazily — the booking service is constructed
  // before the conversation service, and the hook only fires at runtime.
  let conversationServiceRef: ConversationService | undefined;
  const bookingService = new BookingService({
    bookingState,
    calendar: new MockCalendarAdapter(),
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
    provider,
    tokenHashSecret: env.TOKEN_HASH_SECRET,
    extraction,
    knowledge,
    bookingState,
    booking: bookingService,
  });
  conversationServiceRef = conversationService;

  const app = await buildApp({
    env,
    logger,
    pgPool: db.pgPool,
    ollamaBase: env.OLLAMA_BASE_URL,
    conversationService,
    bookingService,
    admin: {
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
    },
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await app.close();
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
