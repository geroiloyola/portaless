// Registro dinamico de plugins instalados -- v0.0.9.9. Reemplaza el
// catalogo hardcodeado (hello-plugin, commerce-plugin) que
// functions/admin/permissions/index.js usaba desde v0.0.9.2.
//
// Modelo inspirado en Shopify App Store / WooCommerce.org / Android Play
// Store: el catalogo es ABIERTO por defecto -- cualquiera puede registrar
// un plugin (sourceType: "open" o "closed", ambos permitidos), y la
// comunidad regula la confianza via un trustScore publico y transparente
// (promedio de votos 1-5, visible en el Centro de Permisos antes de
// conceder capacidades). Para plugins "closed" (codigo cerrado, tipico de
// un futuro AppPlace), auditedBy permite registrar que una entidad externa
// (ej. el propio AppPlace cuando exista) revisó el plugin -- pero esto es
// informativo, NO una certificacion de Portaless. Ver ROADMAP.md, seccion
// "AppPlace y AppLibre: proyectos aparte, asociados oficiales", para la
// advertencia completa de que ningun plugin listado esta garantizado.

import type { CapabilityRequest } from "../types";

export type PluginSourceType = "open" | "closed";

export interface PluginRegistryEntry {
  pluginId: string;
  displayName: string;
  author: string;
  sourceType: PluginSourceType;
  requestedCapabilities: CapabilityRequest[];
  registeredAt: string;
  installedAt?: string;
  active: boolean;
  trustScore: number;
  trustScoreVotes: number;
  auditedBy?: string;
}

export interface PluginTrustVote {
  pluginId: string;
  voterId: string;
  score: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  votedAt: string;
}

/**
 * Contrato que debe implementar cualquier backend de persistencia del
 * registro -- mismo principio multi-proveedor que PageStore, PermissionStore,
 * y los stores de auth (D1 en Cloudflare, SQLite self-hosted).
 */
export interface PluginRegistryStore {
  list(activeOnly?: boolean): Promise<PluginRegistryEntry[]>;
  get(pluginId: string): Promise<PluginRegistryEntry | null>;
  register(entry: Omit<PluginRegistryEntry, "trustScore" | "trustScoreVotes">): Promise<PluginRegistryEntry>;
  setActive(pluginId: string, active: boolean): Promise<void>;
  recordVote(vote: PluginTrustVote): Promise<PluginRegistryEntry>;
}

/**
 * Implementacion de referencia en memoria -- util para tests y para
 * desarrollo local sin D1/SQLite configurado. Sigue el mismo patron de
 * fallback que auth/store-factory.ts: nunca falla silenciosamente, solo
 * advierte que no persiste entre reinicios.
 */
export class InMemoryPluginRegistryStore implements PluginRegistryStore {
  private entries = new Map<string, PluginRegistryEntry>();
  private votes = new Map<string, PluginTrustVote[]>();

  async list(activeOnly = true): Promise<PluginRegistryEntry[]> {
    const all = [...this.entries.values()];
    return activeOnly ? all.filter((e) => e.active) : all;
  }

  async get(pluginId: string): Promise<PluginRegistryEntry | null> {
    return this.entries.get(pluginId) ?? null;
  }

  async register(
    entry: Omit<PluginRegistryEntry, "trustScore" | "trustScoreVotes">
  ): Promise<PluginRegistryEntry> {
    const full: PluginRegistryEntry = { ...entry, trustScore: 0, trustScoreVotes: 0 };
    this.entries.set(entry.pluginId, full);
    return full;
  }

  async setActive(pluginId: string, active: boolean): Promise<void> {
    const entry = this.entries.get(pluginId);
    if (!entry) throw new Error(`Plugin "${pluginId}" no esta registrado.`);
    entry.active = active;
  }

  async recordVote(vote: PluginTrustVote): Promise<PluginRegistryEntry> {
    const entry = this.entries.get(vote.pluginId);
    if (!entry) throw new Error(`Plugin "${vote.pluginId}" no esta registrado.`);

    const pluginVotes = this.votes.get(vote.pluginId) ?? [];
    const existingIdx = pluginVotes.findIndex((v) => v.voterId === vote.voterId);
    if (existingIdx >= 0) pluginVotes[existingIdx] = vote;
    else pluginVotes.push(vote);
    this.votes.set(vote.pluginId, pluginVotes);

    const total = pluginVotes.reduce((sum, v) => sum + v.score, 0);
    entry.trustScore = total / pluginVotes.length;
    entry.trustScoreVotes = pluginVotes.length;
    return entry;
  }
}
