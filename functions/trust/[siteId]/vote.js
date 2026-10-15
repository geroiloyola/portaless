// Endpoint RETIRADO (APW v1.3, ERRATA E-13).
// POST /trust/:siteId/vote
//
// El voto anonimo dejo de ser una fuente que puntua. Un `voter_id` que el
// navegador genera en localStorage es reemisible sin costo, asi que lo unico
// que acotaba al votante era un rate-limit por IP hasheada -- insuficiente para
// un grafo de confianza (6.7 exige emisores distintos y con antiguedad).
//
// La via vigente es `POST /trust/:siteId/community-attestation`, con una
// atestacion JWS firmada por un did:apw (5.3 + E-13). Responde 410 para que un
// cliente viejo vea un motivo explicito en vez de un 404 mudo.

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const GONE = {
  error: "endpoint_retired",
  message:
    "El voto anonimo fue retirado en APW v1.3 (ERRATA E-13): no tenia identidad verificable. " +
    "Emite una atestacion firmada con un did:apw en POST /trust/:siteId/community-attestation.",
  replacement: "/trust/:siteId/community-attestation",
};

export async function onRequestPost() {
  return json(GONE, 410);
}

export async function onRequestGet() {
  return json(GONE, 410);
}
