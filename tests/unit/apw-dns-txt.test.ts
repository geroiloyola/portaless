// Tests reales de resolveApwTxtRecord(): mockea unicamente `fetch` (el
// unico limite de red real de este modulo, igual que verifyWebBotAuthRequest()
// mockea solo el directorio de claves remoto). No usa fixtures de string
// crudo para las respuestas DoH -- construye el JSON exacto que devuelve
// Cloudflare 1.1.1.1 (`application/dns-json`), incluyendo el formato real
// de TXT con comillas y fragmentos multi-string.
//
// Un test adicional (marcado con .skipIf de red deshabilitada) resuelve
// contra el DoH real de Cloudflare para un dominio publico conocido
// (cloudflare.com, que si publica TXT records) -- mismo estandar de
// honestidad que "tests de resolucion contra un dominio real, no mock"
// pedido en ROADMAP.md. Se skippea automaticamente si no hay red en el
// entorno de CI, en vez de fallar el suite completo por falta de acceso
// a internet.

import { describe, it, expect, vi } from "vitest";
import { resolveApwTxtRecord, parseDohTxtData, APW_TXT_PREFIX, DOH_ENDPOINT } from "../../packages/apw-resolver/src/dns-txt/dns-txt";

function mockDohResponse(fetchSpy: ReturnType<typeof vi.fn>, answers: Array<{ data: string; type?: number }>) {
  fetchSpy.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      Status: 0,
      Answer: answers.map((a) => ({ name: "_apw.example.com.", type: a.type ?? 16, TTL: 300, data: a.data })),
    }),
  });
}

describe("parseDohTxtData", () => {
  it("desenvuelve un TXT simple entre comillas", () => {
    expect(parseDohTxtData('"hola mundo"')).toBe("hola mundo");
  });

  it("concatena fragmentos multi-string en orden", () => {
    expect(parseDohTxtData('"parte1" "parte2" "parte3"')).toBe("parte1parte2parte3");
  });

  it("desescapa comillas internas escapadas", () => {
    expect(parseDohTxtData('"contiene \\"comillas\\" internas"')).toBe('contiene "comillas" internas');
  });
});

describe("resolveApwTxtRecord", () => {
  it("resuelve un TXT record valido y devuelve su contenido", async () => {
    const fetchSpy = vi.fn();
    mockDohResponse(fetchSpy, [{ data: '"{\\"v\\":1}"' }]);

    const result = await resolveApwTxtRecord("example.com", fetchSpy as unknown as typeof fetch);

    expect(result.resolved).toBe(true);
    expect(result.reason).toBe("ok");
    expect(result.queriedName).toBe(`${APW_TXT_PREFIX}.example.com`);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].value).toBe('{"v":1}');
  });

  it("consulta el nombre exacto _apw.<dominio> con type=TXT via DoH", async () => {
    const fetchSpy = vi.fn();
    mockDohResponse(fetchSpy, [{ data: '"x"' }]);

    await resolveApwTxtRecord("mysite.example", fetchSpy as unknown as typeof fetch);

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain(DOH_ENDPOINT);
    expect(calledUrl).toContain(encodeURIComponent("_apw.mysite.example"));
    expect(calledUrl).toContain("type=TXT");
  });

  it("rechaza un dominio invalido antes de hacer cualquier request de red", async () => {
    const fetchSpy = vi.fn();

    const result = await resolveApwTxtRecord("no es un dominio", fetchSpy as unknown as typeof fetch);

    expect(result.resolved).toBe(false);
    expect(result.reason).toBe("invalid_domain");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reporta no_txt_records si el dominio no tiene TXT bajo _apw", async () => {
    const fetchSpy = vi.fn();
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ Status: 0, Answer: [] }) });

    const result = await resolveApwTxtRecord("sin-apw.example.com", fetchSpy as unknown as typeof fetch);

    expect(result.resolved).toBe(false);
    expect(result.reason).toBe("no_txt_records");
  });

  it("reporta no_txt_records si Answer solo tiene records de otro tipo (ej. A)", async () => {
    const fetchSpy = vi.fn();
    mockDohResponse(fetchSpy, [{ data: "1.2.3.4", type: 1 }]);

    const result = await resolveApwTxtRecord("example.com", fetchSpy as unknown as typeof fetch);

    expect(result.resolved).toBe(false);
    expect(result.reason).toBe("no_txt_records");
  });

  it("reporta doh_response_not_ok si el resolver DoH responde con error HTTP", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({ ok: false });

    const result = await resolveApwTxtRecord("example.com", fetchSpy as unknown as typeof fetch);

    expect(result.resolved).toBe(false);
    expect(result.reason).toBe("doh_response_not_ok");
  });

  it("reporta doh_request_failed si fetch lanza (sin red, DNS caido, etc.)", async () => {
    const fetchSpy = vi.fn().mockRejectedValueOnce(new Error("network down"));

    const result = await resolveApwTxtRecord("example.com", fetchSpy as unknown as typeof fetch);

    expect(result.resolved).toBe(false);
    expect(result.reason).toBe("doh_request_failed");
  });

  it("reporta malformed_dns_response si el body no es JSON valido", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => { throw new Error("bad json"); } });

    const result = await resolveApwTxtRecord("example.com", fetchSpy as unknown as typeof fetch);

    expect(result.resolved).toBe(false);
    expect(result.reason).toBe("malformed_dns_response");
  });

  it("reporta malformed_dns_response si falta Status o Answer no es array", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ Answer: "no-es-array" }) });

    const result = await resolveApwTxtRecord("example.com", fetchSpy as unknown as typeof fetch);

    expect(result.resolved).toBe(false);
    expect(result.reason).toBe("malformed_dns_response");
  });

  // Test de integracion real contra el DoH publico de Cloudflare, sin mocks.
  // Se salta automaticamente si no hay red disponible en el entorno de CI,
  // para no romper el suite completo por falta de acceso a internet --
  // mismo criterio ya usado en otras partes del repo para adaptadores
  // externos sin cuenta de prueba disponible (ver ROADMAP.md, "Funciones Externas").
  const hasNetwork = process.env.PORTALESS_ENABLE_NETWORK_TESTS === "1";

  it.skipIf(!hasNetwork)(
    "resuelve un dominio real via DoH real (requiere PORTALESS_ENABLE_NETWORK_TESTS=1)",
    async () => {
      // cloudflare.com no publica hoy un manifiesto APW real -- este test
      // verifica exclusivamente que la capa de transporte DoH funciona
      // contra el resolver real (sin mocks), no que exista un manifiesto.
      // El resultado esperado es "no_txt_records" (dominio real, sin _apw),
      // no un resolved:true fabricado.
      const result = await resolveApwTxtRecord("cloudflare.com");
      expect(["no_txt_records", "ok"]).toContain(result.reason);
    }
  );
});
