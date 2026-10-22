import { describe, expect, it, vi } from "vitest";
import { createSafeFetcher, isPrivateIp } from "../../packages/apw-resolver/src/federation/safe-fetch";

const blocked = [
  "0.0.0.0", "0.255.255.255", "10.0.0.1", "100.64.0.0", "100.127.255.255", "127.0.0.1",
  "169.254.169.254", "172.16.0.0", "172.31.255.255", "192.0.0.0", "192.0.0.255",
  "192.0.2.1", "192.168.1.1", "198.18.0.0", "198.19.255.255", "198.51.100.1", "203.0.113.1",
  "224.0.0.0", "239.255.255.255", "240.0.0.0", "255.255.255.255",
  "::", "0:0:0:0:0:0:0:1", "fc00::1", "fdff:ffff::1", "fe80::1", "febf:ffff::1", "ff00::1", "ffff::1",
  "64:ff9b::127.0.0.1", "64:ff9b::a9fe:a9fe", "64:ff9b::808:808", "64:ff9b:1::1",
  "2002:7f00:1::", "2002:a9fe:a9fe::", "2002:808:808::1",
  "2001:0:4136:e378:8000:63bf:80ff:fffe", // Teredo obfuscates 127.0.0.1
  "2001:0:4136:e378:8000:63bf:5601:5601", // Teredo obfuscates 169.254.169.254
  "::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:a9fe:a9fe", "::ffff:8.8.8.8",
];

describe("R4 special-use and transition egress", () => {
  it.each(blocked)("rejects %s as literal and DNS answer before fetch", async (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
    const fetcher = vi.fn();
    const safe = createSafeFetcher({ fetch: fetcher, lookup: async () => [ip] });
    expect(await safe("https://directory.example/")).toMatchObject({ ok: false, error: "blocked_host" });
    const host = ip.includes(":") ? `[${ip}]` : ip;
    expect(await createSafeFetcher({ fetch: fetcher })(`https://${host}/`)).toMatchObject({ ok: false, error: "blocked_host" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["8.8.8.8", "93.184.216.34", "100.63.255.255", "100.128.0.0", "198.20.0.0", "2001:4860:4860::8888", "2606:4700:4700::1111", "fec0::1"])("keeps non-listed boundary %s outside this denylist", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});
