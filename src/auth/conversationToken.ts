import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Conversation-token authentication for unauthenticated customers (AUTH.md §2).
 * - 32-byte CSPRNG token, returned once at session creation.
 * - Stored only as HMAC-SHA-256(keyed hash): a database leak alone cannot
 *   verify stolen tokens.
 * - Constant-time comparison; scope is exactly one conversation.
 */
export function generateConversationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashConversationToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}

export function verifyConversationToken(presented: string, storedHash: string, secret: string): boolean {
  const computed = Buffer.from(hashConversationToken(presented, secret), "hex");
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }
  if (stored.length !== computed.length) return false;
  return timingSafeEqual(computed, stored);
}
