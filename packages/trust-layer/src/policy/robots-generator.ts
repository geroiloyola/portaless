// Genera un robots.txt que incluye Content Signals a partir del manifiesto
// de politicas de Portaless, para que crawlers que aun no soportan el
// manifiesto JSON de Portaless igual reciban una señal legible en el
// formato ya estandarizado por Cloudflare/IETF AIPREF.

import type { ContentPolicyManifest, AccessMode } from "./manifest-schema";

function toYesNo(access: AccessMode): "yes" | "no" {
  return access === "block" ? "no" : "yes";
}

export function generateRobotsTxt(manifest: ContentPolicyManifest): string {
  const { search, ai_input, ai_train } = manifest.policies;

  return `# Generado automaticamente por Portaless (Trust Layer v${manifest.version})
# Politica legible por humanos: ver /.well-known/portaless-content-policy.json
# para condiciones de pago y excepciones por operador.

User-agent: *
Allow: /

# Content Signals (compatible con el estandar de Cloudflare / IETF AIPREF)
Content-Signal: search=${toYesNo(search.access)}, ai-input=${toYesNo(ai_input.access)}, ai-train=${toYesNo(ai_train.access)}

Sitemap: ${manifest.site}/sitemap.xml
`;
}
