import { expect, it } from "vitest";
import { trustedIngressStatus } from "@verared/trust-layer/net";
import { createHostTrustedIngress } from "../../functions/_shared/gatekeeper-runtime.js";

it("reports server-configured ingress without asserting verified edge/WAF protection", () => {
  expect(trustedIngressStatus()).toEqual({ configured: false, source: "unconfigured", edgeRulesVerified: false });
  expect(trustedIngressStatus(createHostTrustedIngress({ PORTALESS_TRUSTED_CLOUDFLARE_INGRESS: "false" })).configured).toBe(false);
  expect(trustedIngressStatus(createHostTrustedIngress({ __PORTALESS_RUNTIME: "node" }))).toEqual({ configured: true, source: "injected-resolver", edgeRulesVerified: false });
  expect(trustedIngressStatus(createHostTrustedIngress({ PORTALESS_TRUSTED_CLOUDFLARE_INGRESS: "true" }))).toEqual({ configured: true, source: "injected-resolver", edgeRulesVerified: false });
});
