// Persistencia de element packs (la capa abierta del catalogo). Mismo patron
// multi-proveedor que page-store.ts: D1 (Cloudflare) -> SQLite (self-host) ->
// in-memory. La tabla guarda el pack como JSON; la validacion pura vive en
// elements/element-pack.ts y se aplica al guardar y al cargar.
//
// El seed-if-empty del pack demo vive aqui (no en el factory) para que todos
// los proveedores arranquen con el mismo catalogo de ejemplo, igual que
// plugin-registry/store-factory.ts siembra hello-plugin y commerce-plugin.

import type { ElementPack, ResolvedCatalog } from "../elements/element-pack";
import { resolveCatalog, validateElementPack } from "../elements/element-pack";
import type { ElementDefinition } from "../types";

export interface ElementPackStore {
  list(): Promise<string[]>;
  get(name: string): Promise<ElementPack | null>;
  save(pack: ElementPack): Promise<void>;
  remove(name: string): Promise<boolean>;
}

/** El pack de ejemplo que siembra todos los proveedores. Sin edge-eval. */
export function demoElementPack(): ElementPack {
  return {
    name: "demo-pack",
    version: "0.1.0",
    elements: [
      {
        type: "demo.Badge",
        displayName: "Badge demo",
        icon: "🏷️",
        defaultProps: { label: "Demo", tone: "accent" },
        editableProps: [
          { key: "label", label: "Texto", kind: "text" },
          { key: "tone", label: "Tono", kind: "select", options: ["accent", "muted", "danger"] },
        ],
        render: {
          kind: "html-template",
          template:
            '<span class="ae-demo-badge ae-demo-badge--{{tone}}">{{label}}</span>',
        },
      },
    ],
  };
}

/**
 * Carga todos los packs validos del store y los fusiona con el core en un
 * catalogo resuelto. Un pack invalido se IGNORA (no tira abajo el catalogo
 * entero) -- misma leccion que arregló validateManifest: un manifiesto malo
 * no debe tumbar la carga del registry.
 */
export async function catalogFromStore(
  store: ElementPackStore,
  coreRegistry: Record<string, ElementDefinition<Record<string, unknown>>>,
  corePalette: string[]
): Promise<ResolvedCatalog> {
  const coreTypes = Object.keys(coreRegistry);
  const names = await store.list();
  const packs: ElementPack[] = [];
  for (const name of names) {
    const pack = await store.get(name);
    if (!pack) continue;
    if (validateElementPack(pack, coreTypes).valid) packs.push(pack);
  }
  return resolveCatalog(coreRegistry, corePalette, packs);
}

export class InMemoryElementPackStore implements ElementPackStore {
  private packs = new Map<string, ElementPack>();

  constructor(seedDemo = false) {
    if (seedDemo) {
      const demo = demoElementPack();
      this.packs.set(demo.name, demo);
    }
  }

  async list(): Promise<string[]> {
    return [...this.packs.keys()];
  }

  async get(name: string): Promise<ElementPack | null> {
    return this.packs.get(name) ?? null;
  }

  async save(pack: ElementPack): Promise<void> {
    this.packs.set(pack.name, pack);
  }

  async remove(name: string): Promise<boolean> {
    return this.packs.delete(name);
  }
}
