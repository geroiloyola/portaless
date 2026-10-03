// packages/apw-resolver/src/scoring/reader-attestations.ts
//
// Carga las reader_conduct de un lector desde SU historial publicado (LTP
// v1.2, 6.4; ERRATA E-9). Mismo principio que Git: el contenido vale solo si
// su hash esta en una cadena firmada y anclada en el DNS.
//
// Pasos (todos fail-closed):
//   1. resolveApwHistory(lector, includeEntries): cadena verificada contra k y h
//      del TXT -> lista { seq, att, ts }.
//   2. Paquete /.well-known/apw-attestations.json del lector.
//   3. Todo JWS del paquete tiene su hash = att de una entrada de la cadena
//      (no se puede inventar ni alterar).
//   4. Completitud: cada att de la cadena tiene su JWS en el paquete (no se
//      puede ocultar una policy_violation ya anotada). Excepcion: entradas con
//      ts anterior a legacyCutoff, segun legacyEntriesWithoutJws.
//   5. De esas, las reader_conduct con sub = DID del lector y emisor distinto
//      del lector se verifican contra las claves publicadas del emisor (la
//      activa debe ser k de su TXT) y se pasan a dimensiones R.
//   Cualquier reader_conduct que no se pueda verificar invalida la carga: un
//   lector no puede dejar afuera las negativas alegando que no verifican.
//
// Lo que no cubre (E-9): omisiones en el origen y cadenas distintas para
// distintos visitantes. Requieren testigos externos (seccion 7).

import { resolveApwHistory, type ApwHistoryResult } from "../did-apw/history-resolver";
import { resolveApwManifest } from "../index";
import { jwkThumbprint, publicJwkMembers } from "../did-apw/fingerprint";
import { sha256B64Url } from "../did-apw/history-log";
import { verifyAttestation } from "../../../trust-layer/src/site-trust/attestation";
import { readerConductToDimension, type ScoredAttestation } from "./scoring";
import { READER_CONDUCT_CONFIG } from "./reader-conduct-config";

export interface IssuerKey {
  keyId: string;
  fingerprint: string;
  publicKeyJwk: JsonWebKey;
  validFrom: string;
  validTo: string | null;
}

export type ReaderConductFailure =
  | "reader_conduct_history_unverified"
  | "reader_conduct_bundle_unreachable"
  | "reader_conduct_bundle_invalid"
  | "reader_conduct_not_in_chain"
  | "reader_conduct_incomplete"
  | "reader_conduct_issuer_unresolvable"
  | "reader_conduct_invalid_attestation";

export type ReaderConductResult =
  | { ok: true; attestations: ScoredAttestation[]; checkedEntries: number; ignoredLegacy: number }
  | { ok: false; reason: ReaderConductFailure; seq?: number };

export interface ReaderConductDeps {
  fetchImpl?: typeof fetch;
  resolveHistory?: (host: string) => Promise<ApwHistoryResult>;
  resolveIssuerKeys?: (host: string) => Promise<IssuerKey[] | null>;
  config?: {
    maxAttestationsLoaded: number;
    legacyEntriesWithoutJws: "ignore" | "reject";
    legacyCutoff: string;
  };
}

const BUNDLE_PAGE = 500;
const MAX_PAGES = 40;
const DID_HOST_RE = /^did:apw:([a-z0-9.-]+)$/;

function b64UrlJson(part: string): any {
  const base64 = part.split("-").join("+").split("_").join("/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))));
}

const fail = (reason: ReaderConductFailure, seq?: number): ReaderConductResult => ({ ok: false, reason, seq });

async function fetchBundle(
  host: string,
  did: string,
  fetchImpl: typeof fetch
): Promise<{ ok: true; map: Map<string, string | null> } | { ok: false; reason: ReaderConductFailure }> {
  const map = new Map<string, string | null>();
  let from = 1;
  for (let page = 0; page < MAX_PAGES; page++) {
    let doc: any;
    try {
      const res = await fetchImpl(`https://${host}/.well-known/apw-attestations.json?from=${from}&limit=${BUNDLE_PAGE}`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) return { ok: false, reason: "reader_conduct_bundle_unreachable" };
      doc = await res.json();
    } catch {
      return { ok: false, reason: "reader_conduct_bundle_unreachable" };
    }
    if (!doc || doc.did !== did || !Array.isArray(doc.entries)) return { ok: false, reason: "reader_conduct_bundle_invalid" };
    for (const e of doc.entries) {
      if (typeof e?.att !== "string") return { ok: false, reason: "reader_conduct_bundle_invalid" };
      map.set(e.att, typeof e.jws === "string" ? e.jws : null);
    }
    if (doc.next === null || doc.next === undefined) return { ok: true, map };
    from = Number(doc.next);
    if (!Number.isInteger(from) || from < 1) return { ok: false, reason: "reader_conduct_bundle_invalid" };
  }
  return { ok: false, reason: "reader_conduct_bundle_invalid" };
}

/** Claves publicadas del emisor; la activa debe ser k de su TXT. null si no se puede comprobar. */
export async function defaultIssuerKeys(host: string, fetchImpl: typeof fetch = fetch): Promise<IssuerKey[] | null> {
  try {
    const m = await resolveApwManifest(host, fetchImpl);
    if (!m.resolved || !m.manifest?.k) return null;
    const res = await fetchImpl(`https://${host}/.well-known/apw-log.json?limit=1`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const doc: any = await res.json();
    if (!doc || doc.did !== `did:apw:${host}` || !Array.isArray(doc.keys)) return null;
    const keys: IssuerKey[] = [];
    for (const raw of doc.keys) {
      const pub = publicJwkMembers(raw.publicKeyJwk);
      const fingerprint = String(raw.fingerprint ?? raw.kid ?? "");
      if ((await jwkThumbprint(pub)) !== fingerprint || typeof raw.keyId !== "string") return null;
      keys.push({ keyId: raw.keyId, fingerprint, publicKeyJwk: pub, validFrom: raw.validFrom, validTo: raw.validTo ?? null });
    }
    if (!keys.some((k) => k.validTo === null && k.fingerprint === m.manifest!.k)) return null;
    return keys;
  } catch {
    return null;
  }
}

export async function loadReaderConduct(readerHost: string, deps: ReaderConductDeps = {}): Promise<ReaderConductResult> {
  const cfg = deps.config ?? READER_CONDUCT_CONFIG;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const did = `did:apw:${readerHost}`;

  const history = await (deps.resolveHistory ?? ((h: string) => resolveApwHistory(h, fetchImpl, { includeEntries: true })))(readerHost);
  if (!history.verified || !history.attestations) return fail("reader_conduct_history_unverified");

  const bundle = await fetchBundle(readerHost, did, fetchImpl);
  if (!bundle.ok) return fail(bundle.reason);

  const chainAtts = new Set(history.attestations.map((e) => e.att));
  for (const [att, jws] of bundle.map) {
    if (!chainAtts.has(att)) return fail("reader_conduct_not_in_chain");
    if (jws !== null && (await sha256B64Url(jws)) !== att) return fail("reader_conduct_not_in_chain");
  }

  const cutoff = Date.parse(cfg.legacyCutoff);
  let ignoredLegacy = 0;
  const candidates: Array<{ seq: number; jws: string; header: any; payload: any }> = [];
  for (const entry of history.attestations) {
    const jws = bundle.map.get(entry.att) ?? null;
    if (jws === null) {
      if (cfg.legacyEntriesWithoutJws === "ignore" && Date.parse(entry.ts) < cutoff) {
        ignoredLegacy++;
        continue;
      }
      return fail("reader_conduct_incomplete", entry.seq);
    }
    let header: any;
    let payload: any;
    try {
      const [h, p] = jws.split(".");
      header = b64UrlJson(h);
      payload = b64UrlJson(p);
    } catch {
      return fail("reader_conduct_invalid_attestation", entry.seq);
    }
    if (payload?.src !== "reader_conduct" || payload?.sub !== did || payload?.iss === did) continue;
    candidates.push({ seq: entry.seq, jws, header, payload });
  }

  const selected = candidates.slice(-cfg.maxAttestationsLoaded);
  const resolveKeys = deps.resolveIssuerKeys ?? ((h: string) => defaultIssuerKeys(h, fetchImpl));
  const keyCache = new Map<string, IssuerKey[] | null>();
  const seen = new Set<string>();
  const out: ScoredAttestation[] = [];

  for (const c of selected) {
    const issuerHost = DID_HOST_RE.exec(String(c.payload.iss))?.[1];
    if (!issuerHost) return fail("reader_conduct_invalid_attestation", c.seq);
    if (!keyCache.has(issuerHost)) keyCache.set(issuerHost, await resolveKeys(issuerHost).catch(() => null));
    const keys = keyCache.get(issuerHost);
    if (!keys) return fail("reader_conduct_issuer_unresolvable", c.seq);
    const key = keys.find((k) => k.keyId === c.header?.kid);
    if (!key) return fail("reader_conduct_invalid_attestation", c.seq);

    const r = await verifyAttestation(c.jws, key.publicKeyJwk, {
      sub: did,
      src: "reader_conduct",
      iss: c.payload.iss,
      kid: key.keyId,
      skipIatWindow: true,
    });
    if (!r.ok) return fail("reader_conduct_invalid_attestation", c.seq);
    const iatMs = r.claims.iat * 1000;
    if (iatMs < Date.parse(key.validFrom) || (key.validTo !== null && iatMs > Date.parse(key.validTo))) {
      return fail("reader_conduct_invalid_attestation", c.seq);
    }

    const dedupe = `${r.claims.iss}|${r.claims.jti}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    let mapped: { dimension: string; value: number };
    try {
      mapped = readerConductToDimension(r.claims.cat, r.claims.val);
    } catch {
      return fail("reader_conduct_invalid_attestation", c.seq);
    }
    out.push({ id: r.claims.jti, iss: r.claims.iss, sub: did, src: "reader_conduct", dimension: mapped.dimension, value: mapped.value });
  }

  return { ok: true, attestations: out, checkedEntries: history.attestations.length, ignoredLegacy };
}
