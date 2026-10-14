// Persistencia de theme packs. Misma superficie que ElementPackStore
// (../elements/element-pack-store.ts): list/get/save/remove sobre la tabla
// theme_packs (schema-additions/theme-packs.sql).
//
// Los packs BUILTIN no se siembran aqui: viven en themes/theme-pack.ts
// (codigo) y availableThemes() los fusiona. Esta tabla guarda SOLO los
// instalados desde fuera (marketplace, proximo slice), de modo que nunca
// hay dos fuentes de verdad para el mismo nombre.

import type { ThemePack } from "../themes/theme-pack";
import { validateThemePack } from "../themes/theme-pack";

export interface ThemePackStore {
  list(): Promise<string[]>;
  /** Devuelve null si no existe o si la fila guardada ya no valida. */
  get(name: string): Promise<ThemePack | null>;
  /** Lanza si el pack no valida (nada invalido entra a la tabla). */
  save(pack: ThemePack): Promise<void>;
  remove(name: string): Promise<boolean>;
}

export class InMemoryThemePackStore implements ThemePackStore {
  private readonly packs = new Map<string, ThemePack>();

  async list(): Promise<string[]> {
    return [...this.packs.keys()];
  }

  async get(name: string): Promise<ThemePack | null> {
    const pack = this.packs.get(name);
    if (!pack) return null;
    return validateThemePack(pack).valid ? pack : null;
  }

  async save(pack: ThemePack): Promise<void> {
    const result = validateThemePack(pack);
    if (!result.valid || !result.pack) {
      throw new Error("Tema invalido: " + result.errors.join("; "));
    }
    this.packs.set(result.pack.name, result.pack);
  }

  async remove(name: string): Promise<boolean> {
    return this.packs.delete(name);
  }
}

/**
 * Carga todos los packs validos de un store. Los invalidos el store ya los
 * oculta en get() (fila corrupta o guardada por una version vieja), asi que
 * aqui simplemente se filtran los null -- igual que catalogFromStore hacia
 * con los element packs.
 */
export async function loadThemePacks(store: ThemePackStore): Promise<ThemePack[]> {
  const names = await store.list();
  const packs: ThemePack[] = [];
  for (const name of names) {
    const pack = await store.get(name);
    if (pack) packs.push(pack);
  }
  return packs;
}
