import { lookup } from "node:dns/promises";

/**
 * The outbound-request guard for `integration.http`.
 *
 * Every other integration in this folder talks to one fixed host. The HTTP node's
 * destination is its *config*, and D19's opt-in makes that config reachable by the
 * agent — so a model, steered by text that arrived on an unauthenticated webhook,
 * chooses the URL. That is the one place SSRF enters this product, and the security
 * rule it would break is explicit: the agent reaches the registered node set and
 * never arbitrary network access.
 *
 * Two rules, and the second is the one that actually matters on Cloud Run:
 *
 *  1. **The resolved address must be public.** Loopback, RFC 1918, link-local,
 *     CGNAT, multicast and their IPv6 equivalents are refused, including the
 *     IPv4-mapped and NAT64 forms that smuggle a v4 address through a v6 literal.
 *  2. **The scheme must be https.** `http://169.254.169.254/computeMetadata/v1/
 *     instance/service-accounts/default/token` is a plain GET away from a Google
 *     access token for this service's identity, and the response would land in a
 *     run's step output. Rule 1 already refuses 169.254.0.0/16 by address, but rule
 *     1 checks DNS and `fetch` resolves again — a hostname that answers publicly
 *     once and privately the next time (DNS rebinding) defeats it. Requiring TLS
 *     closes that path properly, because the metadata server has no certificate.
 *
 * Kept pure and injectable: `assertPublicTarget` takes its resolver, so every range
 * below is asserted in a millisecond with no network (D18's rule, applied to the one
 * guard standing between a model and this container's own network).
 *
 * What it is **not**: a claim to stop a determined attacker with a valid certificate
 * for a name that resolves into a private range. There is no VPC connector on this
 * service, so there is nothing private to reach; pinning the resolved address into
 * the connection is post-hackathon.
 */

export class HttpTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpTargetError";
  }
}

/** Hostnames refused by name, before any lookup. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
]);

/** Suffixes refused by name. `.internal` is Google's own private zone. */
const BLOCKED_SUFFIXES = [".localhost", ".internal", ".local"];

export function parseTarget(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpTargetError(
      `"${raw}" is not a valid absolute URL. Include the scheme, e.g. https://api.example.com/v1/items.`,
    );
  }

  if (url.protocol !== "https:") {
    throw new HttpTargetError(
      `Only https:// URLs are allowed; got "${url.protocol}//". Plain HTTP is refused because it is the one scheme that can read this container's own metadata service.`,
    );
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new HttpTargetError(`"${url.hostname}" is not a public host.`);
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw new HttpTargetError(
      "Credentials in the URL are not supported. Put them in a header instead.",
    );
  }

  return url;
}

/* ------------------------------------------------------------------ *
 * Address classification
 * ------------------------------------------------------------------ */

/** `"10.1.2.3"` → `[10, 1, 2, 3]`; null when it is not a dotted quad. */
function ipv4Octets(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // "this network", and 0.0.0.0
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local — the metadata server
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, RFC 6598
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 192 && b === 0) return true; // IETF protocol assignments, incl. 192.0.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking, RFC 2544
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/**
 * True for any address a request from this container has no business reaching.
 * Handles the two v6 forms that carry a v4 address inside them, because
 * `::ffff:169.254.169.254` and `64:ff9b::a9fe:a9fe` are the same metadata server.
 */
export function isPrivateAddress(address: string): boolean {
  const bare = address.replace(/%.*$/, "").toLowerCase(); // strip a zone index
  const asV4 = ipv4Octets(bare);
  if (asV4) return isPrivateIpv4(asV4);

  if (!bare.includes(":")) return true; // neither v4 nor v6: refuse rather than guess

  // An IPv4-mapped or NAT64 address may carry the dotted form in its last group.
  const dotted = bare.split(":").pop() ?? "";
  const embedded = ipv4Octets(dotted);
  if (embedded && (bare.startsWith("::ffff:") || bare.startsWith("64:ff9b:"))) {
    return isPrivateIpv4(embedded);
  }

  if (bare === "::" || bare === "::1") return true;
  if (bare.startsWith("::ffff:")) {
    // ::ffff:a9fe:a9fe — the same mapped address written in hex groups.
    const groups = bare.split(":").filter((group) => group.length > 0);
    const [high, low] = groups.slice(-2);
    if (/^[0-9a-f]{1,4}$/.test(high ?? "") && /^[0-9a-f]{1,4}$/.test(low ?? "")) {
      const value = (parseInt(high, 16) << 16) | parseInt(low, 16);
      return isPrivateIpv4([
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff,
      ]);
    }
  }
  if (/^f[cd][0-9a-f]{2}:/.test(bare)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(bare)) return true; // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(bare)) return true; // ff00::/8 multicast
  return false;
}

export type AddressResolver = (hostname: string) => Promise<string[]>;

const dnsResolver: AddressResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

/**
 * Refuses the target unless every address it resolves to is public. *Every*, not
 * *any*: a name answering with one public and one loopback address would otherwise
 * pass the check and then be connected to whichever `fetch` picked.
 */
export async function assertPublicTarget(
  url: URL,
  resolve: AddressResolver = dnsResolver,
): Promise<string[]> {
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (ipv4Octets(literal) || literal.includes(":")) {
    if (isPrivateAddress(literal)) {
      throw new HttpTargetError(`${url.hostname} is not a public address.`);
    }
    return [literal];
  }

  let addresses: string[];
  try {
    addresses = await resolve(url.hostname);
  } catch {
    throw new HttpTargetError(`Could not resolve ${url.hostname}.`);
  }

  if (addresses.length === 0) {
    throw new HttpTargetError(`${url.hostname} resolved to no addresses.`);
  }

  const blocked = addresses.filter((address) => isPrivateAddress(address));
  if (blocked.length > 0) {
    throw new HttpTargetError(
      `${url.hostname} resolves to a non-public address (${blocked[0]}).`,
    );
  }

  return addresses;
}

/** `parseTarget` + `assertPublicTarget`, which is what a caller always wants. */
export async function checkTarget(
  raw: string,
  resolve?: AddressResolver,
): Promise<{ url: URL; addresses: string[] }> {
  const url = parseTarget(raw);
  return { url, addresses: await assertPublicTarget(url, resolve) };
}
