// Proveedor cloudflare-pay-per-crawl.
//
// Detras de Cloudflare con Pay Per Crawl activo, Cloudflare manda al origen
//   cf-pay-per-crawl: protocol=cloudflare, pricing=in-band|zone-default|bypass
// Con pricing=in-band el origen devuelve el contenido (200) con
//   crawler-price: USD x.xx
// y Cloudflare cobra al crawler o responde el 402. El origen nunca responde
// el 402 en este modo ni sabe si el crawler pago: por eso el ledger registra
// charged:false; la liquidacion vive en Cloudflare.
//
// Riesgo conocido: si el origen es alcanzable sin pasar por Cloudflare,
// cf-pay-per-crawl se puede falsificar. Por eso este proveedor solo actua con
// una activacion verificada, y la UI de activacion exige confirmar que el
// origen solo acepta trafico de Cloudflare.
//
// verifyActivation(): GET /client/v4/zones/{zone_id} con un API token
// acotado (Zone Read). Prueba que el admin controla la zona de este dominio.
// NO prueba que Pay Per Crawl este activo: no hay endpoint publico para eso
// (beta cerrada). Esa senal llega en runtime con cf-pay-per-crawl.
//
// Precio minimo: fuentes secundarias indican USD 0.01; no se confirmo en la
// documentacion oficial. Por debajo de eso no se emite crawler-price.

import type { ActivationCheck, ChargeContext, PayPerCrawlProvider, ProviderCredentials, VerifyContext } from "./types";

export const CLOUDFLARE_PROVIDER_ID = "cloudflare-pay-per-crawl";
const MIN_PRICE_USD = 0.01;
const ZONE_ID_RE = /^[a-f0-9]{32}$/;

export type CloudflarePricing = "in-band" | "zone-default" | "bypass";

export function parseCfPayPerCrawl(raw: string | null): { protocol: string; pricing: CloudflarePricing } | null {
  if (!raw) return null;
  const fields = new Map<string, string>();
  for (const part of raw.split(",")) {
    const [k, v] = part.split("=").map((s) => s?.trim().toLowerCase());
    if (k && v) fields.set(k, v);
  }
  const protocol = fields.get("protocol");
  const pricing = fields.get("pricing");
  if (protocol !== "cloudflare") return null;
  if (pricing !== "in-band" && pricing !== "zone-default" && pricing !== "bypass") return null;
  return { protocol, pricing };
}

export function formatCrawlerPrice(priceUsd: unknown): string | null {
  if (typeof priceUsd !== "number" || !Number.isFinite(priceUsd) || priceUsd < MIN_PRICE_USD) return null;
  return `USD ${priceUsd.toFixed(2)}`;
}

function hostMatchesZone(siteHost: string, zoneName: string): boolean {
  const host = siteHost.toLowerCase().replace(/\.$/, "");
  const zone = zoneName.toLowerCase().replace(/\.$/, "");
  return host === zone || host.endsWith(`.${zone}`);
}

export class CloudflarePayPerCrawlProvider implements PayPerCrawlProvider {
  id = CLOUDFLARE_PROVIDER_ID;
  displayName = "Cloudflare Pay Per Crawl";
  credentials = [
    { key: "api_token", label: "API token de Cloudflare (solo Zone Read)", secret: true, help: "Nunca la Global API Key." },
    { key: "zone_id", label: "Zone ID del dominio", secret: false },
  ];

  async verifyActivation(creds: ProviderCredentials, ctx: VerifyContext): Promise<ActivationCheck> {
    const token = creds.api_token?.trim();
    const zoneId = creds.zone_id?.trim().toLowerCase();
    if (!token) return { ok: false, reason: "missing_api_token" };
    if (!zoneId || !ZONE_ID_RE.test(zoneId)) return { ok: false, reason: "invalid_zone_id" };

    const doFetch = ctx.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
    } catch {
      return { ok: false, reason: "cloudflare_unreachable" };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "token_rejected" };
    if (!res.ok) return { ok: false, reason: `cloudflare_http_${res.status}` };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json().catch(() => null)) as any;
    const zone = body?.result;
    if (!body?.success || typeof zone?.name !== "string") return { ok: false, reason: "unexpected_cloudflare_response" };
    if (zone.status !== "active") return { ok: false, reason: "zone_not_active" };
    if (!hostMatchesZone(ctx.siteHost, zone.name)) return { ok: false, reason: "zone_does_not_match_site" };

    return { ok: true, metadata: { zone_id: zoneId, zone_name: zone.name } };
  }

  async handleCharge({ request, rule, next }: ChargeContext): Promise<Response | null> {
    const signal = parseCfPayPerCrawl(request.headers.get("cf-pay-per-crawl"));
    if (!signal || signal.pricing === "bypass") return null;
    if (signal.pricing === "zone-default") return next();

    const price = formatCrawlerPrice(rule.price_usd);
    if (!price) {
      console.warn(`[Portaless Pay Per Crawl] price_usd invalido o menor a USD ${MIN_PRICE_USD}: no se emite crawler-price.`);
      return null;
    }

    const upstream = await next();
    if (upstream.status !== 200) return upstream;
    const response = new Response(upstream.body, upstream);
    response.headers.set("crawler-price", price);
    return response;
  }
}
