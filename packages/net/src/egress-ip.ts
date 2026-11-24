/**
 * Neutral egress IP and hostname SSRF validation (L0-net).
 * Pure Web APIs only: safe on both Node and Cloudflare Workers.
 */

export const BLOCKED_EGRESS_CIDRS = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
  "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24",
  "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
  "224.0.0.0/4", "240.0.0.0/4", "::/128", "::1/128", "fc00::/7",
  "fe80::/10", "fec0::/10", "ff00::/8", "64:ff9b::/96", "64:ff9b:1::/48",
  "100::/64", "2001:db8::/32", "2002::/16", "2001::/32", "::ffff:0:0/96",
] as const;

export const BLOCKED_HOST_SUFFIXES = [
  ".localhost", ".local", ".internal", ".home.arpa", ".test", ".invalid", ".example",
  ".lan", ".intranet", ".corp", ".home", ".onion",
] as const;

export const PRIVATE_HOST_SUFFIXES = [
  ".localhost", ".local", ".internal",
] as const;

const IPV4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
];

const IPV6_BLOCKS: Array<[string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

export function parseIpv4Bytes(address: string): Uint8Array | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(parts[i])) return null;
    const value = Number(parts[i]);
    if (value > 255) return null;
    bytes[i] = value;
  }
  return bytes;
}

export function parseIpv6Bytes(rawAddress: string): Uint8Array | null {
  const stripped = rawAddress.replace(/^\[|\]$/g, "");
  const zoneIndex = stripped.indexOf("%");
  const text = (zoneIndex === -1 ? stripped : stripped.slice(0, zoneIndex)).toLowerCase();
  if (!text.includes(":")) return null;

  // Handle dotted IPv4-mapped form (e.g. ::ffff:127.0.0.1)
  const mappedDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (mappedDotted) {
    const v4 = parseIpv4Bytes(mappedDotted[1]);
    if (!v4) return null;
    const bytes = new Uint8Array(16);
    bytes[10] = 0xff;
    bytes[11] = 0xff;
    bytes.set(v4, 12);
    return bytes;
  }

  // Also support general embedded IPv4 suffix (e.g. 64:ff9b::192.0.2.1)
  let work = text;
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4Bytes(tail);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    work = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = work.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 && left.length !== 8) return null;
  if (halves.length === 2 && missing < 0) return null;
  const groups = [
    ...left,
    ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"),
    ...right,
  ];
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-f]{1,4}$/.test(groups[i])) return null;
    const value = Number.parseInt(groups[i], 16);
    bytes[i * 2] = value >> 8;
    bytes[i * 2 + 1] = value & 0xff;
  }
  return bytes;
}

function inPrefix(bytes: Uint8Array, prefix: Uint8Array, bits: number): boolean {
  const full = Math.floor(bits / 8);
  for (let i = 0; i < full; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  const remainder = bits % 8;
  if (remainder === 0) return true;
  const mask = 0xff << (8 - remainder);
  return (bytes[full] & mask) === (prefix[full] & mask);
}

function compileRanges(blocks: Array<[string, number]>, len: 4 | 16) {
  return blocks.map(([value, bits]) => {
    const bytes = len === 4 ? parseIpv4Bytes(value) : parseIpv6Bytes(value);
    if (!bytes) throw new Error(`invalid CIDR prefix: ${value}/${bits}`);
    return { bytes, bits };
  });
}

const IPV4_RANGES = compileRanges(IPV4_BLOCKS, 4);
const IPV6_RANGES = compileRanges(IPV6_BLOCKS, 16);

export const BLOCKED_IPV4_RANGE_COUNT = IPV4_RANGES.length;
export const BLOCKED_IPV6_RANGE_COUNT = IPV6_RANGES.length;

function isMappedIpv4Bytes(bytes: Uint8Array): boolean {
  for (let i = 0; i < 10; i++) {
    if (bytes[i] !== 0) return false;
  }
  return bytes[10] === 0xff && bytes[11] === 0xff;
}

export function isIpLiteral(host: string): boolean {
  const clean = host.replace(/^\[|\]$/g, "");
  return parseIpv4Bytes(clean) !== null || parseIpv6Bytes(clean) !== null;
}

export interface EgressIpOptions {
  /**
   * When true (default), blocks all IPv4-mapped IPv6 (`::ffff:0:0/96`) regardless
   * of whether the embedded IPv4 is public, preventing dual-stack routing discrepancies.
   * When false, unwraps IPv4-mapped IPv6 and checks the embedded IPv4 range.
   */
  blockAllMappedIpv6?: boolean;
}

/**
 * Returns true if `raw` is invalid or falls into a private, loopback, link-local,
 * CGNAT, documentation, multicast, reserved or special-use IPv4/IPv6 range.
 */
export function isBlockedEgressIp(raw: string, options: EgressIpOptions = {}): boolean {
  const { blockAllMappedIpv6 = true } = options;
  const ip = raw.trim().replace(/^\[|\]$/g, "");
  if (!ip) return true;

  if (!ip.includes(":")) {
    const v4 = parseIpv4Bytes(ip);
    if (!v4) return true;
    return IPV4_RANGES.some((range) => inPrefix(v4, range.bytes, range.bits));
  }

  const v6 = parseIpv6Bytes(ip);
  if (!v6) return true;
  if (isMappedIpv4Bytes(v6)) {
    if (blockAllMappedIpv6) return true;
    const embedded = v6.slice(12, 16);
    return IPV4_RANGES.some((range) => inPrefix(embedded, range.bytes, range.bits));
  }
  return IPV6_RANGES.some((range) => inPrefix(v6, range.bytes, range.bits));
}

/** Alias used by safe-fetch callers (blocks all transition/mapped prefixes). */
export function isPrivateIp(rawIp: string): boolean {
  return isBlockedEgressIp(rawIp, { blockAllMappedIpv6: true });
}

/**
 * Checks special-use/private IPs while unwrapping IPv4-mapped IPv6 (`::ffff:a.b.c.d`
 * or `::ffff:7f00:1`) to evaluate the embedded IPv4 address.
 */
export function isBlockedIp(address: string): boolean {
  return isBlockedEgressIp(address, { blockAllMappedIpv6: false });
}

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

export interface HostnamePolicyOptions {
  suffixes?: readonly string[];
  blockAllMappedIpv6?: boolean;
}

export function isBlockedHostname(
  hostname: string,
  options: HostnamePolicyOptions = {},
): boolean {
  const {
    suffixes = BLOCKED_HOST_SUFFIXES,
    blockAllMappedIpv6 = false,
  } = options;
  const host = normalizeHostname(hostname);
  if (!host) return true;
  if (isIpLiteral(host)) {
    return isBlockedEgressIp(host, { blockAllMappedIpv6 });
  }
  if (host === "localhost") return true;
  return suffixes.some((suffix) => host.endsWith(suffix));
}

/**
 * Checks whether a webhook/email host is internal or private (localhost,
 * .localhost, .local, .internal, or private/special-use IPv4/IPv6/IPv4-mapped).
 */
export function isPrivateHost(host: string): boolean {
  return isBlockedHostname(host, {
    suffixes: PRIVATE_HOST_SUFFIXES,
    blockAllMappedIpv6: false,
  });
}
