import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError } from "../../../server/errors.js";
import type { ConversationRow } from "../../../db/ports.js";
import type { ConversationService } from "../../../domain/conversation/service.js";
import type { BookingService } from "../../../domain/booking/service.js";

export interface ConversationRouteDeps {
  conversationService: ConversationService;
  bookingService: BookingService;
}

const startBody = z.strictObject({ channel: z.enum(["text", "voice"]).default("text") });
const messageBody = z.strictObject({ text: z.string().min(1).max(4000) });
const confirmBody = z.strictObject({ offerToken: z.string().uuid(), decision: z.enum(["accept", "decline"]) });
const consentBody = z.strictObject({
  decision: z.boolean(),
  decisionText: z.string().max(500).optional(),
});

/**
 * Public customer routes (API.md OP-01…OP-07 + consent). Conversation-token
 * scoped: every request is authorized against the keyed hash of the presented
 * token; mismatch = 404 (existence hiding). No anon DB path exists (SEC-2/3).
 */
export function registerConversationRoutes(app: FastifyInstance, deps: ConversationRouteDeps) {
  const requireConversation = async (request: FastifyRequest): Promise<ConversationRow> => {
    const token = request.headers["x-conversation-token"];
    const id = (request.params as { id?: string }).id;
    if (typeof token !== "string" || token.length === 0 || !id) {
      throw new AppError("NOT_FOUND", "Conversation not found.");
    }
    return deps.conversationService.requireConversation(id, token);
  };

  app.post("/api/v1/conversations", async (request, reply) => {
    const body = startBody.parse(request.body);
    const started = await deps.conversationService.start(body.channel);
    reply.code(201);
    return started;
  });

  app.post("/api/v1/conversations/:id/messages", async (request) => {
    const conversation = await requireConversation(request);
    if (conversation.status !== "active") {
      throw new AppError("INVALID_INPUT", "Conversation has ended.");
    }
    const body = messageBody.parse(request.body);
    await deps.conversationService.recordCustomerMessage(conversation.id, body.text);
    const turn = await deps.conversationService.handleCustomerTurn(conversation, body.text);
    return {
      reply: turn.reply,
      intent: turn.intent,
      extractionComplete: turn.extractionComplete,
      offer: turn.offer,
      conversationState: turn.intent === "request_human" ? "escalated" : conversation.status,
    };
  });

  app.post("/api/v1/conversations/:id/consent", async (request) => {
    const conversation = await requireConversation(request);
    const body = consentBody.parse(request.body);
    const result = await deps.conversationService.decideConsent(conversation, body.decision, body.decisionText);
    return { consentRecording: result.consentRecording };
  });

  app.post("/api/v1/conversations/:id/confirm", async (request, reply) => {
    const conversation = await requireConversation(request);
    const body = confirmBody.parse(request.body);
    const result = await deps.bookingService.confirm(conversation.id, body.offerToken, body.decision);
    if (result.bookingState === "UNRESOLVED") {
      reply.code(202);
      return {
        bookingState: "UNRESOLVED",
        message: "Your booking is being verified; you will be contacted once confirmed.",
      };
    }
    return result;
  });

  app.post("/api/v1/conversations/:id/cancel", async (request) => {
    const conversation = await requireConversation(request);
    // Booking-cancellation failures are consequential — they propagate to the
    // error envelope instead of being silently suppressed (quality correction 3).
    await deps.bookingService.cancel(conversation.id);
    await deps.conversationService.end(conversation);
    return { conversationState: "ended" };
  });

  app.get("/api/v1/conversations/:id", async (request) => {
    const conversation = await requireConversation(request);
    const booking = await deps.bookingService.publicStatus(conversation.id);
    return {
      status: conversation.status,
      booking,
      consentRecording: conversation.consentRecording,
      startedAt: conversation.startedAt.toISOString(),
    };
  });
}
