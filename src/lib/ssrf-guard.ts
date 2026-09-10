/**
 * SSRF guard. Validates user-supplied URLs and prevents fetches to
 * localhost, private networks, link-local, loopback, and cloud metadata
 * endpoints. Defense in depth: parse-time + DNS-time checks.
 */
import { isIP } from "node:net";
import dns from "node:dns/promises";
type LookupAddress = { address: string; family: number };

const BLOCKED_HOSTNAMES = new Set<string>([
  "localhost",
  "localhost.localdomain",
  "0.0.0.0",
  "::1",
  "ip6-localhost",
  "ip6-loopback",
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".local",
  ".internal",
  ".lan",
  ".intranet",
  ".corp",
  ".localhost",
];

const BLOCKED_METADATA_PATHS = [
  // AWS / GCP / Azure / DigitalOcean / Alibaba / Oracle
  "/latest/meta-data/",
  "/computeMetadata/v1/",
  "/metadata/instance",
  "/metadata/v1/",
  "/openstack/latest/",
  "/metadata/oss/",
];

export class SsrfBlockedError extends Error {
  constructor(reason: string) {
    super(`Request blocked by SSRF guard: ${reason}`);
    this.name = "SsrfBlockedError";
  }
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a = 0, b = 0] = parts;

  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240/4 reserved
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true; // unspecified / loopback
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  if (lower.startsWith("ff")) return true; // multicast
  return false;
}

function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return false;
}

/**
 * Parse-time URL validation. Cheap; runs before any network call.
 */
export function validatePublicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SsrfBlockedError("not a valid URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SsrfBlockedError(`unsupported protocol ${url.protocol}`);
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname) {
    throw new SsrfBlockedError("missing hostname");
  }

  // Strip brackets for IPv6 literals.
  const bareHost = hostname.replace(/^\[|\]$/g, "");

  if (BLOCKED_HOSTNAMES.has(bareHost)) {
    throw new SsrfBlockedError(`blocked hostname "${bareHost}"`);
  }
  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (bareHost.endsWith(suffix)) {
      throw new SsrfBlockedError(`blocked hostname suffix "${suffix}"`);
    }
  }

  // Reject IP literals that resolve to private space.
  if (isIP(bareHost) && isPrivateIp(bareHost)) {
    throw new SsrfBlockedError(`private IP literal "${bareHost}"`);
  }

  // Reject cloud metadata paths even on public-looking hosts.
  for (const path of BLOCKED_METADATA_PATHS) {
    if (url.pathname.startsWith(path)) {
      throw new SsrfBlockedError(`blocked metadata path "${path}"`);
    }
  }

  return url;
}

/**
 * DNS-time check: resolve hostname and ensure all returned addresses are public.
 * Catches DNS-rebinding attempts where the hostname looks public but resolves
 * to a private IP.
 */
export async function assertHostnameResolvesPublic(hostname: string): Promise<void> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (isIP(bare)) return; // already validated as IP literal

  let addresses: LookupAddress[];
  try {
    addresses = await dns.lookup(bare, { all: true });
  } catch (err) {
    throw new SsrfBlockedError(
      `DNS resolution failed for "${bare}": ${(err as Error).message}`,
    );
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError(`no DNS records for "${bare}"`);
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new SsrfBlockedError(
        `hostname "${bare}" resolves to private IP ${address}`,
      );
    }
  }
}
