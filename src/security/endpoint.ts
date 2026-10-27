/**
 * SSRF guard for admin-configurable provider endpoints (SEC-16).
 * Cloud provider base URLs must be public HTTPS origins: loopback, private
 * ranges, link-local/metadata addresses and embedded credentials are rejected
 * at the configuration boundary. DNS-rebinding residuals are mitigated at
 * request time by DNS validation and a connection pinned to that address;
 * every redirect is revalidated.
 */
import { isIP } from "node:net";
import { isPrivateAddress } from "./address.js";
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
  if (isIP(host) && isPrivateAddress(host)) {
    return { ok: false, reason: "private or link-local addresses are not allowed for cloud providers" };
  }
  return { ok: true };
}
