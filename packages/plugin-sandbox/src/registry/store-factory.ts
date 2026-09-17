// Factory del registro dinamico de plugins -- cierra el hueco que
// ROADMAP.md y PERMISSIONS_CENTER.md dejaron documentado desde el PR #21:
// "conectar functions/admin/permissions/index.js a este registro real en
// vez del catalogo hardcodeado (hello-plugin, commerce-plugin) que sigue
// usando hoy".
//
// v0.0.9.10: conecta functions/admin/permissions/index.js al registro
// (InMemoryPluginRegistryStore, seedeado). v0.0.9.11: agrega persistencia
// real (D1PluginRegistryStore / SqlitePluginRegistryStore), mismo patron
// exacto que packages/permissions/src/store-factory.ts -- env.DB primero
// (Cloudflare D1), despues env.PORTALESS_SQLITE_PATH (self-hosted,
// node:sqlite), cayendo a InMemoryPluginRegistryStore solo si ninguno de
// los dos esta disponible. El seed de hello-plugin/commerce-plugin sigue
// aplicandose siempre que el store este vacio, sin importar el backend,
// para no perder el catalogo minimo funcional en un despliegue nuevo.

import {
  InMemoryPluginRegistryStore,
  type PluginRegistryStore,
} from "./plugin-registry";

export interface PluginRegistryStoreFactoryEnv {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
}

let cachedStore: PluginRegistryStore | null = null;

async function seedKnownPluginsIfEmpty(store: PluginRegistryStore): Promise<void> {
  const existing = await store.list(false);
  if (existing.length > 0) return;

  const nowIso = new Date().toISOString();

  await store.register({
    pluginId: "hello-plugin",
    displayName: "Hello Plugin (demo)",
    author: "Portaless",
    sourceType: "open",
    requestedCapabilities: ["network:fetch"],
    registeredAt: nowIso,
    installedAt: nowIso,
    active: true,
  });

  await store.register({
    pluginId: "commerce-plugin",
    displayName: "Commerce Plugin (Medusa/Mercur)",
    author: "Portaless",
    sourceType: "open",
    requestedCapabilities: ["network:fetch"],
    registeredAt: nowIso,
    installedAt: nowIso,
    active: true,
  });
}

export async function createPluginRegistryStore(
  env: PluginRegistryStoreFactoryEnv = {},
): Promise<PluginRegistryStore> {
  if (env.DB) {
    const { D1PluginRegistryStore } = await import("./stores/d1-plugin-registry-store");
    const store = new D1PluginRegistryStore(env.DB as any);
    await seedKnownPluginsIfEmpty(store);
    return store;
  }

  if (env.PORTALESS_SQLITE_PATH) {
    try {
      const { SqlitePluginRegistryStore } = await import("./stores/sqlite-plugin-registry-store");
      const store = new SqlitePluginRegistryStore(env.PORTALESS_SQLITE_PATH);
      await seedKnownPluginsIfEmpty(store);
      return store;
    } catch (err) {
      console.warn(
        `[Portaless PluginRegistry] SQLite no disponible (${(err as Error).message}). Usando memoria.`,
      );
    }
  } else {
    console.warn("[Portaless PluginRegistry] Sin DB ni PORTALESS_SQLITE_PATH. Usando memoria.");
  }

  if (!cachedStore) {
    cachedStore = new InMemoryPluginRegistryStore();
    await seedKnownPluginsIfEmpty(cachedStore);
  }
  return cachedStore;
}
