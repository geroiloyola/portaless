// Carga de la vista previa real de ProductGrid dentro del editor.
//
// El paquete NO sabe nada de /admin ni de sesiones: recibe un `fetcher`
// inyectado por la pagina del Dashboard (src/pages/admin/editor.astro), que
// es la que habla con /admin/api/product-preview con la sesion del admin.
//
// - Cache por combinacion columns x limit: re-renderizar el canvas no vuelve
//   a pedir productos.
// - Debounce global de 300 ms: al escribir "12" en limit no se pide "1".
//   Si llega una clave nueva mientras otra esta pendiente, la pendiente se
//   cancela y se borra del cache (se volvera a pedir si se revisita).
// - Sin DOM: testeable con Vitest y timers falsos.

export interface ProductPreviewQuery {
  columns: number;
  limit: number;
}

export type ProductPreviewFetcher = (query: ProductPreviewQuery) => Promise<string>;

export type ProductPreviewState =
  | { status: "loading" }
  | { status: "ready"; html: string }
  | { status: "error"; error: string };

export const PREVIEW_MAX_COLUMNS = 6;
export const PREVIEW_MAX_LIMIT = 24;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(n, max);
}

/** Mismos topes que el endpoint, para no pedir algo que el servidor recortaria. */
export function clampPreviewQuery(props: { columns?: unknown; limit?: unknown }): ProductPreviewQuery {
  return {
    columns: clampInt(props.columns, 1, PREVIEW_MAX_COLUMNS, 3),
    limit: clampInt(props.limit, 1, PREVIEW_MAX_LIMIT, 6),
  };
}

export function productPreviewKey(q: ProductPreviewQuery): string {
  return `${q.columns}x${q.limit}`;
}

export class ProductPreviewLoader {
  private cache = new Map<string, ProductPreviewState>();
  private pending: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(
    private fetcher: ProductPreviewFetcher,
    private onUpdate: (key: string, state: ProductPreviewState) => void,
    private debounceMs = 300
  ) {}

  get(query: ProductPreviewQuery): ProductPreviewState {
    const key = productPreviewKey(query);
    const cached = this.cache.get(key);
    if (cached) return cached;

    if (this.pending && this.pending.key !== key) {
      clearTimeout(this.pending.timer);
      this.cache.delete(this.pending.key);
    }

    const loading: ProductPreviewState = { status: "loading" };
    this.cache.set(key, loading);
    const timer = setTimeout(() => void this.load(key, query), this.debounceMs);
    this.pending = { key, timer };
    return loading;
  }

  private async load(key: string, query: ProductPreviewQuery): Promise<void> {
    if (this.pending?.key === key) this.pending = null;
    let state: ProductPreviewState;
    try {
      state = { status: "ready", html: await this.fetcher(query) };
    } catch (err) {
      state = { status: "error", error: (err as Error)?.message ?? String(err) };
    }
    this.cache.set(key, state);
    this.onUpdate(key, state);
  }
}
