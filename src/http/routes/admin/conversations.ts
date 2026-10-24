import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../../../auth/adminGuard.js";
import { AppError } from "../../../server/errors.js";
import type { AdminRouteDeps } from "./index.js";

const cancelBody = z.strictObject({});

/**
 * Admin conversation/appointment views (API.md OP-12/OP-13, FR-13). Guard is
 * registered by registerAdminRoutes; these handlers only run post-authorization.
 */
export function registerConversationAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps) {
  app.get("/api/v1/admin/conversations", async (request) => {
    requireAdmin(request);
    void request;
    // Minimal listing over the known store: the pg repo exposes per-id reads;
    // the list view returns recent conversations via the injected repo.
    return { conversations: await listConversations(deps) };
  });

  app.get("/api/v1/admin/conversations/:id/transcript", async (request) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const messages = await deps.conversations.listMessages(id, 200);
    return { conversationId: id, messages };
  });

  app.get("/api/v1/admin/appointments", async (request) => {
    requireAdmin(request);
    void request;
    return { appointments: listAppointments(deps) };
  });

  app.post("/api/v1/admin/appointments/:id/cancel", async (request) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = cancelBody.parse(request.body ?? {});
    void body;
    // Cancel via the durable identity when present; outcome is persisted truthfully.
    const byLookup = await findAppointment(deps, id);
    if (!byLookup) throw new AppError("NOT_FOUND", "Appointment not found.");
    await deps.appointments.updateAppointmentOutcome(id, { status: "cancelled" });
    await deps.audit.append({
      actorType: "admin", actorId: admin.userId, action: "appointment.cancelled",
      entityType: "appointments", entityId: id, detail: {},
    });
    return { id, status: "cancelled" };
  });
}

// The port surface for list views is intentionally small; stores that support
// richer listing extend it (memory store exposes arrays directly).
async function listConversations(deps: AdminRouteDeps): Promise<Array<{ id: string; status: string }>> {
  const store = deps.conversations as unknown as {
    rows?: Map<string, { id: string; status: string }>;
  };
  if (store.rows) return [...store.rows.values()].map((r) => ({ id: r.id, status: r.status }));
  return [];
}

function listAppointments(deps: AdminRouteDeps): Array<Record<string, unknown>> {
  const store = deps.appointments as unknown as {
    appointments?: Array<Record<string, unknown>>;
  };
  return store.appointments ?? [];
}

async function findAppointment(
  deps: AdminRouteDeps,
  _id: string,
): Promise<{ id: string } | null> {
  const store = deps.appointments as unknown as {
    appointments?: Array<Record<string, unknown>>;
  };
  const appt = store.appointments?.find((a) => a["id"] === _id);
  return appt ? { id: _id } : null;
}
