// Dimensiones W de un sitio desde su SiteTrustSnapshot (Anexo A.2/A.4) y la
// proyeccion de niveles de visibilidad (A.6) que usa GET /trust/:siteId.
import { describe, expect, it } from "vitest";
import {
  CATEGORY_DIMENSION,
  escrowOutcomeValue,
  isSiteDimension,
  scoreSiteDimensions,
  siteSubject,
  snapshotToAttestations,
} from "../../packages/apw-resolver/src/scoring/site-dimensions";
import { PUBLIC_DIMENSIONS, projectTrustView } from "../../packages/apw-resolver/src/scoring/policy";

const SITE = "ejemplo.com";
const SUBJECT = `did:apw:${SITE}`;

// E-13: la fuente community solo puntua con atestaciones FIRMADAS por un
// did:apw y con historial suficientemente viejo. Con peso cold-start 0.25
// (A.4.2) hacen falta 8 emisores distintos para juntar el min_weight de 2.0.
const FIRST_SEEN = 1_700_000_000;
const IAT = 1_800_000_000;
function communityEmitter(n: number, category: string, score: number) {
  const iss = `did:apw:v${n}.example`;
  return { category, score, iss, jti: `${iss}:${category}`, iat: IAT, votedAt: "t1", emitterFirstSeenIat: FIRST_SEEN };
}
const eightOn = (category: string, score: number) =>
  Array.from({ length: 8 }, (_, i) => communityEmitter(i + 1, category, score));

const snapshot = {
  siteId: SITE,
  self: [
    { category: "gdpr_compliance", declaredValue: true, attestationJti: "j-gdpr" },
    { category: "payment_security", declaredValue: false },
    { category: "contact_transparency", declaredValue: true },
  ],
  agent: [
    { category: "https_and_headers", verified: true, agentKeyId: "https://ag.example", verifiedAt: "t1" },
    { category: "https_and_headers", verified: false, agentKeyId: "https://ag.example", verifiedAt: "t2" },
    { category: "content_freshness", verified: true, agentKeyId: "https://ag2.example", verifiedAt: "t1" },
    { category: "structured_data_quality", verified: true, agentKeyId: "https://ag2.example", verifiedAt: "t1" },
  ],
  community: [
    ...eightOn("spam_or_deceptive", 5),
    ...eightOn("responsiveness", 3),
    // perceived_trustworthiness no esta en A.2: no puntua aunque este firmada.
    communityEmitter(99, "perceived_trustworthiness", 1),
  ],
  escrowReports: [
    { transactionOutcome: "completed_as_promised", escrowProvider: "p1", reportedAt: "t1" },
    { transactionOutcome: "disputed", escrowProvider: "p1", reportedAt: "t2" },
    { transactionOutcome: "algo_raro", escrowProvider: "p1", reportedAt: "t3" },
  ],
};

describe("mapeo categoria -> dimension (A.2)", () => {
  it("cubre las categorias que puntuan y deja fuera las que A.2 no mapea", () => {
    expect(CATEGORY_DIMENSION).toMatchObject({
      https_and_headers: "W-01",
      bot_traffic_anomalies: "W-01",
      privacy_policy: "W-04",
      gdpr_compliance: "W-04",
      data_practices: "W-04",
      structured_data_quality: "W-06",
      machine_readable_policies: "W-06",
      content_freshness: "W-07",
      content_accuracy: "W-02",
      contact_transparency: "W-03",
      terms_of_service: "W-03",
      responsiveness: "W-03",
      payment_security: "W-05",
      spam_or_deceptive: "W-10",
    });
    expect(Object.keys(CATEGORY_DIMENSION)).not.toContain("perceived_trustworthiness");
  });

  it("isSiteDimension separa W de R", () => {
    for (const d of ["W-01", "W-09", "W-10"]) expect(isSiteDimension(d)).toBe(true);
    for (const d of ["R-01", "R-05", "X-1", "W-11", "w-01"]) expect(isSiteDimension(d)).toBe(false);
    expect(siteSubject(SITE)).toBe(SUBJECT);
  });

  it("A.4.1: booleanas 7/1, community 1..5 -> 1..7, escrow 7/2.5/1", () => {
    const atts = snapshotToAttestations(snapshot);
    const valueOf = (src: string, dim: string, match: (a: any) => boolean = () => true) =>
      atts.find((a) => a.src === src && a.dimension === dim && match(a))!.value;

    expect(valueOf("self", "W-04")).toBe(7);
    expect(valueOf("self", "W-05")).toBe(1);
    expect(valueOf("agent", "W-01", (a) => a.value === 7)).toBe(7);
    expect(valueOf("agent", "W-01", (a) => a.value === 1)).toBe(1);
    expect(valueOf("community", "W-10")).toBe(7);
    expect(valueOf("community", "W-03")).toBe(4);
    expect(valueOf("escrow_report", "W-05", (a) => a.value === 7)).toBe(7);
    expect(valueOf("escrow_report", "W-05", (a) => a.value === 1)).toBe(1);
  });

  it("ata la atestacion a su emisor y al DID del sitio (5.3)", () => {
    const atts = snapshotToAttestations(snapshot);
    const gdpr = atts.find((a) => a.id === "j-gdpr")!;
    expect(gdpr).toMatchObject({ iss: SUBJECT, sub: SUBJECT, src: "self", dimension: "W-04" });
    expect(atts.find((a) => a.src === "agent")!.iss).toBe("https://ag.example");
    // E-13: el emisor comunitario es el did:apw del Veracier, no un voterId.
    expect(atts.find((a) => a.src === "community")!.iss).toMatch(/^did:apw:v\d+\.example$/);
    expect(atts.find((a) => a.src === "escrow_report")!.iss).toBe("p1");
    expect(atts.every((a) => a.sub === SUBJECT)).toBe(true);
  });

  it("descarta categorias fuera del modelo y resultados de escrow desconocidos", () => {
    const atts = snapshotToAttestations(snapshot);
    expect(atts.some((a) => a.dimension === "W-08")).toBe(false);
    // perceived_trustworthiness no esta en A.2 y 'algo_raro' no es un resultado:
    // 16 atestaciones comunitarias firmadas + 2 de escrow sobreviven.
    expect(atts).toHaveLength(snapshot.self.length + snapshot.agent.length + 16 + 2);
    expect(escrowOutcomeValue("algo_raro")).toBeNull();
    expect(escrowOutcomeValue("refunded_no_delivery")).toBe(2.5);
    expect(() => snapshotToAttestations({ siteId: SITE })).not.toThrow();
  });

  it("una opinion de visitante sin firma (legacy) no puntua", () => {
    const atts = snapshotToAttestations({
      siteId: SITE,
      community: [
        { category: "content_accuracy", score: 5, voterId: "anon-1", votedAt: "t" },
        { category: "responsiveness", score: 4, voterId: "anon-2", votedAt: "t" },
      ],
    });
    expect(atts).toEqual([]);
  });

  it("una atestacion firmada sin historial resuelto no acredita antiguedad (fail-closed)", () => {
    const atts = snapshotToAttestations({
      siteId: SITE,
      community: [
        { category: "content_accuracy", score: 5, iss: "did:apw:v1.example", jti: "j1", iat: IAT, votedAt: "t" },
      ],
    });
    expect(atts).toEqual([]);
  });

  it("una fila legacy sin campo de valor, o fuera de escala, no puntua y no lanza", () => {
    const atts = snapshotToAttestations({
      siteId: SITE,
      self: [{ category: "privacy_policy" }],
      agent: [{ category: "https_and_headers", agentKeyId: "https://ag.example", verifiedAt: "t" }],
      community: [{ category: "content_accuracy", score: 9 as any, voterId: "v1", votedAt: "t" }],
      escrowReports: [{ transactionOutcome: 7 as any, escrowProvider: "p1", reportedAt: "t" }],
    });
    expect(atts).toEqual([]);
  });
});

describe("scoreSiteDimensions (A.4)", () => {
  it("puntua las dimensiones con evidencia y no deja R en el mapa", () => {
    const scores = scoreSiteDimensions(snapshot);
    expect([...scores.keys()].every(isSiteDimension)).toBe(true);
    expect(scores.has("R-05")).toBe(false);
    expect([...scores.keys()].sort()).toEqual(["W-01", "W-03", "W-04", "W-05", "W-06", "W-07", "W-09", "W-10"]);
    // Sin filas no hay entrada: no es 4.0, es "sin datos".
    expect(scores.has("W-02")).toBe(false);
    expect(scores.has("W-08")).toBe(false);
  });

  it("una sola declaracion self pesa 0.25 y acerca el puntaje al previo", () => {
    const scores = scoreSiteDimensions({ siteId: SITE, self: [{ category: "privacy_policy", declaredValue: true }] });
    const w04 = scores.get("W-04")!;
    expect(w04).toMatchObject({ count: 1 });
    expect(w04.weightSum).toBeCloseTo(0.25, 10);
    // (3 * 4.0 + 0.25 * 7) / (3 + 0.25)
    expect(w04.score).toBeCloseTo((12 + 1.75) / 3.25, 10);
  });

  it("W-09 exige self y terceros en la misma dimension", () => {
    const both = scoreSiteDimensions({
      siteId: SITE,
      self: [{ category: "terms_of_service", declaredValue: true }],
      // E-13: dos emisores distintos. Calibrados sin desviacion (J = 7, w = 1
      // cada uno) juntan el min_weight de 2.0, que es lo que hace puntuar a la
      // categoria; con uno solo (0.25) no pasaria el gate.
      community: [communityEmitter(1, "responsiveness", 5), communityEmitter(2, "responsiveness", 5)],
    });
    expect(both.has("W-09")).toBe(true);
    // declarado 7.0 vs verificado 7.0 -> divergencia 0 -> coherencia 7.0.
    // Pesos: self 0.25 + dos emisores J = 7 -> w = 1 cada uno.
    expect(both.get("W-09")).toMatchObject({ count: 1, weightSum: 2.25 });
    expect(both.get("W-09")!.score).toBeCloseTo((12 + 2.25 * 7) / 5.25, 10);

    const onlySelf = scoreSiteDimensions({
      siteId: SITE,
      self: [{ category: "terms_of_service", declaredValue: true }],
    });
    expect(onlySelf.has("W-09")).toBe(false);
  });

  it("E-13: el gate de min_weight decide si la categoria puntua", () => {
    const scores = scoreSiteDimensions({
      siteId: SITE,
      community: [communityEmitter(1, "spam_or_deceptive", 5)],
    });
    // Un emisor sin nadie con quien compararse queda en J = 4 (0.25 de peso),
    // por debajo de 2.0: la categoria se descarta entera.
    expect(scores.has("W-10")).toBe(false);
    expect(scores.size).toBe(0);

    // Dos emisores que coinciden se calibran entre si a J = 7 (w = 1.0 cada
    // uno): 2.0 exactos, el minimo. El peso cold-start de 0.25 no es el estado
    // estable -- el costo real de un Sybil es el piso de antiguedad de 7 dias
    // mas el precio de los dominios, no el peso.
    const two = scoreSiteDimensions({
      siteId: SITE,
      community: [communityEmitter(1, "spam_or_deceptive", 5), communityEmitter(2, "spam_or_deceptive", 5)],
    });
    expect(two.get("W-10")).toMatchObject({ count: 2 });
    expect(two.get("W-10")!.weightSum).toBeCloseTo(2.0, 10);
  });

  it("un snapshot vacio no produce dimensiones", () => {
    expect(scoreSiteDimensions({ siteId: SITE, self: [], agent: [], community: [], escrowReports: [] }).size).toBe(0);
  });
});

describe("proyeccion de niveles (A.6 / 6.6)", () => {
  const scores = scoreSiteDimensions(snapshot);

  it("al rechazar solo se ven las dimensiones publicas, con agregados de todas", () => {
    const view = projectTrustView(scores, false);
    expect(view.governed).toBe("withheld");
    expect(Object.keys(view.dimensions).sort()).toEqual(
      [...PUBLIC_DIMENSIONS].filter((d) => scores.has(d)).sort()
    );
    expect(Object.keys(view.dimensions).sort()).toEqual(["W-01", "W-04", "W-06", "W-07", "W-09"]);
    expect(Object.keys(view.aggregates).sort()).toEqual([...scores.keys()].sort());
    expect(view.aggregates["W-10"]).toMatchObject({ score: expect.any(Number), count: 8, weightSum: expect.any(Number) });
    expect(view.dimensions["W-10"]).toBeUndefined();
  });

  it("al permitir se ven todas las dimensiones del sitio", () => {
    const view = projectTrustView(scores, true);
    expect(view.governed).toBe("granted");
    expect(Object.keys(view.dimensions).sort()).toEqual([...scores.keys()].sort());
    expect(view.dimensions["W-10"]).toBeDefined();
  });
});
