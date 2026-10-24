import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { LtpFailure } from "./budget";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type ResolveHook = (hostname: string) => Promise<ResolvedAddress[]>;

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
  ["ff00::", 8],
];

const BLOCKED_HOST_SUFFIXES = [
  ".localhost", ".local", ".internal", ".home.arpa", ".test", ".invalid", ".example",
  ".lan", ".intranet", ".corp", ".home", ".onion",
];

function ipv4Bytes(address: string): Uint8Array | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let index = 0; index < 4; index += 1) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(parts[index])) return null;
    const value = Number(parts[index]);
    if (value > 255) return null;
    bytes[index] = value;
  }
  return bytes;
}

function ipv6Bytes(address: string): Uint8Array | null {
  const zoneIndex = address.indexOf("%");
  const text = (zoneIndex === -1 ? address : address.slice(0, zoneIndex)).toLowerCase();
  if (isIP(text) !== 6) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (mapped) {
    const v4 = ipv4Bytes(mapped[1]);
    if (!v4) return null;
    const bytes = new Uint8Array(16);
    bytes[10] = 0xff; bytes[11] = 0xff;
    bytes.set(v4, 12);
    return bytes;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups: string[] = [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 && left.length !== 8) return null;
  if (halves.length === 2 && missing < 0) return null;
  groups.push(...left, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"), ...right);
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 8; index += 1) {
    if (!/^[0-9a-f]{1,4}$/.test(groups[index])) return null;
    const value = Number.parseInt(groups[index], 16);
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  }
  return bytes;
}

function inPrefix(bytes: Uint8Array, prefix: Uint8Array, bits: number): boolean {
  const full = Math.floor(bits / 8);
  for (let index = 0; index < full; index += 1) if (bytes[index] !== prefix[index]) return false;
  const remainder = bits % 8;
  if (remainder === 0) return true;
  const mask = 0xff << (8 - remainder);
  return (bytes[full] & mask) === (prefix[full] & mask);
}

function paddedPrefix(value: string, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const parsed = length === 4 ? ipv4Bytes(value) : ipv6Bytes(value);
  if (!parsed) throw new Error(`invalid prefix ${value}`);
  bytes.set(parsed);
  return bytes;
}

const IPV4_RANGES = IPV4_BLOCKS.map(([value, bits]) => ({ bytes: paddedPrefix(value, 4), bits }));
const IPV6_RANGES = IPV6_BLOCKS.map(([value, bits]) => ({ bytes: paddedPrefix(value, 16), bits }));
const IPV4_BLOCKS_COUNT = IPV4_RANGES.length;
const IPV6_BLOCKS_COUNT = IPV6_RANGES.length;

export function isBlockedIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const bytes = ipv4Bytes(address);
    return bytes === null || IPV4_RANGES.some(range => inPrefix(bytes, range.bytes, range.bits));
  }
  if (version === 6) {
    const bytes = ipv6Bytes(address);
    if (!bytes) return true;
    const mapped = bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0 && bytes[4] === 0
      && bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 0 && bytes[8] === 0 && bytes[9] === 0
      && bytes[10] === 0xff && bytes[11] === 0xff;
    if (mapped) return isBlockedIp(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
    return IPV6_RANGES.some(range => inPrefix(bytes, range.bytes, range.bits));
  }
  return true;
}

function normalizedHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

export function isBlockedHostname(hostname: string): boolean {
  const host = normalizedHost(hostname);
  if (!host) return true;
  if (isIP(host)) return isBlockedIp(host);
  if (host === "localhost") return true;
  return BLOCKED_HOST_SUFFIXES.some(suffix => host.endsWith(suffix));
}

/** Validates scheme/credentials/fragment/port before any DNS or socket work. */
export function assertSafeEndpointUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LtpFailure("unsupported_profile", "invalid endpoint URL");
  }
  if (url.protocol !== "https:") throw new LtpFailure("ssrf_blocked", "https_required");
  if (url.username || url.password) throw new LtpFailure("ssrf_blocked", "userinfo_not_allowed");
  if (url.hash) throw new LtpFailure("ssrf_blocked", "fragment_not_allowed");
  if (!url.hostname || isBlockedHostname(url.hostname)) {
    throw new LtpFailure("ssrf_blocked", "blocked_endpoint_host");
  }
  return url;
}

/**
 * Resolves once, rejects if ANY answer is in a blocked range, then returns the
 * exact address the socket must use. The caller pins this result in its lookup
 * callback, so a second DNS answer cannot redirect the connection (rebinding).
 */
export async function resolvePinnedAddress(hostname: string, resolver?: ResolveHook): Promise<ResolvedAddress> {
  const host = normalizedHost(hostname);
  if (isBlockedHostname(host)) throw new LtpFailure("ssrf_blocked", "blocked_endpoint_host");
  const version = isIP(host);
  if (version === 4 || version === 6) return { address: host, family: version };
  let answers: ResolvedAddress[];
  try {
    answers = resolver
      ? await resolver(host)
      : (await lookup(host, { all: true, verbatim: true })) as ResolvedAddress[];
  } catch {
    throw new LtpFailure("service_unavailable", "dns_resolution_failed");
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new LtpFailure("service_unavailable", "dns_resolution_empty");
  }
  if (answers.some(answer => isBlockedIp(answer.address))) {
    throw new LtpFailure("ssrf_blocked", "dns_answer_in_blocked_range");
  }
  return { address: answers[0].address, family: answers[0].family };
}

export const BLOCKED_IPV4_RANGE_COUNT = IPV4_BLOCKS_COUNT;
export const BLOCKED_IPV6_RANGE_COUNT = IPV6_BLOCKS_COUNT;
