import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../../../auth/adminGuard.js";
import type { ModelRegistry } from "../../../ai/registry.js";
import type { AuditRepo } from "../../../db/ports.js";

const providerPost = z.strictObject({
  kind: z.enum(["local", "cloud"]),
  adapter: z.enum(["ollama", "openai_compatible"]),
  displayName: z.string().min(1).max(200),
  baseUrl: z.string().max(500).optional(),
  modelId: z.string().max(200).optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  credential: z.string().min(1).max(500).optional(),
});
const providerPatch = z.strictObject({
  displayName: z.string().min(1).max(200).optional(),
  baseUrl: z.string().max(500).optional(),
  modelId: z.string().max(200).optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
});
const credentialPut = z.strictObject({ apiKey: z.string().min(1).max(500) });
const activePut = z.strictObject({ providerId: z.string().uuid(), modelId: z.string().max(200).optional() });

/**
 * AI Models & Providers admin routes (API.md OP-14…OP-18, FR-15…FR-18).
 * Credential values are write-only; responses carry `hasCredential` only.
 * The credential route fails closed when the secret store is not verified.
 */
export function registerModelAdminRoutes(
  app: FastifyInstance,
  deps: { registry: ModelRegistry; audit: AuditRepo },
) {
  app.get("/api/v1/admin/models/local", async (request) => {
    requireAdmin(request);
    const models = await deps.registry.listLocalModels();
    return { ollama: { reachable: true, models } };
  });

  app.get("/api/v1/admin/providers", async (request) => {
    requireAdmin(request);
    return { providers: await deps.registry.listProviders() };
  });

  app.post("/api/v1/admin/providers", async (request, reply) => {
    const admin = requireAdmin(request);
    const body = providerPost.parse(request.body);
    const created = await deps.registry.addProvider(body);
    await deps.audit.append({
      actorType: "admin", actorId: admin.userId, action: "provider.created",
      entityType: "model_providers", entityId: created.id, detail: { kind: created.kind },
    });
    reply.code(201);
    return created;
  });

  app.patch("/api/v1/admin/providers/:id", async (request) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = providerPatch.parse(request.body);
    const updated = await deps.registry.updateProvider(id, body);
    await deps.audit.append({
      actorType: "admin", actorId: admin.userId, action: "provider.updated",
      entityType: "model_providers", entityId: id, detail: {},
    });
    return updated;
  });

  app.delete("/api/v1/admin/providers/:id", async (request) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    await deps.registry.removeProvider(id);
    await deps.audit.append({
      actorType: "admin", actorId: admin.userId, action: "provider.deleted",
      entityType: "model_providers", entityId: id, detail: {},
    });
    return { deleted: true };
  });

  app.put("/api/v1/admin/providers/:id/credential", async (request) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = credentialPut.parse(request.body);
    const result = await deps.registry.setCredential(id, body.apiKey);
    await deps.audit.append({
      actorType: "admin", actorId: admin.userId, action: "provider.credential_set",
      entityType: "model_providers", entityId: id, detail: { masked: result.masked },
    });
    return result;
  });

  app.post("/api/v1/admin/providers/:id/test", async (request) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const result = await deps.registry.testProvider(id);
    await deps.audit.append({
      actorType: "admin", actorId: admin.userId, action: "provider.tested",
      entityType: "model_providers", entityId: id, detail: { status: result.status },
    });
    return result;
  });

  app.put("/api/v1/admin/settings/active-model", async (request) => {
    const admin = requireAdmin(request);
    const body = activePut.parse(request.body);
    const result = await deps.registry.setActive(body.providerId, body.modelId);
    await deps.audit.append({
      actorType: "admin", actorId: admin.userId, action: "model.active_changed",
      entityType: "model_providers", entityId: result.providerId,
      detail: { modelId: result.modelId, appliesFrom: result.appliesFrom },
    });
    return result;
  });
}
