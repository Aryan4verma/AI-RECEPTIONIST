import { describe, expect, it } from "vitest";
import { isPrivateAddress, safeProviderFetch } from "./safeFetch.js";

function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe("request-time SSRF protection (SEC-16)", () => {
  it("blocks a hostname that resolves to a private address (DNS rebinding guard)", async () => {
    await expect(
      safeProviderFetch("https://api.example.com/v1", {}, {
        resolveDns: async () => ["192.168.1.9"],
        fetchFn: async () => res(200),
      }),
    ).rejects.toThrow(/private address/);
  });

  it("allows public resolutions and performs the request", async () => {
    let called = "";
    const out = await safeProviderFetch("https://api.example.com/v1", { method: "GET" }, {
      resolveDns: async () => ["93.184.216.34"],
      fetchFn: async (url) => {
        called = String(url);
        return res(200);
      },
    });
    expect(out.status).toBe(200);
    expect(called).toBe("https://api.example.com/v1");
  });

  it("re-validates EVERY redirect hop — public → private redirect is blocked", async () => {
    const dns: Record<string, string[]> = {
      "api.example.com": ["93.184.216.34"],
      "evil.example.net": ["169.254.169.254"],
    };
    await expect(
      safeProviderFetch("https://api.example.com/v1", {}, {
        resolveDns: async (h) => dns[h] ?? ["93.184.216.34"],
        fetchFn: async () => res(302, { location: "https://evil.example.net/latest/meta-data" }),
      }),
    ).rejects.toThrow(/private address/);
  });

  it("follows safe redirects and enforces the hop limit", async () => {
    let hops = 0;
    const out = await safeProviderFetch("https://api.example.com/a", {}, {
      resolveDns: async () => ["93.184.216.34"],
      fetchFn: async () => {
        hops += 1;
        return hops < 3 ? res(302, { location: `https://api.example.com/step${hops}` }) : res(200);
      },
    });
    expect(out.status).toBe(200);
    await expect(
      safeProviderFetch("https://api.example.com/a", {}, {
        resolveDns: async () => ["93.184.216.34"],
        fetchFn: async () => res(302, { location: "https://api.example.com/loop" }),
      }),
    ).rejects.toThrow(/exceeded 3 redirects/);
  });

  it("rejects non-https and credential-bearing URLs at any hop", async () => {
    await expect(
      safeProviderFetch("http://api.example.com", {}, { resolveDns: async () => ["93.184.216.34"], fetchFn: async () => res(200) }),
    ).rejects.toThrow(/https/);
    await expect(
      safeProviderFetch("https://user:pw@api.example.com", {}, { resolveDns: async () => ["93.184.216.34"], fetchFn: async () => res(200) }),
    ).rejects.toThrow(/credentials/);
  });

  it("address classifier covers loopback/link-local/private/ULA ranges", () => {
    for (const priv of ["127.0.0.1", "10.0.0.1", "192.168.0.1", "172.16.0.1", "172.31.255.255", "169.254.169.254", "::1", "fe80::1", "fd00::1", "fc00::1"]) {
      expect(isPrivateAddress(priv), priv).toBe(true);
    }
    for (const pub of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) {
      expect(isPrivateAddress(pub), pub).toBe(false);
    }
  });
});
