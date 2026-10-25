import { lookup } from "node:dns/promises";
import { Agent } from "undici";
import { validateProviderEndpoint } from "./endpoint.js";

/**
 * Request-time SSRF protection for admin-configured endpoints (SEC-16):
 * 1. DNS resolution happens BEFORE the request — every resolved address must
 *    be public (defeats hostname-based rebinding to private ranges).
 * 2. Redirects are followed MANUALLY — each hop's URL and freshly-resolved
 *    addresses are re-validated (defeats public→private redirects).
 * 3. Credentials in URLs are rejected at every hop.
 * DNS-rebinding TOCTOU residuals are narrowed (not eliminated) by the
 * per-request resolution; this is the approved pre-cloud-activation control.
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
    const res = await fetchFn(url, { ...init, redirect: "manual", dispatcher } as RequestInit);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res; // odd but not redirectable — surface as-is
      url = new URL(location, url).toString();
      continue;
    }
    return res;
  }
  throw new Error(`unsafe endpoint: exceeded ${maxRedirects} redirects`);
}

export function isPrivateAddress(address: string): boolean {
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
  if (mapped) return isPrivateAddress(mapped.slice(1).join(".")); // IPv4-mapped IPv6
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 240) return true;
    return false;
  }
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fe80") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("2001:db8") ||
    lower.startsWith("::ffff:0")
  );
}
