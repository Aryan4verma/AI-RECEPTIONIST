import { AppError } from "../server/errors.js";

/** Audio container sniffing — the declared content type is never trusted. */
export type AudioKind = "wav" | "webm" | "ogg" | "m4a";

export interface AudioConstraints {
  maxBytes: number;
  maxSeconds: number;
}

export function detectAudioKind(bytes: Uint8Array): AudioKind | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  const ascii = (offset: number, text: string) =>
    text.split("").every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  if (startsWith(0x52, 0x49, 0x46, 0x46) && ascii(8, "WAVE")) return "wav";
  if (startsWith(0x1a, 0x45, 0xdf, 0xa3)) return "webm"; // EBML (webm/mkv)
  if (startsWith(0x4f, 0x67, 0x67, 0x53)) return "ogg";
  if (startsWith(0x00, 0x00, 0x00) && ascii(4, "ftyp")) return "m4a";
  return null;
}

/** WAV duration from the fmt/data headers (other containers: null — size cap only). */
export function wavDurationSeconds(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= bytes.length) {
    const chunkId = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
    const size = view.getUint32(offset + 4, true);
    if (chunkId === "fmt ") {
      byteRate = view.getUint32(offset + 16, true);
    } else if (chunkId === "data") {
      if (byteRate > 0) return size / byteRate;
      return null;
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/**
 * Boundary validation (FR-8/SEC-10): type sniffed by magic bytes, size capped,
 * WAV duration capped server-side; other containers are size-capped with the
 * limitation documented (client-declared duration is untrusted, not enforced).
 */
export function validateAudio(bytes: Uint8Array, constraints: AudioConstraints): AudioKind {
  if (bytes.length === 0) {
    throw new AppError("INVALID_INPUT", "The audio payload is empty.");
  }
  if (bytes.length > constraints.maxBytes) {
    throw new AppError("AUDIO_TOO_LARGE", "The audio file exceeds the size limit.", {
      maxBytes: constraints.maxBytes,
    });
  }
  const kind = detectAudioKind(bytes);
  if (!kind) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "The audio format is not supported.", {
      supported: ["wav", "webm", "ogg", "m4a"],
    });
  }
  if (kind === "wav") {
    const seconds = wavDurationSeconds(bytes);
    if (seconds !== null && seconds > constraints.maxSeconds) {
      throw new AppError("INVALID_INPUT", "The audio exceeds the maximum duration.", {
        maxSeconds: constraints.maxSeconds,
      });
    }
  }
  return kind;
}
