import ipaddr from "ipaddr.js";

/** Deny non-global addresses, including normalized IPv4-mapped IPv6 forms. */
export function isPrivateAddress(address: string): boolean {
  try { return ipaddr.process(address).range() !== "unicast"; }
  catch { return true; }
}
