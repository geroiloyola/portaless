// Catalogo de organismos disponibles para cualquier skin. Un skin NUNCA
// define un componente nuevo: solo referencia organismos de este registro
// por nombre y decide donde ubicarlos. Ver Portaless_Skin_System.md, seccion 2.
//
// ACTUALIZADO en v0.0.5: se agrega "PermissionsCenterPanel", que resume el
// estado del Centro de Permisos (packages/permissions) directamente en el
// dashboard -- cuantos permisos de alto riesgo estan concedidos, y a que
// plugins/agentes.

import type { OrganismDefinition } from "../types";

function el(tag: string, className: string, html: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.innerHTML = html;
  return node;
}

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
    return el(
      "div",
      "organism",
      `<h4>Tráfico 14 días</h4>
       <svg viewBox="0 0 260 60" width="100%" height="50" preserveAspectRatio="none">
         <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
       </svg>
       <div class="stat-delta">humanos + agentes</div>`
    );
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
    const rows = data
      .map((e) => {
        const tagStyle =
          e.status === "paid"
            ? "background:#eafaf0;color:#1e8e3e;"
            : e.status === "pending"
            ? "background:#fff4e6;color:#b56d00;"
            : "background:#ffecec;color:#d3383f;";
        const label =
          e.status === "paid" ? `Pagado $${e.amountUsd.toFixed(2)}` :
          e.status === "pending" ? "Pendiente" : "Bloqueado";
        return `<div class="row"><span>${e.keyId}</span><span class="tag" style="${tagStyle}">${label}</span></div>`;
      })
      .join("");
    return el("div", "organism", `<h4>Ledger de agentes (Trust Layer)</h4>${rows}`);
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
    const rows = data
      .map((c) => `<div class="row"><span>${c.title}</span><span style="color:var(--muted);">${c.publishedAgo}</span></div>`)
      .join("");
    return el("div", "organism", `<h4>Contenido reciente</h4>${rows}`);
  },
};

const CommerceOrdersPanel: OrganismDefinition<CommerceOrder[]> = {
  name: "CommerceOrdersPanel",
  displayName: "Pedidos de la tienda",
  mockData: [{ id: "o1", total: 45 }, { id: "o2", total: 60 }],
  render(data) {
    return el(
      "div",
      "organism",
      `<h4>Pedidos de la tienda</h4>
       <div class="stat-value">${data.length}</div>
       <div class="stat-delta">vía Medusa Storefront API</div>`
    );
  },
};

const CommerceRevenuePanel: OrganismDefinition<{ totalUsd: number }> = {
  name: "CommerceRevenuePanel",
  displayName: "Ingresos",
  mockData: { totalUsd: 318 },
  render(data) {
    return el(
      "div",
      "organism",
      `<h4>Ingresos</h4>
       <div class="stat-value">$${data.totalUsd}</div>
       <div class="stat-delta">este mes</div>`
    );
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
    const rows = data
      .map((r) => {
        const style =
          r.access === "allow" ? "background:#eafaf0;color:#1e8e3e;" :
          r.access.startsWith("charge") ? "background:#fff4e6;color:#b56d00;" :
          "background:#ffecec;color:#d3383f;";
        return `<div class="row"><span>${r.signal}</span><span class="tag" style="${style}">${r.access}</span></div>`;
      })
      .join("");
    return el("div", "organism", `<h4>Política de contenido</h4>${rows}`);
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
    const rows = data
      .map((r) => {
        const color = r.risk === "alto" ? "#ff6e6e" : r.risk === "medio" ? "#ffb86b" : "#6ee7b7";
        return `<div class="row"><span>${r.subjectName} — ${r.capabilityLabel}</span>
          <span class="tag" style="background:${color}22;color:${color};">${r.risk}</span></div>`;
      })
      .join("");
    return el(
      "div",
      "organism",
      `<h4>Permisos concedidos (alto riesgo)</h4>${rows}
       <div class="stat-delta">Ver Centro de Permisos completo en /admin/permisos</div>`
    );
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
