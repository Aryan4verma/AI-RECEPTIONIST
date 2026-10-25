import type { FastifyInstance } from "fastify";
import { AppError } from "../../../server/errors.js";
import type { ConversationRow } from "../../../db/ports.js";
import type { ConversationService } from "../../../domain/conversation/service.js";
import type { SpeechToText } from "../../../speech/sidecar.js";
import { validateAudio } from "../../../speech/audioValidation.js";

export interface AudioRouteDeps {
  conversationService: ConversationService;
  speech: SpeechToText;
  maxAudioBytes: number;
  maxAudioSeconds: number;
}

/**
 * OP-03: audio turn. Boundary-validated (magic bytes/size/WAV-duration),
 * transcribed through the gated sidecar, then routed through the normal
 * conversation turn. Audio bytes exist in memory ONLY — nothing is persisted
 * (recording remains consent-gated and unimplemented by default, FR-9).
 */
export function registerAudioRoutes(app: FastifyInstance, deps: AudioRouteDeps) {
  app.post("/api/v1/conversations/:id/audio", async (request) => {
    const token = request.headers["x-conversation-token"];
    const id = (request.params as { id?: string }).id;
    if (typeof token !== "string" || !id) throw new AppError("NOT_FOUND", "Conversation not found.");
    const conversation = await deps.conversationService.requireConversation(id, token);
    if (conversation.status !== "active") {
      throw new AppError("INVALID_INPUT", "Conversation has ended.");
    }

    const file = await request.file({
      limits: { fileSize: deps.maxAudioBytes, files: 1 },
    });
    if (!file) throw new AppError("UNSUPPORTED_MEDIA_TYPE", "An audio file is required.");
    const buffer = await file.toBuffer();
    const kind = validateAudio(new Uint8Array(buffer), {
      maxBytes: deps.maxAudioBytes,
      maxSeconds: deps.maxAudioSeconds,
    });

    const { transcript, latencyMs } = await deps.speech.transcribe(
      new Uint8Array(buffer),
      deps.maxAudioSeconds,
    );
    if (transcript.length === 0) {
      throw new AppError("STT_FAILED", "No speech was detected in the audio.");
    }
    void kind;

    await deps.conversationService.recordCustomerMessage(conversation.id, transcript);
    const turn = await deps.conversationService.handleCustomerTurn(conversation, transcript);
    return {
      transcript,
      sttLatencyMs: latencyMs,
      reply: turn.reply,
      intent: turn.intent,
      extractionComplete: turn.extractionComplete,
      offer: turn.offer,
      conversationState: turn.intent === "request_human" ? "escalated" : conversation.status,
    };
  });
}
