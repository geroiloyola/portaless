// Interfaz de persistencia de paginas. El MVP usa localStorage (para poder
// probar el editor sin backend), pero cualquier sitio en produccion deberia
// implementar PageStore contra el propio repositorio Git del sitio (un
// archivo JSON por pagina en src/content/pages/), manteniendo el mismo
// principio de "todo es texto versionable" del resto de Portaless.

import type { PageLayout } from "../types";
import { validatePageLayout } from "./page-schema";

export interface PageStore {
  load(slug: string): Promise<PageLayout | null>;
  save(layout: PageLayout): Promise<void>;
  list(): Promise<string[]>;
}

const STORAGE_PREFIX = "portaless.atomic-elements.page.";

export class LocalStoragePageStore implements PageStore {
  async load(slug: string): Promise<PageLayout | null> {
    const raw = localStorage.getItem(STORAGE_PREFIX + slug);
    return raw ? (JSON.parse(raw) as PageLayout) : null;
  }

  async save(layout: PageLayout): Promise<void> {
    const result = validatePageLayout(layout);
    if (!result.valid) {
      throw new Error("Layout inválido: " + result.errors.join("; "));
    }
    localStorage.setItem(STORAGE_PREFIX + layout.slug, JSON.stringify(layout, null, 2));
  }

  async list(): Promise<string[]> {
    const slugs: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) slugs.push(key.slice(STORAGE_PREFIX.length));
    }
    return slugs;
  }
}
