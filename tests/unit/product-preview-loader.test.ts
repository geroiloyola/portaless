// v0.0.9.28 -- carga de la vista previa de ProductGrid en el editor (sin DOM).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ProductPreviewLoader,
  clampPreviewQuery,
  productPreviewKey,
} from "../../packages/atomic-elements/src/editor/product-preview-loader";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("ProductPreviewLoader", () => {
  it("espera el debounce, pide una sola vez y despues sirve del cache", async () => {
    const fetcher = vi.fn(async (q) => `<grid ${q.columns}x${q.limit}>`);
    const onUpdate = vi.fn();
    const loader = new ProductPreviewLoader(fetcher, onUpdate, 300);

    expect(loader.get({ columns: 3, limit: 6 })).toEqual({ status: "loading" });
    await vi.advanceTimersByTimeAsync(299);
    expect(fetcher).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith("3x6", { status: "ready", html: "<grid 3x6>" });

    expect(loader.get({ columns: 3, limit: 6 })).toEqual({ status: "ready", html: "<grid 3x6>" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("al tipear rapido solo pide la ultima combinacion", async () => {
    const fetcher = vi.fn(async () => "<grid>");
    const loader = new ProductPreviewLoader(fetcher, vi.fn(), 300);

    loader.get({ columns: 3, limit: 1 });
    await vi.advanceTimersByTimeAsync(100);
    loader.get({ columns: 3, limit: 12 });
    await vi.advanceTimersByTimeAsync(300);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith({ columns: 3, limit: 12 });

    loader.get({ columns: 3, limit: 1 });
    await vi.advanceTimersByTimeAsync(300);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("un error del fetcher queda como estado error con el mensaje", async () => {
    const onUpdate = vi.fn();
    const loader = new ProductPreviewLoader(async () => { throw new Error("HTTP 501"); }, onUpdate, 300);
    loader.get({ columns: 2, limit: 4 });
    await vi.advanceTimersByTimeAsync(300);
    expect(onUpdate).toHaveBeenCalledWith("2x4", { status: "error", error: "HTTP 501" });
    expect(loader.get({ columns: 2, limit: 4 })).toEqual({ status: "error", error: "HTTP 501" });
  });
});

describe("clampPreviewQuery", () => {
  it("aplica los mismos topes que el endpoint y defaults ante valores invalidos", () => {
    expect(clampPreviewQuery({ columns: 99, limit: 100000 })).toEqual({ columns: 6, limit: 24 });
    expect(clampPreviewQuery({ columns: 0, limit: "abc" })).toEqual({ columns: 3, limit: 6 });
    expect(clampPreviewQuery({ columns: 2.9, limit: 4 })).toEqual({ columns: 2, limit: 4 });
  });

  it("la clave identifica columns x limit", () => {
    expect(productPreviewKey({ columns: 2, limit: 8 })).toBe("2x8");
  });
});
