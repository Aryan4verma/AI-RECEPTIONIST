import { lookup } from "node:dns/promises";
import { Agent } from "undici";
import { validateProviderEndpoint } from "./endpoint.js";
import { isPrivateAddress } from "./address.js";
export { isPrivateAddress } from "./address.js";

/**
 * Request-time SSRF protection for admin-configured endpoints (SEC-16):
 * 1. DNS resolution happens BEFORE the request — every resolved address must
 *    be public (defeats hostname-based rebinding to private ranges).
 * 2. Redirects are followed MANUALLY — each hop's URL and freshly-resolved
 *    addresses are re-validated (defeats public→private redirects).
 * 3. Credentials in URLs are rejected at every hop.
 * The connection is pinned to the validated address to prevent DNS rebinding.
 */
export interface SafeFetchDeps {
  fetchFn?: typeof fetch;
  resolveDns?: (host: string) => Promise<string[]>;
  maxRedirects?: number;
  makeDispatcher?: (pinnedAddress: string, family: number) => unknown;
}
export async function safeProviderFetch(rawUrl: string, init: RequestInit, deps: SafeFetchDeps = {}): Promise<Response> {
  const fetchFn = deps.fetchFn ?? fetch;
  const resolve = deps.resolveDns ?? ((host) => lookup(host, { all: true }).then((rs) => rs.map((r) => r.address)));
  const maxRedirects = deps.maxRedirects ?? 3;

  let url = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = validateProviderEndpoint(url);
    if (!check.ok) {
      throw new Error(`unsafe endpoint: ${check.reason}`);
    }
    const parsed = new URL(url);
    const addresses = await resolve(parsed.hostname);
    if (addresses.length === 0) {
      throw new Error("unsafe endpoint: hostname did not resolve");
    }
    const privateAddr = addresses.find((a) => isPrivateAddress(a));
    if (privateAddr !== undefined) {
      throw new Error("unsafe endpoint: hostname resolves to a private address");
    }
    // TOCTOU elimination: pin the connection to the VALIDATED address via a
    // per-request dispatcher whose lookup is fixed — the request cannot be
    // re-resolved to a different (private) IP between check and use.
    const family = addresses[0]!.includes(":") ? 6 : 4;
    const dispatcher = deps.makeDispatcher
      ? deps.makeDispatcher(addresses[0]!, family)
      : new Agent({
          connect: {
            lookup: (_host: string, _opts: unknown, cb: (err: Error | null, addr: string | Array<{ address: string; family: number }>) => void) =>
              cb(null, [{ address: addresses[0]!, family }]),
          },
        });
    try {
      const res = await fetchFn(url, { ...init, redirect: "manual", dispatcher } as RequestInit);
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return res; // surface non-redirectable responses as-is
        await res.body?.cancel();
        url = new URL(location, url).toString();
        continue;
      }
      return res;
    } finally {
      // Graceful close waits for in-flight body consumption. Do not await it
      // here: callers must first receive and consume the returned Response.
      const owned = dispatcher as { close?: () => Promise<void> };
      if (owned.close) void owned.close().catch(() => undefined);
    }
  }
  throw new Error(`unsafe endpoint: exceeded ${maxRedirects} redirects`);
}
