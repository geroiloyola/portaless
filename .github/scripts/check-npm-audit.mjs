// Filtra la salida de `npm audit --json` contra .github/audit-allowlist.json.
//
// Falla si hay una advisory high o critical que no esta en la allowlist, si una
// excepcion ya vencio (expires < hoy, UTC) o si el reporte no se puede leer.
// Avisa cuando una excepcion ya no aparece en el audit y se puede quitar.
// Sin dependencias: corre con el Node del runner.

import { readFileSync } from "node:fs";

const LEVELS = new Set(["high", "critical"]);
const GHSA_RE = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i;
const today = new Date().toISOString().slice(0, 10);

function fail(message) {
  console.error(`::error::${message}`);
  process.exitCode = 1;
}

let allow = [];
try {
  allow = JSON.parse(readFileSync(".github/audit-allowlist.json", "utf8")).advisories ?? [];
} catch (err) {
  fail(`No se pudo leer .github/audit-allowlist.json: ${err.message}`);
  process.exit(1);
}
if (!Array.isArray(allow)) {
  fail(".github/audit-allowlist.json debe contener advisories como array.");
  process.exit(1);
}
const allowIds = new Set();
for (const entry of allow) {
  const id = String(entry?.id ?? "").toUpperCase();
  if (!GHSA_RE.test(id)) fail(`ID invalido en audit allowlist: ${entry?.id ?? "(vacio)"}.`);
  if (allowIds.has(id)) fail(`ID duplicado en audit allowlist: ${id}.`);
  allowIds.add(id);
  if (typeof entry?.package !== "string" || !entry.package.trim()) fail(`${id}: falta package en audit allowlist.`);
  if (typeof entry?.reason !== "string" || entry.reason.trim().length < 20) fail(`${id}: falta un reason concreto (minimo 20 caracteres).`);
  const parsedExpiry = typeof entry?.expires === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.expires)
    ? new Date(`${entry.expires}T00:00:00Z`)
    : null;
  if (!parsedExpiry || Number.isNaN(parsedExpiry.valueOf()) || parsedExpiry.toISOString().slice(0, 10) !== entry.expires) {
    fail(`${id}: expires debe ser una fecha YYYY-MM-DD valida.`);
  } else if (entry.expires < today) {
    fail(`${id}: la excepcion vencio ${entry.expires}; renovar con justificacion o eliminarla.`);
  }
}
if (process.exitCode) process.exit(1);

let report;
try {
  report = JSON.parse(readFileSync(process.argv[2] ?? "audit.json", "utf8"));
} catch (err) {
  fail(`npm audit no devolvio un JSON valido: ${err.message}`);
  process.exit(1);
}
if (report.error) {
  fail(`npm audit fallo: ${report.error.summary ?? JSON.stringify(report.error)}`);
  process.exit(1);
}

const found = new Map();
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== "object" || !LEVELS.has(via.severity)) continue;
    const id = (String(via.url ?? "").match(GHSA_RE) ?? [])[0]?.toUpperCase().replace(/^GHSA/, "GHSA") ?? `npm-${via.source}`;
    found.set(id, { pkg: via.name ?? name, severity: via.severity, title: via.title ?? "" });
  }
}

const meta = report.metadata?.vulnerabilities ?? {};
if ((meta.high ?? 0) + (meta.critical ?? 0) > 0 && found.size === 0) {
  fail("npm audit informa vulnerabilidades high/critical pero no se pudieron identificar: revisar el formato del reporte.");
}

const normalize = (id) => String(id).toUpperCase();

for (const [id, info] of found) {
  const entry = allow.find((a) => normalize(a.id) === normalize(id));
  const label = `${id} (${info.severity}) en ${info.pkg}${info.title ? `: ${info.title}` : ""}`;
  if (!entry) {
    fail(`Advisory no permitida: ${label}`);
  } else if (entry.package !== info.pkg) {
    fail(`Package mismatch en allowlist: ${id} reporta ${info.pkg}, pero la excepcion declara ${entry.package}.`);
  } else if (entry.expires < today) {
    fail(`Excepcion vencida (${entry.expires ?? "sin fecha"}): ${label}. Revisar o renovar con motivo.`);
  } else {
    console.log(`Permitida hasta ${entry.expires}: ${label}`);
  }
}

for (const entry of allow) {
  if (![...found.keys()].some((id) => normalize(id) === normalize(entry.id))) {
    console.log(`::notice::${entry.id} ya no aparece en npm audit; se puede quitar de la allowlist.`);
  }
}

if (!process.exitCode) console.log(`npm audit OK: ${found.size} advisory(s) high/critical, todas permitidas y vigentes.`);
