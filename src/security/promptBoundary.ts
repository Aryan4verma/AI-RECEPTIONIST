/** Reject recognizable control-plane instructions before inference/routing.
 * This is a bounded abuse filter, not a claim that arbitrary prompt injection
 * can be detected. Tools, authorization and confirmation stay backend-owned.
 */
export function isControlInstruction(text: string): boolean {
  const normalized = text.normalize("NFKC");
  return /\b(?:ignore|disregard|override|forget)\b.{0,80}\b(?:instructions?|system prompt|safety rules?|validation|permissions?)\b/is.test(normalized)
    || /\b(?:reply|respond|output|return)\b.{0,45}\bintent\b/is.test(normalized)
    || /\b(?:developer|system|admin)\s*(?:mode|message|override)\b/i.test(normalized)
    || /(?:<\|(?:im_start|system|developer)\|>|\[INST\]|^\s*(?:SYSTEM|DEVELOPER)\s*:)/im.test(normalized)
    || /\b(?:reveal|print|expose|show|send)\b.{0,60}\b(?:credentials?|secrets?|tokens?|api[ _-]?keys?|system prompt)\b/is.test(normalized);
}
