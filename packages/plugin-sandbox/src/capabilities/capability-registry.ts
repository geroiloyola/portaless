// Catalogo maestro de capacidades atomicas, agrupadas por categoria --
// exactamente como agrupa iOS/Android sus permisos (Camara, Ubicacion,
// Contactos...) en su pantalla de Privacidad. Este registro es la fuente
// de verdad compartida entre el sandbox de plugins y el Centro de Permisos
// del dashboard (packages/permissions).

import type { CapabilityId } from "../types";

export interface CapabilityDefinition {
  id: CapabilityId;
  category: "Contenido" | "Red" | "Comercio" | "Almacenamiento" | "Agentes IA" | "Administración";
  label: string;
  description: string;
  risk: "bajo" | "medio" | "alto";
}

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
};

export function listCapabilitiesByCategory(): Record<string, CapabilityDefinition[]> {
  const grouped: Record<string, CapabilityDefinition[]> = {};
  for (const def of Object.values(capabilityRegistry)) {
    grouped[def.category] = grouped[def.category] ?? [];
    grouped[def.category].push(def);
  }
  return grouped;
}
