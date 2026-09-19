// Catalogo de organismos disponibles para cualquier skin. Un skin NUNCA
// define un componente nuevo: solo referencia organismos de este registro
// por nombre y decide donde ubicarlos. Ver Portaless_Skin_System.md,
// seccion 2.
//
// ACTUALIZADO en v0.0.5: se agrega "PermissionsCenterPanel", que resume el
// estado del Centro de Permisos (packages/permissions) directamente en el
// dashboard -- cuantos permisos de alto riesgo estan concedidos, y a que
// plugins/agentes.
//
// ACTUALIZADO en v0.0.9.25: 2 cambios de diseño, sin alterar el
// comportamiento visual por defecto de ningun organismo:
//   1. El mapeo estado/riesgo -> color se centralizo en design-tokens.ts
//      (toneStyle/riskStyle) -- antes cada organismo hardcodeaba su propio
//      hex, con 2 paletas ligeramente distintas para el mismo concepto
//      bueno/medio/malo (PolicyPanel/AgentLedgerPanel vs
//      PermissionsCenterPanel). Ahora los 3 usan el mismo set de 3 tonos,
//      expuesto como variables CSS (--color-success-bg, etc.) para que un
//      admin pueda eventualmente elegir su propia paleta sin tocar este
//      archivo -- ver design-tokens.ts para el detalle completo.
//   2. Los valores dinamicos (nombres, labels, montos) ya no se interpolan
//      en template literals asignados via innerHTML -- pasan por los
//      helpers de safe-dom.ts (text/tag/row), que usan textContent en vez
//      de HTML. Esto cierra un vector de XSS latente: el catalogo de
//      plugins es abierto por defecto (ver ROADMAP.md, "Ecosistema de
//      plugins"), asi que un displayName de un plugin o agente de
//      terceros es exactamente el tipo de dato que no deberia tratarse
//      como HTML confiable.

import type { OrganismDefinition } from "../types";
import { riskStyle, toneStyle } from "./design-tokens";
import { el, row, tag, text } from "./safe-dom";

export interface TrafficPoint { day: number; humans: number; agents: number; }
export interface LedgerEntry { keyId: string; status: "paid" | "pending" | "blocked"; amountUsd: number; }
export interface ContentItem { title: string; publishedAgo: string; }
export interface CommerceOrder { id: string; total: number; }
export interface PolicyRow { signal: "search" | "ai_input" | "ai_train"; access: string; }
export interface PermissionSummaryRow { subjectName: string; capabilityLabel: string; risk: "bajo" | "medio" | "alto"; }

const TrafficChartPanel: OrganismDefinition<TrafficPoint[]> = {
  name: "TrafficChartPanel",
  displayName: "Tráfico (humanos vs. agentes)",
  mockData: Array.from({ length: 14 }, (_, i) => ({
    day: i,
    humans: 40 + Math.round(Math.sin(i / 2) * 10),
    agents: 10 + i * 2,
  })),
  render(data) {
    const points = data
      .map((p, i) => `${(i / (data.length - 1)) * 260},${60 - p.agents / 2}`)
      .join(" ");
    // La polyline se construye a partir de numeros calculados (no datos de
    // texto libre), y el SVG en si no acepta contenido de usuario -- se
    // mantiene como template literal, a diferencia de los organismos con
    // filas de texto abajo.
    const container = el("div", "organism");
    container.innerHTML = `<h4>Tráfico 14 días</h4>
       <svg viewBox="0 0 260 60" width="100%" height="50" preserveAspectRatio="none">
         <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
       </svg>
       <div class="stat-delta">humanos + agentes</div>`;
    return container;
  },
};

const AgentLedgerPanel: OrganismDefinition<LedgerEntry[]> = {
  name: "AgentLedgerPanel",
  displayName: "Ledger de agentes (Trust Layer)",
  mockData: [
    { keyId: "ed25519:9f2a…c31b", status: "paid", amountUsd: 12.4 },
    { keyId: "ed25519:14bd…77aa", status: "pending", amountUsd: 0 },
  ],
  render(data) {
    const container = el("div", "organism", [el("h4", "", [text("Ledger de agentes (Trust Layer)")])]);
    for (const e of data) {
      const tone = e.status === "paid" ? "success" : e.status === "pending" ? "warning" : "danger";
      const label =
        e.status === "paid" ? `Pagado $${e.amountUsd.toFixed(2)}` :
        e.status === "pending" ? "Pendiente" : "Bloqueado";
      container.appendChild(row(e.keyId, tag("tag", toneStyle(tone), label)));
    }
    return container;
  },
};

const ContentListPanel: OrganismDefinition<ContentItem[]> = {
  name: "ContentListPanel",
  displayName: "Contenido reciente",
  mockData: [
    { title: "📄 Bienvenida a Portaless", publishedAgo: "hace 2 días" },
    { title: "📄 Protocol APW explicado", publishedAgo: "hace 1 semana" },
  ],
  render(data) {
    const container = el("div", "organism", [el("h4", "", [text("Contenido reciente")])]);
    for (const c of data) {
      container.appendChild(row(c.title, tag("", "color:var(--muted);", c.publishedAgo)));
    }
    return container;
  },
};

const CommerceOrdersPanel: OrganismDefinition<CommerceOrder[]> = {
  name: "CommerceOrdersPanel",
  displayName: "Pedidos de la tienda",
  mockData: [{ id: "o1", total: 45 }, { id: "o2", total: 60 }],
  render(data) {
    return el("div", "organism", [
      el("h4", "", [text("Pedidos de la tienda")]),
      el("div", "stat-value", [text(data.length)]),
      el("div", "stat-delta", [text("vía Medusa Storefront API")]),
    ]);
  },
};

const CommerceRevenuePanel: OrganismDefinition<{ totalUsd: number }> = {
  name: "CommerceRevenuePanel",
  displayName: "Ingresos",
  mockData: { totalUsd: 318 },
  render(data) {
    return el("div", "organism", [
      el("h4", "", [text("Ingresos")]),
      el("div", "stat-value", [text(`$${data.totalUsd}`)]),
      el("div", "stat-delta", [text("este mes")]),
    ]);
  },
};

const PolicyPanel: OrganismDefinition<PolicyRow[]> = {
  name: "PolicyPanel",
  displayName: "Política de contenido",
  mockData: [
    { signal: "search", access: "allow" },
    { signal: "ai_input", access: "charge $0.002" },
    { signal: "ai_train", access: "block" },
  ],
  render(data) {
    const container = el("div", "organism", [el("h4", "", [text("Política de contenido")])]);
    for (const r of data) {
      const tone = r.access === "allow" ? "success" : r.access.startsWith("charge") ? "warning" : "danger";
      container.appendChild(row(r.signal, tag("tag", toneStyle(tone), r.access)));
    }
    return container;
  },
};

// NUEVO en v0.0.5: resumen del Centro de Permisos directamente en el dashboard.
const PermissionsCenterPanel: OrganismDefinition<PermissionSummaryRow[]> = {
  name: "PermissionsCenterPanel",
  displayName: "Permisos concedidos (alto riesgo)",
  mockData: [
    { subjectName: "🧩 plugin-comercio", capabilityLabel: "Iniciar procesos de cobro", risk: "alto" },
    { subjectName: "🤖 ed25519:9f2a…c31b", capabilityLabel: "Conectarse a servicios externos", risk: "alto" },
    { subjectName: "🧩 plugin-newsletter", capabilityLabel: "Enviar correos en nombre del sitio", risk: "medio" },
  ],
  render(data) {
    const container = el("div", "organism", [el("h4", "", [text("Permisos concedidos (alto riesgo)")])]);
    for (const r of data) {
      container.appendChild(row(`${r.subjectName} — ${r.capabilityLabel}`, tag("tag", riskStyle(r.risk), r.risk)));
    }
    container.appendChild(el("div", "stat-delta", [text("Ver Centro de Permisos completo en /admin/permisos")]));
    return container;
  },
};

export const organismRegistry: Record<string, OrganismDefinition<any>> = {
  TrafficChartPanel,
  AgentLedgerPanel,
  ContentListPanel,
  CommerceOrdersPanel,
  CommerceRevenuePanel,
  PolicyPanel,
  PermissionsCenterPanel,
};
