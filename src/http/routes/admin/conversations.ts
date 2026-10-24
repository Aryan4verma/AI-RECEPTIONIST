import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../../../auth/adminGuard.js";
import { AppError } from "../../../server/errors.js";
import type { AdminRouteDeps } from "./index.js";

/**
 * Admin conversation/appointment views (API.md OP-12/OP-13, FR-13) over real
 * repository listing methods. Guard runs via registerAdminRoutes' preHandler.
 */
export function registerConversationAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps) {
  app.get("/api/v1/admin/conversations", async (request) => {
    requireAdmin(request);
    const { limit } = request.query as { limit?: string };
    const parsed = Math.min(Math.max(Number(limit ?? 50) || 50, 1), 100);
    return { conversations: await deps.conversations.list(parsed) };
  });

  app.get("/api/v1/admin/conversations/:id/transcript", async (request) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const messages = await deps.conversations.listMessages(id, 200);
    return { conversationId: id, messages };
  });

  app.get("/api/v1/admin/appointments", async (request) => {
    requireAdmin(request);
    const { limit } = request.query as { limit?: string };
    const parsed = Math.min(Math.max(Number(limit ?? 50) || 50, 1), 100);
    return { appointments: await deps.appointments.listAppointments(parsed) };
  });

  /**
   * Correction 6: cancellation goes through the calendar-safe path — the DB
   * status change happens only when the Calendar side is truthfully resolved
   * (event cancelled, or verified absent). Inconclusive -> refusal, no change.
   */
  app.post("/api/v1/admin/appointments/:id/cancel", async (request) => {
    const admin = requireAdmin(request);
    const { id } = request.params as { id: string };
    const result = await deps.booking.adminCancel(id);
    await deps.audit.append({
      actorType: "admin", actorId: admin.userId, action: "appointment.cancelled",
      entityType: "appointments", entityId: id,
      detail: { calendarCancelled: result.calendarCancelled },
    });
    return { id, status: result.status, calendarCancelled: result.calendarCancelled };
  });
}
