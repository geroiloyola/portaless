// PR H: proveedor cloudflare-pay-per-crawl y regla de activacion.
import { describe, expect, it, vi } from "vitest";
import {
  CloudflarePayPerCrawlProvider,
  formatCrawlerPrice,
  parseCfPayPerCrawl,
} from "../../packages/trust-layer/src/billing/pay-per-crawl/cloudflare";
import { resolvePayPerCrawl } from "../../packages/trust-layer/src/billing/pay-per-crawl/resolve";
import { InMemorySettlementActivationStore } from "../../packages/trust-layer/src/billing/pay-per-crawl/activation-store";
import { defaultContentPolicy } from "../../packages/trust-layer/src/policy/manifest-schema";

const provider = new CloudflarePayPerCrawlProvider();
const RULE = { access: "charge" as const, price_usd: 0.05, unit: "request" as const };
const ZONE_ID = "0123456789abcdef0123456789abcdef";

function req(cf?: string) {
  return new Request("https://blog.site.example/post/", { headers: cf ? { "cf-pay-per-crawl": cf } : {} });
}
const ok200 = () => Promise.resolve(new Response("contenido", { status: 200, headers: { "content-type": "text/html" } }));

describe("parseCfPayPerCrawl / formatCrawlerPrice", () => {
  it("lee protocol y pricing", () => {
    expect(parseCfPayPerCrawl("protocol=cloudflare, pricing=in-band")).toEqual({ protocol: "cloudflare", pricing: "in-band" });
    expect(parseCfPayPerCrawl("pricing=zone-default,protocol=cloudflare")?.pricing).toBe("zone-default");
    for (const bad of [null, "", "protocol=otro, pricing=in-band", "protocol=cloudflare, pricing=gratis"]) {
      expect(parseCfPayPerCrawl(bad), String(bad)).toBeNull();
    }
  });

  it("formatea USD con 2 decimales y rechaza precios invalidos o menores a 0.01", () => {
    expect(formatCrawlerPrice(3.14)).toBe("USD 3.14");
    expect(formatCrawlerPrice(0.01)).toBe("USD 0.01");
    for (const bad of [0.002, 0, -1, NaN, undefined, "1"]) expect(formatCrawlerPrice(bad), String(bad)).toBeNull();
  });
});

describe("CloudflarePayPerCrawlProvider.handleCharge", () => {
  it("in-band: deja pasar y agrega crawler-price a la respuesta 200", async () => {
    const res = await provider.handleCharge({ request: req("protocol=cloudflare, pricing=in-band"), rule: RULE, next: ok200 });
    expect(res?.status).toBe(200);
    expect(res?.headers.get("crawler-price")).toBe("USD 0.05");
    expect(await res?.text()).toBe("contenido");
  });

  it("in-band con respuesta no 200: no agrega precio", async () => {
    const res = await provider.handleCharge({
      request: req("protocol=cloudflare, pricing=in-band"),
      rule: RULE,
      next: () => Promise.resolve(new Response("nf", { status: 404 })),
    });
    expect(res?.status).toBe(404);
    expect(res?.headers.get("crawler-price")).toBeNull();
  });

  it("zone-default: deja pasar sin precio; bypass, sin header o precio invalido: no aplica", async () => {
    const zone = await provider.handleCharge({ request: req("protocol=cloudflare, pricing=zone-default"), rule: RULE, next: ok200 });
    expect(zone?.status).toBe(200);
    expect(zone?.headers.get("crawler-price")).toBeNull();

    const next = vi.fn(ok200);
    expect(await provider.handleCharge({ request: req("protocol=cloudflare, pricing=bypass"), rule: RULE, next })).toBeNull();
    expect(await provider.handleCharge({ request: req(), rule: RULE, next })).toBeNull();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await provider.handleCharge({ request: req("protocol=cloudflare, pricing=in-band"), rule: { ...RULE, price_usd: 0.002 }, next })
    ).toBeNull();
    expect(next).not.toHaveBeenCalled();
  });
});

describe("CloudflarePayPerCrawlProvider.verifyActivation", () => {
  const zoneResponse = (zone: object, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify({ success: status === 200, result: zone }), { status }));

  it("acepta un token valido cuya zona activa es el dominio del sitio", async () => {
    const f = zoneResponse({ name: "site.example", status: "active" });
    const check = await provider.verifyActivation({ api_token: "t", zone_id: ZONE_ID }, { siteHost: "blog.site.example", fetch: f as never });
    expect(check).toEqual({ ok: true, metadata: { zone_id: ZONE_ID, zone_name: "site.example" } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer t");
  });

  it("rechaza sin token, zone_id invalido, token rechazado, zona inactiva u otro dominio", async () => {
    const ctx = (f: unknown) => ({ siteHost: "site.example", fetch: f as never });
    expect((await provider.verifyActivation({ zone_id: ZONE_ID }, ctx(vi.fn()))).reason).toBe("missing_api_token");
    expect((await provider.verifyActivation({ api_token: "t", zone_id: "zona" }, ctx(vi.fn()))).reason).toBe("invalid_zone_id");
    expect((await provider.verifyActivation({ api_token: "t", zone_id: ZONE_ID }, ctx(zoneResponse({}, 403)))).reason).toBe("token_rejected");
    expect(
      (await provider.verifyActivation({ api_token: "t", zone_id: ZONE_ID }, ctx(zoneResponse({ name: "site.example", status: "pending" })))).reason
    ).toBe("zone_not_active");
    expect(
      (await provider.verifyActivation({ api_token: "t", zone_id: ZONE_ID }, ctx(zoneResponse({ name: "otro.example", status: "active" })))).reason
    ).toBe("zone_does_not_match_site");
    expect(
      (await provider.verifyActivation({ api_token: "t", zone_id: ZONE_ID }, { siteHost: "evilsite.example", fetch: zoneResponse({ name: "site.example", status: "active" }) as never })).reason
    ).toBe("zone_does_not_match_site");
  });
});

describe("resolvePayPerCrawl: manifiesto + activacion verificada", () => {
  const request = req("protocol=cloudflare, pricing=in-band");
  const policyWith = (provider?: string) => ({ ...defaultContentPolicy("https://blog.site.example"), settlement_provider: provider });
  const activation = { providerId: "cloudflare-pay-per-crawl", credentialEnc: "v1.x.y", metadata: {}, verifiedAt: "2026-10-01T00:00:00Z", activatedBy: "admin" };

  it("sin settlement_provider en el manifiesto no cobra aunque haya activacion", async () => {
    const store = new InMemorySettlementActivationStore();
    await store.save(activation);
    expect(await resolvePayPerCrawl({ policy: policyWith(), rule: RULE, request, next: ok200, store })).toBeNull();
  });

  it("el manifiesto solo no alcanza: sin activacion verificada no cobra", async () => {
    const store = new InMemorySettlementActivationStore();
    expect(await resolvePayPerCrawl({ policy: policyWith("cloudflare-pay-per-crawl"), rule: RULE, request, next: ok200, store })).toBeNull();
  });

  it("proveedor desconocido no cobra", async () => {
    const store = new InMemorySettlementActivationStore();
    await store.save({ ...activation, providerId: "x402" });
    expect(await resolvePayPerCrawl({ policy: policyWith("x402"), rule: RULE, request, next: ok200, store })).toBeNull();
  });

  it("manifiesto + activacion: agrega crawler-price", async () => {
    const store = new InMemorySettlementActivationStore();
    await store.save(activation);
    const result = await resolvePayPerCrawl({ policy: policyWith("cloudflare-pay-per-crawl"), rule: RULE, request, next: ok200, store });
    expect(result?.providerId).toBe("cloudflare-pay-per-crawl");
    expect(result?.response.headers.get("crawler-price")).toBe("USD 0.05");
  });
});
