import { createCommunityAttestationsStore } from "../../../packages/trust-layer/src/site-trust/community-attestations.ts";
import { createAuthorizedEscrowProvidersStore } from "../../../packages/trust-layer/src/site-trust/authorized-escrow-providers.ts";
import { verifyAttestation } from "../../../packages/trust-layer/src/site-trust/attestation.ts";
import { resolveAgentDirectoryKey } from "../../../packages/trust-layer/src/site-trust/web-bot-auth.ts";
import { assertSafeUrl } from "../../../packages/apw-resolver/src/federation/safe-fetch.ts";
import { createSiteIdentityStore, createAttestationLogStore } from "../../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { resolveApwIdentity } from "../../../packages/apw-resolver/src/index.ts";
import { resolveApwHistory } from "../../../packages/apw-resolver/src/did-apw/history-resolver.ts";
import { jwkThumbprint } from "../../../packages/apw-resolver/src/did-apw/fingerprint.ts";
import { reconstructSvriHistory } from "../../../packages/apw-resolver/src/scoring/svri-history.ts";

const LOG_PAGE_SIZE = 500;
const MAX_LOG_ENTRIES = 20_000;
const MAX_EXTERNAL_ISSUERS = 16;
const MAX_HISTORY_RESPONSE_EVENTS = 1_000;

function respond(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function inKeyWindow(claims, key) {
  const time = claims.iat * 1000;
  const from = Date.parse(key.validFrom);
  const to = key.validTo ? Date.parse(key.validTo) : Infinity;
  // Attestation iat is integer epoch seconds while key windows use ISO
  // timestamps with millisecond precision; compare at the protocol's seconds.
  return Number.isFinite(from) && time >= Math.floor(from / 1000) * 1000 && time <= Math.floor(to / 1000) * 1000;
}

function siteKey(keys, kid) {
  return keys.find((key) => key.keyId === kid || key.kid === kid) ?? null;
}

function verifiedAtestation(jws, claims, key, expectedKid, siteDid) {
  if (!key || !inKeyWindow(claims, key)) return { verified: false, reason: "source_key_unavailable_or_outside_window" };
  return verifyAttestation(jws, key.publicKeyJwk, {
    sub: claims.src === "reader_conduct" ? claims.sub : siteDid,
    src: claims.src,
    iss: claims.iss,
    kid: expectedKid,
    skipIatWindow: true,
  });
}

async function listSiteLog(logStore, siteId) {
  const entries = [];
  for (let from = 1; from <= MAX_LOG_ENTRIES; from += LOG_PAGE_SIZE) {
    const page = await logStore.list(siteId, from, LOG_PAGE_SIZE);
    entries.push(...page);
    if (page.length < LOG_PAGE_SIZE) return entries;
  }
  throw new Error("svri_history_limit_exceeded");
}

function safeVerifierFetch(env) {
  const lookup = typeof env.__PORTALESS_DNS_LOOKUP === "function" ? env.__PORTALESS_DNS_LOOKUP : undefined;
  const wrapped = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    // The URL guard rejects literal/private hosts and redirects. Cloudflare's
    // runtime adds its own egress restrictions; this shared Functions module
    // deliberately has no Node-only DNS dependency.
    await assertSafeUrl(url, lookup);
    const response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (!response.ok || (response.status >= 300 && response.status < 400) || !response.body) return response;
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 512 * 1024) {
        await reader.cancel().catch(() => {});
        return new Response("{}", { status: 413, headers: { "content-type": "application/json" } });
      }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  wrapped.assertUrl = async (input) => assertSafeUrl(new URL(input), lookup);
  return wrapped;
}

export async function onRequestGet({ data, request, env }) {
  if (!data?.user) return respond({ error: "unauthenticated" }, 401);
  if (data.user.role !== "admin") return respond({ error: "forbidden" }, 403);
  const siteId = new URL(request.url).searchParams.get("siteId") || "default";
  if (!/^[a-z0-9.-]{1,253}$/i.test(siteId)) return respond({ error: "invalid_site_id" }, 400);

  try {
    const verifierFetch = safeVerifierFetch(env);
    const [communityStore, identityStore, logStore, escrowStore] = await Promise.all([
      createCommunityAttestationsStore(env),
      createSiteIdentityStore(env),
      createAttestationLogStore(env),
      createAuthorizedEscrowProvidersStore(env),
    ]);
    const [communityRows, identity, siteKeys, entries] = await Promise.all([
      communityStore.listBySite(siteId),
      identityStore.get(siteId),
      identityStore.listKeys(siteId),
      listSiteLog(logStore, siteId),
    ]);
    if (!identity) return respond({ error: "site_identity_not_found" }, 404);

    const firstSeen = new Map(communityRows.map((row) => [`${row.iss}\u0000${row.jti}`, row.emitterFirstSeenIat]));
    const activeKey = siteKeys.find((key) => key.validTo === null);
    const activeFingerprint = activeKey?.kid ?? "";

    let anchorHead = null;
    let anchorChecked = false;
    try {
      const resolved = await resolveApwIdentity(identity.domain, verifierFetch);
      const currentFingerprint = await jwkThumbprint(identity.publicKeyJwk);
      if (resolved.verified && resolved.manifest?.h && resolved.manifest.k === currentFingerprint) {
        anchorHead = resolved.manifest.h;
        anchorChecked = true;
      }
    } catch {
      // Offline HSVR can still verify the local chain, but must label it unanchored.
    }

    const issuerHistory = new Map();
    const agentKeys = new Map();
    const verifySource = async (jws, claims, kid) => {
      if (claims.src === "self" || claims.src === "reader_conduct") {
        if (claims.iss !== identity.did) return { verified: false, reason: "site_issuer_mismatch" };
        const key = siteKey(siteKeys, kid);
        const result = await verifiedAtestation(jws, claims, key, kid, identity.did);
        return { verified: result.ok, reason: result.ok ? undefined : result.reason };
      }
      if (claims.src === "escrow_report") {
        const publicKey = await escrowStore.getPublicKeyJwk(claims.iss);
        if (!publicKey) return { verified: false, reason: "escrow_key_history_unavailable" };
        const result = await verifyAttestation(jws, publicKey, { sub: identity.did, src: claims.src, iss: claims.iss, skipIatWindow: true });
        return { verified: result.ok, reason: result.ok ? undefined : result.reason };
      }
      if (claims.src === "agent") {
        const cacheKey = `${claims.iss}\u0000${kid}`;
        try {
          await verifierFetch.assertUrl(claims.iss);
          let publicKey = agentKeys.get(cacheKey);
          if (!publicKey) {
            if (agentKeys.size >= MAX_EXTERNAL_ISSUERS) return { verified: false, reason: "svri_source_issuer_limit" };
            publicKey = await resolveAgentDirectoryKey(claims.iss, kid, env.JWKS_CACHE, verifierFetch);
            if (publicKey) agentKeys.set(cacheKey, publicKey);
          }
          const result = await verifyAttestation(jws, publicKey, { sub: identity.did, src: claims.src, iss: claims.iss, kid, skipIatWindow: true });
          return { verified: result.ok, reason: result.ok ? undefined : result.reason };
        } catch {
          return { verified: false, reason: "agent_key_unavailable" };
        }
      }
      if (claims.src === "community") {
        const host = claims.iss.startsWith("did:apw:") ? claims.iss.slice("did:apw:".length) : "";
        if (!host) return { verified: false, reason: "community_issuer_invalid" };
        let history = issuerHistory.get(host);
        if (!history) {
          if (issuerHistory.size >= MAX_EXTERNAL_ISSUERS) return { verified: false, reason: "svri_source_issuer_limit" };
          try { history = await resolveApwHistory(host, verifierFetch, { includeKeys: true }); }
          catch { history = { verified: false, reason: "issuer_history_unavailable" }; }
          issuerHistory.set(host, history);
        }
        if (!history.verified) return { verified: false, reason: "community_issuer_history_unavailable" };
        const key = (history.keys ?? []).find((item) => item.keyId === kid || item.kid === kid);
        if (!key || !inKeyWindow(claims, key)) return { verified: false, reason: "community_key_unavailable_or_outside_window" };
        const result = await verifyAttestation(jws, key.publicKeyJwk, { sub: identity.did, src: claims.src, iss: claims.iss, kid, skipIatWindow: true });
        return { verified: result.ok, reason: result.ok ? undefined : result.reason };
      }
      return { verified: false, reason: "unsupported_source" };
    };

    const reconstructed = await reconstructSvriHistory({
      siteId,
      siteDid: identity.did,
      entries,
      keys: siteKeys.map((key) => ({ kid: key.kid, keyId: key.keyId, publicKeyJwk: key.publicKeyJwk, validFrom: key.validFrom, validTo: key.validTo })),
      activeFingerprint,
      anchorHead,
      identityCreatedAt: identity.createdAt,
      communityFirstSeen: firstSeen,
      verifySource,
    });
    const detail = reconstructed.detail;
    if (!detail) return respond({ error: "svri_history_unavailable" }, 503);
    const eventsTruncated = reconstructed.events.length > MAX_HISTORY_RESPONSE_EVENTS;
    const history = eventsTruncated
      ? { ...reconstructed, events: reconstructed.events.slice(-MAX_HISTORY_RESPONSE_EVENTS) }
      : reconstructed;
    return respond({ siteId, ...detail, history, anchorChecked, eventsTruncated });
  } catch {
    return respond({ error: "svri_unavailable" }, 503);
  }
}
