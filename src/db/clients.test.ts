import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCaCert } from "./clients.js";

describe("CA certificate loading (fail-closed TLS)", () => {
  it("loads a PEM certificate", () => {
    const dir = mkdtempSync(join(tmpdir(), "ca-test-"));
    const path = join(dir, "ca.crt");
    writeFileSync(path, "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n");
    expect(loadCaCert(path)).toContain("BEGIN CERTIFICATE");
  });

  it("fails closed on a missing file", () => {
    expect(() => loadCaCert(join(tmpdir(), "does-not-exist.crt"))).toThrow(/TLS verification cannot be skipped/);
  });

  it("fails closed on a non-certificate file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ca-test-"));
    const path = join(dir, "not-a-cert.txt");
    writeFileSync(path, "hello world");
    expect(() => loadCaCert(path)).toThrow(/does not contain a PEM certificate/);
  });
});
