import { describe, expect, it } from "vitest";
import { generateConversationToken, hashConversationToken, verifyConversationToken } from "./conversationToken.js";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("conversation token service", () => {
  it("generates 32-byte base64url tokens", () => {
    const token = generateConversationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toBe(generateConversationToken());
  });

  it("hashes deterministically with the keyed hash", () => {
    const token = generateConversationToken();
    expect(hashConversationToken(token, SECRET)).toBe(hashConversationToken(token, SECRET));
    expect(hashConversationToken(token, SECRET)).not.toBe(hashConversationToken(token, "another-secret-0123456789abcdef"));
  });

  it("verifies the right token and rejects wrong, tampered, or malformed ones", () => {
    const token = generateConversationToken();
    const hash = hashConversationToken(token, SECRET);
    expect(verifyConversationToken(token, hash, SECRET)).toBe(true);
    expect(verifyConversationToken(generateConversationToken(), hash, SECRET)).toBe(false);
    expect(verifyConversationToken(`${token}x`, hash, SECRET)).toBe(false);
    expect(verifyConversationToken("not-a-token", "zz-not-hex", SECRET)).toBe(false);
  });

  it("hash does not contain the token", () => {
    const token = generateConversationToken();
    expect(hashConversationToken(token, SECRET)).not.toContain(token);
  });
});
