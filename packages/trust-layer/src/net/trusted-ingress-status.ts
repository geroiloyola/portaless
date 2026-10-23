/** Configuration diagnostic only; no request header can claim trust or WAF coverage. */
export function trustedIngressStatus(env: { __PORTALESS_RUNTIME?: string; PORTALESS_TRUSTED_CLOUDFLARE_INGRESS?: string } = {}) {
  const node = env.__PORTALESS_RUNTIME === "node";
  const declaredCloudflare = !node && env.PORTALESS_TRUSTED_CLOUDFLARE_INGRESS === "true";
  return {
    configured: node || declaredCloudflare,
    source: node ? "node-runtime" : declaredCloudflare ? "operator-declared-cloudflare" : "unconfigured",
    edgeRulesVerified: false,
  };
}
