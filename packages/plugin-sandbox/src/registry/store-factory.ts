// Factory del registro dinamico de plugins -- cierra el hueco que
// ROADMAP.md y PERMISSIONS_CENTER.md dejaron documentado desde el PR #21:
// "conectar functions/admin/permissions/index.js a este registro real en
// vez del catalogo hardcodeado (hello-plugin, commerce-plugin) que sigue
// usando hoy".
//
// Mismo patron multi-proveedor que packages/permissions/src/store-factory.ts
// y auth/store-factory.ts: una funcion createPluginRegistryStore(env) que
// hoy solo tiene un backend real (en memoria), y a la que se le pueden
// sumar D1PluginRegistryStore/SqlitePluginRegistryStore despues sin tocar
// a ningun consumidor (functions/admin/permissions/index.js,
// packages/mcp-server/src/tools/list-installed-plugins.ts).
//
// LIMITACION CONOCIDA, documentada en ROADMAP.md: InMemoryPluginRegistryStore
// no persiste entre reinicios/despliegues. El seed de abajo (hello-plugin,
// commerce-plugin) existe para que el Centro de Permisos no aparezca vacio
// mientras no exista un backend persistente real -- es el mismo catalogo
// que antes vivia hardcodeado en KNOWN_SUBJECTS dentro de
// functions/admin/permissions/index.js, movido aca para que sea el
// registro, y no el endpoint HTTP, quien sea la fuente de verdad.

import {
  InMemoryPluginRegistryStore,
  type PluginRegistryStore,
} from "./plugin-registry";

let cachedStore: PluginRegistryStore | null = null;

async function seedKnownPlugins(store: PluginRegistryStore): Promise<void> {
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

// env se acepta por simetria con los demas store-factory.ts del repo
// (permissions, auth) aunque todavia no se use -- cuando se agregue
// D1PluginRegistryStore/SqlitePluginRegistryStore, la seleccion de backend
// segun env.PORTALESS_DB_DRIVER (u equivalente) vive aca, sin que ningun
// consumidor tenga que cambiar su import.
export async function createPluginRegistryStore(
  env: Record<string, unknown> = {},
): Promise<PluginRegistryStore> {
  void env;

  if (!cachedStore) {
    const store = new InMemoryPluginRegistryStore();
    await seedKnownPlugins(store);
    cachedStore = store;
  }

  return cachedStore;
}
