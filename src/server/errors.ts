export const ERROR_CODES = [
  "INVALID_INPUT",
  "UNSUPPORTED_MEDIA_TYPE",
  "AUDIO_TOO_LARGE",
  "STT_FAILED",
  "NO_SPEECH",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "RESOURCE_LIMIT",
  "PROVIDER_FAILURE",
  "PROVIDER_TIMEOUT",
  "INVALID_OUTPUT",
  "OLLAMA_UNAVAILABLE",
  "MODEL_UNAVAILABLE",
  "CALENDAR_UNAVAILABLE",
  "SLOT_TAKEN",
  "OFFER_EXPIRED",
  "UNSAFE_ENDPOINT",
  "CREDENTIAL_STORE_UNAVAILABLE",
  "BOOKING_UNRESOLVED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  UNSUPPORTED_MEDIA_TYPE: 400,
  AUDIO_TOO_LARGE: 400,
  STT_FAILED: 422,
  NO_SPEECH: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  RESOURCE_LIMIT: 503,
  PROVIDER_FAILURE: 502,
  PROVIDER_TIMEOUT: 504,
  INVALID_OUTPUT: 502,
  OLLAMA_UNAVAILABLE: 503,
  MODEL_UNAVAILABLE: 409,
  CALENDAR_UNAVAILABLE: 503,
  SLOT_TAKEN: 409,
  OFFER_EXPIRED: 409,
  UNSAFE_ENDPOINT: 422,
  CREDENTIAL_STORE_UNAVAILABLE: 503,
  BOOKING_UNRESOLVED: 202,
  INTERNAL: 500,
};

export class AppError extends Error {
  /**
   * `details` is SERVER-ONLY diagnostic data (causes, provider/db text,
   * identifiers). It never enters a customer-facing response unless the
   * construction site explicitly marks it client-safe via `exposeDetails`.
   * Messages must be developer-authored safe text — never raw provider or
   * database output (quality correction 3).
   */
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
    public readonly exposeDetails = false,
  ) {
    super(message);
    this.name = "AppError";
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; details?: unknown; requestId: string };
}

export function toEnvelope(err: unknown, requestId: string): ErrorEnvelope {
  if (err instanceof AppError) {
    const body: ErrorEnvelope["error"] = { code: err.code, message: err.message, requestId };
    if (err.details !== undefined && err.exposeDetails) body.details = err.details;
    return { error: body };
  }
  return {
    error: { code: "INTERNAL", message: "An unexpected error occurred.", requestId },
  };
}
