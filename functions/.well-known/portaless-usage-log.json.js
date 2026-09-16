// Endpoint publico de trazabilidad del Trust Layer: GET
// /.well-known/portaless-usage-log.json devuelve el ledger de uso de
// agentes de IA para un periodo dado, en el formato UsageLogPeriod
// (packages/trust-layer/src/ledger/log-schema.ts). Inspirado
// explicitamente en los paneles publicos de uso por modelo de
// OpenRouter -- ver ese archivo para el razonamiento de diseño.
//
// v0.0.9.3: primera conexion real del lado de LECTURA. El lado de
// ESCRITURA ya estaba conectado desde v0.0.6: functions/_middleware.js
// llama a recordAgentAccess(ledgerStore, ...) con
// createUsageLedgerStore(env) en cada request de un agente detectado, y
// eso SI persiste en D1/SQLite real (confirmado leyendo el middleware).
// Lo que faltaba -- y lo que agrega este archivo -- es un endpoint que
// exponga ese ledger ya escrito de vuelta como JSON publico, que es la
// mitad que el README describia como "aun en memoria" de forma
// imprecisa: no era que el ledger no persistiera, es que nada lo servia
// de vuelta para poder consultarlo.
//
// Publico a proposito (sin guard de sesion): el punto del Trust Layer es
// transparencia verificable por cualquiera, igual que
// /.well-known/portaless-content-policy.json ya es publico. No expone
// nada sensible -- solo el keyId del operador (ya publico por diseño en
// Web Bot Auth) y contadores agregados, nunca contenido de las requests.
//
// Query param opcional ?period=YYYY-MM; sin el parametro, devuelve el
// mes UTC actual. Un periodo sin ninguna entrada devuelve un
// UsageLogPeriod vacio con agents:[] (200, no 404) -- es un estado valido
// ("todavia no hubo trafico de agentes este mes"), no un error.

import { createUsageLedgerStore } from "../../packages/trust-layer/src/ledger/store-factory.ts";

function currentPeriod() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const requestedPeriod = url.searchParams.get("period");

  if (requestedPeriod && !PERIOD_RE.test(requestedPeriod)) {
    return new Response(
      JSON.stringify({ error: "invalid_period", message: "El parametro period debe tener el formato YYYY-MM." }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const period = requestedPeriod ?? currentPeriod();
  const store = await createUsageLedgerStore(env);
  const data = await store.get(period);

  const body = data ?? { period, generatedAt: new Date().toISOString(), agents: [] };

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json",
      // Cacheable brevemente -- son contadores agregados, no datos por-request,
      // y el propio Trust Layer ya escribe una entrada nueva por cada acceso
      // (incluyendo a este mismo endpoint si un agente automatizado lo pide).
      "cache-control": "public, max-age=60",
    },
  });
}
