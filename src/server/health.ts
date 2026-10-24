import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { checkDatabase } from "../db/clients.js";

export interface HealthDeps {
  pgPool: Pool;
  ollamaBase: string;
  fetchFn?: typeof fetch;
}

interface DependencyStatus {
  ok: boolean;
  error?: string;
}

async function checkOllama(base: string, fetchFn: typeof fetch): Promise<DependencyStatus> {
  try {
    const res = await fetchFn(new URL("/api/version", base), { signal: AbortSignal.timeout(3000) });
    return res.ok ? { ok: true } : { ok: false, error: `status ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unreachable" };
  }
}

/**
 * /healthz — liveness (process up).
 * /readyz — readiness: DB + Ollama reachable; degraded-but-honest states.
 * Sidecar model residency is NOT required (on-demand loading, ENVIRONMENT §4).
 */
export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps) {
  const fetchFn = deps.fetchFn ?? fetch;

  app.get("/healthz", async () => ({ status: "alive" }));

  app.get("/readyz", async (_request, reply) => {
    const [db, ollama] = await Promise.all([
      checkDatabase(deps.pgPool),
      checkOllama(deps.ollamaBase, fetchFn),
    ]);
    const ok = db.ok && ollama.ok;
    reply.code(ok ? 200 : 503);
    return { status: ok ? "ready" : "degraded", dependencies: { database: db, ollama } };
  });
}
