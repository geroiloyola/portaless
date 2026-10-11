// Fixtures con material REAL (claves Ed25519, statements firmados, cadenas
// encadenadas) para los tests del Portaless Index. Solo la red y la
// resolucion de cadenas son locales.
import { InMemorySiteIdentityStore } from "../../packages/apw-resolver/src/did-apw/site-identity-store";
import { InMemoryAttestationLogStore } from "../../packages/apw-resolver/src/did-apw/attestation-log-store";
import { appendAttestation } from "../../packages/apw-resolver/src/did-apw/history-log";
import { buildDidDocument } from "../../packages/apw-resolver/src/did-apw/document";
import { signWitnessStatement } from "../../packages/apw-resolver/src/did-apw/witness";
import type { ApwKeyPair } from "../../packages/apw-resolver/src/did-apw/types";
import type { ApwHistoryResult } from "../../packages/apw-resolver/src/did-apw/history-resolver";

export const INDEX_ENV = {
  PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
};
export const SITE_ID = "default";

async function makeKeyPair(domain: string): Promise<ApwKeyPair> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const did = `did:apw:${domain}`;
  return { did, domain, publicKeyJwk, privateKeyJwk, didDocument: buildDidDocument(did, publicKeyJwk) };
}

export interface IndexSite {
  domain: string;
  did: string;
  identity: InMemorySiteIdentityStore;
  log: InMemoryAttestationLogStore;
  deps: { identity: InMemorySiteIdentityStore; log: InMemoryAttestationLogStore; siteId: string };
}

export async function makeIndexSite(domain: string): Promise<IndexSite> {
  const identity = new InMemorySiteIdentityStore(INDEX_ENV);
  const log = new InMemoryAttestationLogStore();
  await identity.create(SITE_ID, await makeKeyPair(domain), "admin");
  return { domain, did: `did:apw:${domain}`, identity, log, deps: { identity, log, siteId: SITE_ID } };
}

const fakeAttestation = (n: number) => `eyJ0IjoxfQ.${Buffer.from(`att-${n}`).toString("base64url")}.c2ln`;

export async function appendIndexChain(site: IndexSite, count: number): Promise<void> {
  for (let i = 1; i <= count; i++) await appendAttestation(site.deps, fakeAttestation(i));
}

export async function indexHistoryOf(site: IndexSite): Promise<ApwHistoryResult> {
  const rows = await site.log.list(SITE_ID, 1, 500);
  const keys = await site.identity.listKeys(SITE_ID);
  return {
    verified: true,
    reason: "ok",
    domain: site.domain,
    length: rows.length,
    head: rows.length > 0 ? rows[rows.length - 1].entryHash : null,
    anchoredSeq: rows.length,
    attestations: rows.map((r) => ({ seq: r.seq, att: r.attHash, ts: r.ts, kid: r.kid, entryHash: r.entryHash })),
    keys,
  };
}

function decodePayload(jws: string): any {
  try {
    const part = jws.split(".")[1];
    const base64 = part.split("-").join("+").split("_").join("/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

/** Documento /.well-known/apw-witnesses.json del testigo, desde su cadena real. */
export async function witnessDocOf(site: IndexSite): Promise<any> {
  const rows = await site.log.list(SITE_ID, 1, 500);
  const entries = rows.map((r) => {
    const p = decodePayload(r.attJws);
    return {
      seq: r.seq,
      att: r.attHash,
      jws: r.attJws,
      witness: { sub: p?.sub ?? null, seq: p?.seq ?? null, head: p?.head ?? null, ts: p?.ts ?? null, jti: p?.jti ?? null },
    };
  });
  return { did: site.did, length: rows.length, entries, next: null };
}

/** El testigo anota una observacion de la cadena ACTUAL del sujeto. */
export async function recordIndexObservation(witness: IndexSite, subject: IndexSite): Promise<void> {
  const history = await indexHistoryOf(subject);
  const key = await witness.identity.getActiveSigningKey(SITE_ID);
  const { jws } = await signWitnessStatement(
    { iss: witness.did, sub: subject.did, seq: history.length ?? 0, head: history.head ?? null, ts: new Date().toISOString() },
    { keyId: key!.keyId, privateKeyJwk: key!.privateKeyJwk }
  );
  await appendAttestation(witness.deps, jws);
}
