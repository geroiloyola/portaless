/** Egress policy: deny special-use, private and transition address ranges.
 * Transition prefixes are denied in full, including public embedded IPv4;
 * this avoids different routing interpretations of NAT64/6to4/Teredo/mapped IPs.
 * Web APIs only: shared with Workers; no Node dependency.
 */
export const BLOCKED_EGRESS_CIDRS = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
  "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24",
  "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
  "224.0.0.0/4", "240.0.0.0/4", "::/128", "::1/128", "fc00::/7",
  "fe80::/10", "fec0::/10", "ff00::/8", "64:ff9b::/96", "64:ff9b:1::/48",
  "100::/64", "2001:db8::/32", "2002::/16", "2001::/32", "::ffff:0:0/96",
] as const;

export function isBlockedEgressIp(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, "");
  if (/^\d+(\.\d+){3}$/.test(ip)) {
    const [a, b, c, d] = ip.split(".").map(Number);
    if ([a, b, c, d].some((n) => n < 0 || n > 255)) return true;
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && ((b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99) || b === 168))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113);
  }
  let canonical: string;
  try { canonical = new URL(`https://[${ip}]/`).hostname.slice(1, -1).toLowerCase(); }
  catch { return true; } // Invalid DNS answers must never reach the connector.
  const halves = canonical.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const words = (halves.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    : left).map((word) => Number.parseInt(word, 16));
  if (words.length !== 8) return true;
  const zeroTo = (n: number) => words.slice(0, n).every((v) => v === 0);
  return (zeroTo(7) && words[7] <= 1)
    || (words[0] & 0xfe00) === 0xfc00
    || (words[0] & 0xffc0) === 0xfe80
    || (words[0] & 0xffc0) === 0xfec0
    || (words[0] & 0xff00) === 0xff00
    || (words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every((v) => v === 0))
    || (words[0] === 0x64 && words[1] === 0xff9b && words[2] === 1)
    || words[0] === 0x2002
    || (words[0] === 0x2001 && words[1] === 0)
    || (words[0] === 0x2001 && words[1] === 0xdb8)
    || (words[0] === 0x100 && words.slice(1, 4).every((v) => v === 0))
    || (zeroTo(5) && words[5] === 0xffff);
}
