import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  AuditRepo,
  BookingStateRepo,
  BusinessConfigRepo,
  ConversationRepo,
  CustomerRepo,
} from "../../../db/ports.js";
import { createAdminGuard, requireAdmin, type AdminVerifier } from "../../../auth/adminGuard.js";
import { AppError } from "../../../server/errors.js";
import type { BookingService } from "../../../domain/booking/service.js";
import { registerConversationAdminRoutes } from "./conversations.js";
import { registerModelAdminRoutes } from "./models.js";

const CONFIG_CATEGORIES = [
  "business_info",
  "hours",
  "services",
  "faqs",
  "appointment_types",
  "escalation",
] as const;

const configBody = z.strictObject({ content: z.record(z.string(), z.unknown()) });
const customerCreate = z.strictObject({
  displayName: z.string().min(1).max(200),
  contactEmail: z.string().email().max(200).optional(),
  contactPhone: z.string().min(3).max(50).optional(),
  notes: z.string().max(2000).optional(),
});
const customerPatch = z.strictObject({
  displayName: z.string().min(1).max(200).optional(),
  contactEmail: z.string().email().max(200).nullable().optional(),
  contactPhone: z.string().min(3).max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export interface AdminRouteDeps {
  registry: import("../../../ai/registry.js").ModelRegistry;
  verifyAdmin: AdminVerifier;
  isAdminMember: (userId: string) => Promise<boolean>;
  config: BusinessConfigRepo;
  customers: CustomerRepo;
  conversations: ConversationRepo;
  appointments: BookingStateRepo;
  booking: BookingService;
  audit: AuditRepo;
}

/**
 * Administrative APIs (API.md OP-10…OP-13, FR-13/FR-14). Every route runs the
 * admin guard (identity verify + membership, 60 s freshness), never trusts
 * client privilege fields, and writes an audit entry for consequential
 * mutations. Field exposure per the AUTH access matrix.
 */
export function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps) {
  const guard = createAdminGuard({ verify: deps.verifyAdmin, isMember: deps.isAdminMember });
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/v1/admin/") || request.url === "/api/v1/admin") return;
    await guard(request, reply);
  });

  registerConfigRoutes(app, deps);
  registerCustomerRoutes(app, deps);
  registerConversationAdminRoutes(app, deps);
  registerModelAdminRoutes(app, { registry: deps.registry, audit: deps.audit });
}

function registerConfigRoutes(app: FastifyInstance, deps: AdminRouteDeps) {
  app.get("/api/v1/admin/business-config/:category", async (request) => {
    requireAdmin(request);
    const { category } = request.params as { category: string };
    if (!CONFIG_CATEGORIES.includes(category as (typeof CONFIG_CATEGORIES)[number])) {
      throw new AppError("NOT_FOUND", "Unknown configuration category.");
    }
    const latest = await deps.config.latest(category);
    return { category, ...(latest ?? { content: {}, version: 0 }) };
  });

  app.put("/api/v1/admin/business-config/:category", async (request) => {
    const admin = requireAdmin(request);
    const { category } = request.params as { category: string };
    if (!CONFIG_CATEGORIES.includes(category as (typeof CONFIG_CATEGORIES)[number])) {
      throw new AppError("NOT_FOUND", "Unknown configuration category.");
    }
    const body = configBody.parse(request.body);
    const current = await deps.config.latest(category);
    const version = (current?.version ?? 0) + 1;
    await deps.config.insertVersion(category, body.content, version, admin.userId);
    await deps.audit.append({
      actorType: "admin", actorId: admin.userId, action: "business_config.updated",
      entityType: "business_config", entityId: category, detail: { version },
    });
    return { category, version };
  });
}

function registerCustomerRoutes(app: FastifyInstance, deps: AdminRouteDeps) {
  app.get("/api/v1/admin/customers", async (request) => {
    requireAdmin(request);
    const { limit } = request.query as { limit?: string };
    const parsed = Math.min(Math.max(Number(limit ?? 50) || 50, 1), 100);
    return { customers: await deps.customers.list(parsed) };
  });

  app.post("/api/v1/admin/customers", async (request, reply) => {
    const admin = requireAdmin(request);
    const body = customerCreate.parse(request.body);
    const created = await deps.customers.create(body);
    await deps.audit.append({
      actorType: "admin", actorId: admin.userId, action: "customer.created",
      entityType: "customers", entityId: created.id, detail: {},
    });
    reply.code(201);
    return created;
  });

  app.patch("/api/v1/admin/customers/:id", async (request) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = customerPatch.parse(request.body);
    if (!(await deps.customers.findById(id))) throw new AppError("NOT_FOUND", "Customer not found.");
    await deps.customers.updateContact(id, body);
    await deps.audit.append({
      actorType: "admin", actorId: admin.userId, action: "customer.updated",
      entityType: "customers", entityId: id, detail: {},
    });
    return await deps.customers.findById(id);
  });

  app.delete("/api/v1/admin/customers/:id", async (request) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    if (!(await deps.customers.findById(id))) throw new AppError("NOT_FOUND", "Customer not found.");
    await deps.customers.anonymize(id); // approved policy: anonymize, keep row
    await deps.audit.append({
      actorType: "admin", actorId: admin.userId, action: "customer.anonymized",
      entityType: "customers", entityId: id, detail: {},
    });
    return { anonymized: true };
  });
}
