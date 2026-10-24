import "dotenv/config";
import { loadEnv, ConfigValidationError } from "../config/env.js";
import { createLogger } from "../observability/logger.js";
import { createDbClients } from "../db/clients.js";
import { buildApp } from "./app.js";

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
  const app = await buildApp({ env, logger, pgPool: db.pgPool, ollamaBase: env.OLLAMA_BASE_URL });

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
