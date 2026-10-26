import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerAudioRoutes } from "../http/routes/public/audio.js";
import type { ConversationService } from "../domain/conversation/service.js";
import { AppError } from "../server/errors.js";
import { wavBytes } from "./testUtils.js";

describe("audio route failure and handoff contracts (fixtures)", () => {
  it.each(["empty", "unavailable", "handoff"])("%s", async (mode) => {
    const app = Fastify();
    await app.register(multipart);
    app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.status : 500).send({ code: (error as AppError).code }));
    const recorded: string[] = [];
    registerAudioRoutes(app, {
      maxAudioBytes: 10000, maxAudioSeconds: 60,
      conversationService: {
        requireConversation: async () => ({ id: "synthetic", status: "active" }),
        recordCustomerMessage: async (_id: string, text: string) => { recorded.push(text); },
        handleCustomerTurn: async () => ({ reply: "Flagged for staff", intent: "property_enquiry", escalated: true, extractionComplete: null }),
      } as unknown as ConversationService,
      speech: {
        transcribe: async () => {
          if (mode === "unavailable") throw new AppError("RESOURCE_LIMIT", "Insufficient free memory.");
          return { transcript: mode === "empty" ? "  " : "3BHK in Pune for 80 lakh", latencyMs: 1 };
        }, healthCheck: async () => ({ ok: true }), stop: async () => undefined,
      },
    });
    const payload = Buffer.concat([
      Buffer.from('--test\r\nContent-Disposition: form-data; name="file"; filename="synthetic.wav"\r\nContent-Type: audio/wav\r\n\r\n'),
      Buffer.from(wavBytes()), Buffer.from("\r\n--test--\r\n"),
    ]);
    try {
      const result = await app.inject({ method: "POST", url: "/api/v1/conversations/synthetic/audio", headers: { "x-conversation-token": "test", "content-type": "multipart/form-data; boundary=test" }, payload });
      if (mode === "handoff") {
        expect(result.statusCode).toBe(200);
        expect(result.json().conversationState).toBe("escalated");
        expect(recorded).toEqual(["3BHK in Pune for 80 lakh"]);
      } else {
        expect(result.json().code).toBe(mode === "empty" ? "NO_SPEECH" : "RESOURCE_LIMIT");
        expect(recorded).toEqual([]);
      }
    } finally { await app.close(); }
  });
});
