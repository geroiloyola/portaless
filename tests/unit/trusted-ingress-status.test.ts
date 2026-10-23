import { expect, it } from "vitest";
import { trustedIngressStatus } from "../../packages/trust-layer/src/net/trusted-ingress-status";

it("reports server-configured ingress without asserting verified edge/WAF protection", () => {
  expect(trustedIngressStatus()).toEqual({ configured: false, source: "unconfigured", edgeRulesVerified: false });
  expect(trustedIngressStatus({ PORTALESS_TRUSTED_CLOUDFLARE_INGRESS: "false" }).configured).toBe(false);
  expect(trustedIngressStatus({ __PORTALESS_RUNTIME: "node" })).toEqual({ configured: true, source: "node-runtime", edgeRulesVerified: false });
  expect(trustedIngressStatus({ PORTALESS_TRUSTED_CLOUDFLARE_INGRESS: "true" })).toEqual({ configured: true, source: "operator-declared-cloudflare", edgeRulesVerified: false });
});
