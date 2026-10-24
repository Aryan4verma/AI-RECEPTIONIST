import "dotenv/config";
import { loadEnv, ConfigValidationError } from "../config/env.js";
import { createLogger } from "../observability/logger.js";
import { createDbClients } from "../db/clients.js";
import {
  PgAuditRepo,
  PgCustomerRepo,
  PgBookingStateRepo,
  PgBusinessConfigRepo,
  PgConsentRepo,
  PgConversationRepo,
} from "../db/pg/repos.js";
import { MockCalendarAdapter } from "../calendar/mockAdapter.js";
import { OllamaProvider } from "../ai/ollamaProvider.js";
import { BookingService } from "../domain/booking/service.js";
import { ConversationService } from "../domain/conversation/service.js";
import { buildApp } from "./app.js";

/** Initial selected local runtime model (registry/switching arrives in Stage 4). */
const INITIAL_LOCAL_MODEL = "qwen3:1.7b";

export async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      // Fail fast, without echoing any values.
      for (const issue of err.issues) console.error(`config: ${issue}`);
      process.exit(1);
    }
    throw err;
  }

  const logger = createLogger(env);
  const db = createDbClients(env);

  const provider = new OllamaProvider(env.OLLAMA_BASE_URL, INITIAL_LOCAL_MODEL);
  const audit = new PgAuditRepo(db.pgPool);
  const conversationService = new ConversationService({
    conversations: new PgConversationRepo(db.pgPool),
    consent: new PgConsentRepo(db.pgPool),
    audit,
    config: new PgBusinessConfigRepo(db.pgPool),
    provider,
    tokenHashSecret: env.TOKEN_HASH_SECRET,
  });
  // CALENDAR_MODE=google requires Q3 authorization; env validation already
  // refuses it — the mock adapter is the only wired provider at this stage.
  const bookingService = new BookingService({
    bookingState: new PgBookingStateRepo(db.pgPool),
    calendar: new MockCalendarAdapter(),
    tokenHashSecret: env.TOKEN_HASH_SECRET,
    offerTtlMinutes: 15,
    audit,
    escalate: (conversationId, reason) => conversationService.escalate(conversationId, reason),
  });

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
      config: new PgBusinessConfigRepo(db.pgPool),
      customers: new PgCustomerRepo(db.pgPool),
      conversations: new PgConversationRepo(db.pgPool),
      appointments: new PgBookingStateRepo(db.pgPool),
      audit,
    },
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.PORT, host: "127.0.0.1" });
  logger.info({ port: env.PORT }, "ai-receptionist backend listening (loopback only)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
