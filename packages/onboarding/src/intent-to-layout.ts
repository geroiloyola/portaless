// v0.0.9.27 -- Item 2 del roadmap ("Cerebro del Onboarding"), opcion C.
//
// Traduce el prompt de intencion del Paso 1 del Wizard a un PageLayout real
// de Atomic Elements. Implementacion DETERMINISTA (palabras clave -> plantilla):
// sin API key, sin costo, sin red, testeable. Detras de la interfaz
// IntentToLayout para que un adaptador LLM (o el SDK externo Nuvid, ver
// ROADMAP "Agente generador de sitios") se enchufe despues sin tocar el
// endpoint ni el Wizard.
//
// Por que no pasa por el MCP server: corre por stdio y workerd no puede
// lanzar procesos. Ademas quien actua aca es el admin humano autenticado,
// no un agente -- no corresponde requireCapability().
//
// Contrato de props: cada prop usada aqui existe en elementRegistry[type]
// .defaultProps con el mismo tipo (tests/unit/wizard-intent.test.ts lo
// verifica, porque validatePageLayout NO valida props).

import type { PageLayout, ElementNode, ElementType } from "../../atomic-elements/src/types";

export interface IntentInput {
  siteName: string;
  siteIntent: string;
  siteDomain?: string;
}

export type TemplateId = "portfolio" | "store" | "link-in-bio" | "landing";

export interface IntentLayoutResult {
  templateId: TemplateId;
  layout: PageLayout;
}

export interface IntentToLayout {
  generate(input: IntentInput): Promise<IntentLayoutResult>;
}

const KEYWORDS: Record<Exclude<TemplateId, "landing">, string[]> = {
  store: ["tienda", "vender", "vendo", "venta", "productos", "shop", "ecommerce", "catalogo", "emprendimiento"],
  "link-in-bio": ["links", "enlaces", "link en bio", "bio", "creador", "creadora", "influencer", "redes", "linktree"],
  portfolio: ["fotograf", "fotos", "portafolio", "portfolio", "disen", "ilustr", "arquitect", "artista", "obras", "trabajos"],
};
const ORDER = ["store", "link-in-bio", "portfolio"] as const;

export function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function classifyIntent(intent: string): TemplateId {
  const text = normalize(intent);
  let best: TemplateId = "landing";
  let bestScore = 0;
  for (const id of ORDER) {
    const score = KEYWORDS[id].filter((k) => text.includes(k)).length;
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

export function slugify(s: string): string {
  const slug = normalize(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  return slug || "inicio";
}

function nodeBuilder(prefix: string) {
  let i = 0;
  return (type: ElementType, props: Record<string, unknown>, extra: Partial<ElementNode> = {}): ElementNode => ({
    id: `${prefix}-${++i}`,
    type,
    props,
    ...extra,
  });
}

function buildRoot(templateId: TemplateId, name: string, intent: string, domain?: string): ElementNode[] {
  const n = nodeBuilder(templateId);
  switch (templateId) {
    case "portfolio": {
      const img = (label: string) =>
        n("Image", { src: "https://placehold.co/800x600", alt: `${label} de ${name}`, radius: 16 });
      return [
        n("ProfileHeader", { avatarUrl: "https://placehold.co/160x160", name, bio: intent, bgColor: "#111827" }),
        n("Heading", { text: "Mis trabajos", level: "h2", align: "center" }),
        n("Columns", { count: 2, gap: 16 }, { columnSlots: [[img("Trabajo destacado")], [img("Otro trabajo")]] }),
        n("Paragraph", { text: "Disponible para encargos y colaboraciones. Escribime y conversemos." }),
        n("Button", { label: "Contacto", href: "#contacto", style: "primary" }),
      ];
    }
    case "store":
      return [
        n("Hero", { title: name, subtitle: intent, bgColor: "#111827" }),
        n("Heading", { text: "Productos destacados", level: "h2", align: "left" }),
        n("ProductGrid", { source: "medusa", columns: 3, limit: 6 }),
        n("Button", { label: "Ver toda la tienda", href: "/tienda", style: "secondary" }),
      ];
    case "link-in-bio":
      return [
        n("ProfileHeader", { avatarUrl: "https://placehold.co/160x160", name, bio: intent, bgColor: "#111827" }),
        n("LinkList", {
          title: "Mis enlaces",
          links: [
            { label: "Mi sitio", url: domain ? `https://${domain}` : "https://", icon: "link", enabled: true },
            { label: "Mi Instagram", url: "https://instagram.com/", icon: "instagram", enabled: true },
          ],
          buttonStyle: "solid",
        }),
        n("SocialIcons", {
          links: [
            { platform: "instagram", url: "https://instagram.com/" },
            { platform: "tiktok", url: "https://tiktok.com/@" },
          ],
          align: "center",
        }),
      ];
    case "landing":
    default:
      return [
        n("Hero", { title: name, subtitle: intent, bgColor: "#111827" }),
        n("Paragraph", { text: intent }),
        n("Button", { label: "Contactanos", href: "#contacto", style: "primary" }),
      ];
  }
}

export class TemplateIntentToLayout implements IntentToLayout {
  async generate(input: IntentInput): Promise<IntentLayoutResult> {
    const name = input.siteName.trim().slice(0, 80);
    const intent = input.siteIntent.trim().slice(0, 280);
    const templateId = classifyIntent(input.siteIntent);
    return {
      templateId,
      layout: {
        version: "0.1",
        // Mismo principio que la tool create_page: todo lo generado nace como borrador.
        slug: `${slugify(name)}-draft`,
        title: name,
        description: intent.slice(0, 160),
        root: buildRoot(templateId, name, intent, input.siteDomain),
      },
    };
  }
}
