// Interfaz de liquidacion de pagos. Portaless NO procesa pagos directamente
// (mismo principio aplicado al modulo de comercio con Medusa/Mercur): delega
// la ejecucion del cobro a un proveedor externo ya especializado en esto.

export interface SettlementRequest {
  operatorKeyId: string;
  amountUsd: number;
  siteId: string;
  timestamp: string;
}

export interface SettlementResult {
  success: boolean;
  transactionId?: string;
  provider: string;
  error?: string;
}

export interface SettlementProvider {
  name: string;
  charge(request: SettlementRequest): Promise<SettlementResult>;
}

/**
 * Adaptador de referencia para Cloudflare Pay per Crawl. Requiere que el
 * sitio corra detras de Cloudflare con AI Crawl Control habilitado; la
 * liquidacion real ocurre en la infraestructura de Cloudflare, este
 * adaptador solo confirma el resultado hacia el ledger de Portaless.
 */
export class CloudflarePayPerCrawlAdapter implements SettlementProvider {
  name = "cloudflare-pay-per-crawl";

  async charge(request: SettlementRequest): Promise<SettlementResult> {
    // TODO: integrar con la API de AI Crawl Control de Cloudflare una vez
    // disponible para el plan de tu cuenta. Placeholder de MVP:
    return {
      success: false,
      provider: this.name,
      error: "Integracion pendiente. Configura AI Crawl Control en tu zona de Cloudflare.",
    };
  }
}

/**
 * Adaptador nulo para sitios que aun no activan liquidacion real -- registra
 * el intento en el ledger como "charged=false" sin bloquear al agente.
 * Util para la fase de piloto/observacion antes de cobrar de verdad.
 */
export class ObservationOnlyAdapter implements SettlementProvider {
  name = "observation-only";

  async charge(): Promise<SettlementResult> {
    return { success: false, provider: this.name, error: "modo_observacion" };
  }
}
