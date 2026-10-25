/**
 * SSRF guard for admin-configurable provider endpoints (SEC-16).
 * Cloud provider base URLs must be public HTTPS origins: loopback, private
 * ranges, link-local/metadata addresses and embedded credentials are rejected
 * at the configuration boundary. DNS-rebinding residuals are mitigated at
 * request time by the adapters (fetch follows the same validated URL; no
 * redirects to private hosts are permitted there).
 */
export type EndpointCheck = { ok: true } | { ok: false; reason: string };

export function validateProviderEndpoint(raw: string): EndpointCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "cloud provider endpoints must use https" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "credentials embedded in the URL are not allowed" };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0") {
    return { ok: false, reason: "loopback hosts are not allowed for cloud providers" };
  }
  if (
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return { ok: false, reason: "private or link-local addresses are not allowed for cloud providers" };
  }
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return { ok: false, reason: "unique-local IPv6 addresses are not allowed for cloud providers" };
  }
  return { ok: true };
}
