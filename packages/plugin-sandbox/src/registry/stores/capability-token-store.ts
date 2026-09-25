// Store para tokens efimeros del Capability Bridge HTTP (functions/api/
// internal/capability-bridge.js). Reemplaza el secreto estatico
// PORTALESS_INTERNAL_BRIDGE_TOKEN -- ver hallazgo de seguridad en
// ROADMAP.md ("Refactorizar capability-bridge.js para tokens efimeros").
//
// DISEÑO -- token por EJECUCION de sandbox (no por invocacion individual
// de capacidad). Un plugin tipico hace varias llamadas al bridge durante
// una misma ejecucion (ej. content:read seguido de content:write); exigir
// un token nuevo por cada una obligaria a rediseñar el contrato
// bridgeUrl/bridgeToken que ya consumen los adaptadores edge. En su lugar:
//   - El token se emite UNA vez, antes de construir el bootstrap que se
//     sube al proveedor (Deno Deploy / Cloudflare Workers for Platforms).
//   - TTL corto (5 minutos) -- cubre holgadamente el tiempo de ejecucion
//     tipico de un Worker/Deployment (milisegundos-segundos), y acota la
//     ventana de un eventual replay si el token se filtrara.
//   - Snapshot de capacidades: se guarda que capacidades tenia concedidas
//     el plugin AL MOMENTO de emitir el token, en vez de volver a
//     consultar PermissionStore en cada llamada al bridge. Esto es
//     deliberado, no una optimizacion accidental: si un admin revoca un
//     permiso a mitad de una ejecucion ya en curso, esa ejecucion
//     concluye con el estado de permisos que tenia al arrancar -- ese es
//     el comportamiento correcto para no dejar una ejecucion a medio
//     camino en un estado de permisos inconsistente.
//   - Scopeado a un pluginName especifico -- el token de un plugin nunca
//     sirve para otro.
//
// El nombre del token en si (el string "pless_xxx") lo sigue generando el
// caller (ver adapters/*.ts) -- este store solo lo registra, lo valida y
// lo expira. Separar "generar el string" de "registrarlo como valido" es
// lo que convierte un secreto arbitrario en un token real verificable.

import type { CapabilityId } from "../../types";

export interface IssuedCapabilityToken {
  token: string;
  pluginName: string;
  grantedCapabilities: CapabilityId[];
  issuedAt: string;
  expiresAt: string;
}

export interface CapabilityTokenValidation {
  valid: boolean;
  pluginName?: string;
  grantedCapabilities?: CapabilityId[];
  reason?: "not_found" | "expired";
}

export interface CapabilityTokenStore {
  /**
   * Registra un token ya generado por el caller, junto con el snapshot
   * de capacidades concedidas al plugin en este momento. `ttlSeconds`
   * default 300 (5 minutos) -- ver nota de diseño arriba.
   */
  issue(
    token: string,
    pluginName: string,
    grantedCapabilities: CapabilityId[],
    ttlSeconds?: number
  ): Promise<IssuedCapabilityToken>;

  /**
   * Valida un token recibido por el bridge HTTP. No es "consumir" en el
   * sentido de invalidar tras el primer uso -- un mismo token puede
   * respaldar varias llamadas al bridge dentro de su TTL (ver nota de
   * diseño). Solo verifica existencia + no vencido.
   */
  validate(token: string): Promise<CapabilityTokenValidation>;

  /** Borra tokens vencidos. Ver gcIfDue() para la politica de cuando llamarlo. */
  deleteExpired(nowIso: string): Promise<number>;
}

// GC probabilistica: en vez de un cron aparte (mas infraestructura a
// mantener), cada issue() tiene una probabilidad baja de disparar una
// limpieza de tokens vencidos primero. Con trafico sostenido esto
// mantiene la tabla acotada sin necesitar un job programado. Para
// self-host sin trafico constante, un cron real (o `npm run gc` manual)
// sigue siendo una mejora futura razonable -- no bloqueante para cerrar
// el hallazgo de seguridad original.
const GC_PROBABILITY = 0.1;

function maybeGc(store: CapabilityTokenStore): void {
  if (Math.random() < GC_PROBABILITY) {
    void store.deleteExpired(new Date().toISOString()).catch(() => {
      // La GC es best-effort -- un fallo aqui nunca debe impedir emitir
      // el token real que se esta solicitando.
    });
  }
}

interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      run(): Promise<unknown>;
      first(): Promise<Record<string, unknown> | null>;
      all(): Promise<{ results: Record<string, unknown>[] }>;
    };
  };
}

export class D1CapabilityTokenStore implements CapabilityTokenStore {
  constructor(private db: D1Like) {}

  async issue(
    token: string,
    pluginName: string,
    grantedCapabilities: CapabilityId[],
    ttlSeconds = 300
  ): Promise<IssuedCapabilityToken> {
    maybeGc(this);

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);

    await this.db
      .prepare(
        `INSERT INTO capability_bridge_tokens
           (token, plugin_name, granted_capabilities_json, issued_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(token, pluginName, JSON.stringify(grantedCapabilities), issuedAt.toISOString(), expiresAt.toISOString())
      .run();

    return {
      token,
      pluginName,
      grantedCapabilities,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async validate(token: string): Promise<CapabilityTokenValidation> {
    const row = await this.db
      .prepare(
        `SELECT plugin_name, granted_capabilities_json, expires_at
         FROM capability_bridge_tokens WHERE token = ?`
      )
      .bind(token)
      .first();

    if (!row) {
      return { valid: false, reason: "not_found" };
    }

    const expiresAt = row.expires_at as string;
    if (new Date(expiresAt).getTime() < Date.now()) {
      return { valid: false, reason: "expired" };
    }

    return {
      valid: true,
      pluginName: row.plugin_name as string,
      grantedCapabilities: JSON.parse(row.granted_capabilities_json as string) as CapabilityId[],
    };
  }

  async deleteExpired(nowIso: string): Promise<number> {
    const result = await this.db
      .prepare(`DELETE FROM capability_bridge_tokens WHERE expires_at < ?`)
      .bind(nowIso)
      .run();
    return (result as { meta?: { changes?: number } })?.meta?.changes ?? 0;
  }
}

interface SqliteLike {
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number };
    get(...args: unknown[]): Record<string, unknown> | undefined;
  };
}

export class SqliteCapabilityTokenStore implements CapabilityTokenStore {
  constructor(private db: SqliteLike) {}

  async issue(
    token: string,
    pluginName: string,
    grantedCapabilities: CapabilityId[],
    ttlSeconds = 300
  ): Promise<IssuedCapabilityToken> {
    maybeGc(this);

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);

    this.db
      .prepare(
        `INSERT INTO capability_bridge_tokens
           (token, plugin_name, granted_capabilities_json, issued_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(token, pluginName, JSON.stringify(grantedCapabilities), issuedAt.toISOString(), expiresAt.toISOString());

    return {
      token,
      pluginName,
      grantedCapabilities,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async validate(token: string): Promise<CapabilityTokenValidation> {
    const row = this.db
      .prepare(
        `SELECT plugin_name, granted_capabilities_json, expires_at
         FROM capability_bridge_tokens WHERE token = ?`
      )
      .get(token);

    if (!row) {
      return { valid: false, reason: "not_found" };
    }

    const expiresAt = row.expires_at as string;
    if (new Date(expiresAt).getTime() < Date.now()) {
      return { valid: false, reason: "expired" };
    }

    return {
      valid: true,
      pluginName: row.plugin_name as string,
      grantedCapabilities: JSON.parse(row.granted_capabilities_json as string) as CapabilityId[],
    };
  }

  async deleteExpired(nowIso: string): Promise<number> {
    const result = this.db.prepare(`DELETE FROM capability_bridge_tokens WHERE expires_at < ?`).run(nowIso);
    return result.changes;
  }
}

/**
 * In-memory fallback -- usado unicamente si ni D1 (env.DB) ni SQLite
 * (env.PORTALESS_SQLITE_PATH) estan configurados. Mismo principio que
 * el fallback documentado en usage-log-endpoint.js: nunca falla en
 * silencio, pero los tokens no sobreviven un restart del proceso.
 */
export class InMemoryCapabilityTokenStore implements CapabilityTokenStore {
  private tokens = new Map<string, IssuedCapabilityToken>();

  async issue(
    token: string,
    pluginName: string,
    grantedCapabilities: CapabilityId[],
    ttlSeconds = 300
  ): Promise<IssuedCapabilityToken> {
    maybeGc(this);

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);
    const entry: IssuedCapabilityToken = {
      token,
      pluginName,
      grantedCapabilities,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    this.tokens.set(token, entry);
    return entry;
  }

  async validate(token: string): Promise<CapabilityTokenValidation> {
    const entry = this.tokens.get(token);
    if (!entry) return { valid: false, reason: "not_found" };
    if (new Date(entry.expiresAt).getTime() < Date.now()) {
      this.tokens.delete(token);
      return { valid: false, reason: "expired" };
    }
    return { valid: true, pluginName: entry.pluginName, grantedCapabilities: entry.grantedCapabilities };
  }

  async deleteExpired(nowIso: string): Promise<number> {
    const cutoff = new Date(nowIso).getTime();
    let deleted = 0;
    for (const [token, entry] of this.tokens.entries()) {
      if (new Date(entry.expiresAt).getTime() < cutoff) {
        this.tokens.delete(token);
        deleted += 1;
      }
    }
    return deleted;
  }
}
