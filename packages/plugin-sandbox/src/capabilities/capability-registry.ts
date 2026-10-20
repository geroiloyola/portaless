// Catalogo maestro de capacidades atomicas. La fuente de verdad compartida
// entre el sandbox de plugins y el Centro de Permisos del dashboard
// (packages/permissions). Se puede agrupar de dos maneras:
//   - por CATEGORIA (Contenido, Red, ...), como agrupa iOS/Android; y
//   - por RIESGO (alto/medio/bajo), que es como el Centro de Permisos ordena
//     hoy: primero lo peligroso, y la categoria queda como etiqueta.
// El riesgo ya existia como dato decorativo; ahora tambien es la estructura.

import type { CapabilityId } from "../types";

export type CapabilityRisk = "bajo" | "medio" | "alto";

export interface CapabilityDefinition {
  id: CapabilityId;
  category: "Contenido" | "Red" | "Comercio" | "Almacenamiento" | "Agentes IA" | "Administración" | "Cobros";
  label: string;
  description: string;
  risk: CapabilityRisk;
}

// De mas peligroso a menos: el orden en que el Centro de Permisos muestra las
// secciones. Una capacidad nueva se ubica sola segun su `risk`.
export const RISK_ORDER: readonly CapabilityRisk[] = ["alto", "medio", "bajo"];

export const RISK_LABELS: Record<CapabilityRisk, string> = {
  alto: "Alto riesgo",
  medio: "Riesgo medio",
  bajo: "Riesgo bajo",
};


export const capabilityRegistry: Record<CapabilityId, CapabilityDefinition> = {
  "content:read": {
    id: "content:read", category: "Contenido",
    label: "Leer contenido del sitio",
    description: "Permite al plugin leer páginas, posts y metadatos existentes.",
    risk: "bajo",
  },
  "content:write": {
    id: "content:write", category: "Contenido",
    label: "Editar o crear contenido",
    description: "Permite crear o modificar páginas y posts.",
    risk: "medio",
  },
  "media:read": {
    id: "media:read", category: "Contenido",
    label: "Leer biblioteca de medios",
    description: "Permite acceder a imágenes y archivos subidos al sitio.",
    risk: "bajo",
  },
  "media:write": {
    id: "media:write", category: "Contenido",
    label: "Subir o modificar medios",
    description: "Permite agregar o reemplazar imágenes/archivos.",
    risk: "medio",
  },
  "network:fetch": {
    id: "network:fetch", category: "Red",
    label: "Conectarse a servicios externos",
    description: "Permite hacer peticiones de red, únicamente a los hosts explícitamente autorizados.",
    risk: "alto",
  },
  "email:send": {
    id: "email:send", category: "Red",
    label: "Enviar correos en nombre del sitio",
    description: "Permite disparar envíos de email transaccional.",
    risk: "medio",
  },
  "commerce:read": {
    id: "commerce:read", category: "Comercio",
    label: "Leer catálogo/pedidos",
    description: "Permite consultar productos, precios y pedidos vía Medusa/Mercur.",
    risk: "medio",
  },
  "commerce:checkout": {
    id: "commerce:checkout", category: "Comercio",
    label: "Iniciar procesos de cobro",
    description: "Permite iniciar un flujo de checkout (nunca procesa el pago directamente).",
    risk: "alto",
  },
  "storage:read": {
    id: "storage:read", category: "Almacenamiento",
    label: "Leer almacenamiento del plugin",
    description: "Acceso de lectura únicamente al espacio de almacenamiento propio del plugin.",
    risk: "bajo",
  },
  "storage:write": {
    id: "storage:write", category: "Almacenamiento",
    label: "Escribir en almacenamiento del plugin",
    description: "Acceso de escritura únicamente al espacio de almacenamiento propio del plugin.",
    risk: "medio",
  },
  "agent:identify": {
    id: "agent:identify", category: "Agentes IA",
    label: "Leer identidad de agentes verificados",
    description: "Permite consultar el ledger del Trust Layer (qué agentes de IA visitaron el sitio).",
    risk: "bajo",
  },
  "site:admin": {
    id: "site:admin", category: "Administración",
    label: "Modificar configuración del sitio",
    description: "Capacidad de más alto riesgo: cambia ajustes globales del sitio.",
    risk: "alto",
  },
  // PR H: solo para subjects settlement-provider. Se concede unicamente desde
  // /admin/settlement tras verificar las credenciales del proveedor.
  "billing:pay-per-crawl": {
    id: "billing:pay-per-crawl", category: "Cobros",
    label: "Cobrar el acceso de agentes de IA (pay per crawl)",
    description: "Un proveedor externo cobra a los crawlers por cada acceso. Portaless no toca el dinero. Requiere credenciales verificadas del proveedor.",
    risk: "alto",
  },
  // APW 6.5 (ERRATA E-8): solo para subjects "reader" (DID did:apw: de un
  // lector). Un grant con esta capacidad deja pasar a ese lector en
  // GET /trust/:siteId aunque no cumpla los umbrales de reputacion; la
  // identidad APW (6.3) sigue siendo obligatoria, el bypass no la salta.
  "trust:read-governance-bypass": {
    id: "trust:read-governance-bypass", category: "Administración",
    label: "Excepción de lectura por lector (APW)",
    description: "Permite a un lector con DID verificado leer aunque no cumpla los umbrales de reputación de la política de lectura. No exime de Web Bot Auth ni de identidad APW.",
    risk: "alto",
  },
  "content:publish": {
    id: "content:publish", category: "Contenido",
    label: "Publicar una revisión aprobada",
    description: "Permite publicar una revisión exacta después de la aprobación de un administrador.",
    risk: "alto",
  },
  "mcp:private-context:read": {
    id: "mcp:private-context:read", category: "Contenido",
    label: "Leer contexto privado por MCP",
    description: "Permite al agente leer documentos privados identificados explícitamente y autorizados.",
    risk: "alto",
  },
};

export const MCP_ONLY_CAPABILITIES = new Set<CapabilityId>([
  "content:publish",
  "mcp:private-context:read",
]);

export function listCapabilitiesByCategory(): Record<string, CapabilityDefinition[]> {
  const grouped: Record<string, CapabilityDefinition[]> = {};
  for (const def of Object.values(capabilityRegistry)) {
    grouped[def.category] = grouped[def.category] ?? [];
    grouped[def.category].push(def);
  }
  return grouped;
}

/**
 * Agrupa por riesgo, de mas peligroso a menos (RISK_ORDER). Las tres claves
 * existen siempre, aunque una quede vacia: el Centro de Permisos itera
 * RISK_ORDER, no las claves del objeto, para que el orden no dependa del
 * orden de insercion ni de como JavaScript ordena las claves.
 */
export function listCapabilitiesByRisk(): Record<CapabilityRisk, CapabilityDefinition[]> {
  const grouped = { alto: [], medio: [], bajo: [] } as Record<CapabilityRisk, CapabilityDefinition[]>;
  for (const def of Object.values(capabilityRegistry)) grouped[def.risk].push(def);
  return grouped;
}
