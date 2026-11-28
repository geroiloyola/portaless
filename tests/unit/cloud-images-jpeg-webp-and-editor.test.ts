import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { applySchema } from "../../scripts/setup.mjs";
import { generateApwDid } from "@verared/apw/did-apw";
import { createSiteIdentityStore } from "@portaless/trust-storage-adapters";
import { encodeBase64, sha256Hash, MAX_IMAGE_BYTES, PNG_SIGNATURE, crc32 } from "@verared/cloud-images";
import { detectImageContentType } from "../../functions/_shared/image-sniff.js";
import { SECURITY_HEADERS } from "../../functions/_shared/security-headers.js";
import * as adminCloudImages from "../../functions/admin/api/cloud-images.js";
import * as publicImages from "../../functions/images/[imageId].js";
import * as trustImages from "../../functions/trust/images/[imageId].js";
import {
  renderPropertyPanel,
  createDefaultImageUploader,
} from "../../packages/visual-elements/src/editor/property-panel";

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function minimalPng(): Uint8Array {
  const parts = [
    PNG_SIGNATURE,
    chunk("IHDR", Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
    chunk("IDAT", Uint8Array.from([9, 8, 7])),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function minimalJpeg(): Uint8Array {
  // SOI (FF D8) + APP0 (FF E0) + EOI (FF D9)
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

function minimalWebp(): Uint8Array {
  // RIFF <size> WEBP VP8  <chunk>
  return Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x14, 0x00, 0x00, 0x00, // size
    0x57, 0x45, 0x42, 0x50, // WEBP
    0x56, 0x50, 0x38, 0x20, // VP8
    0x08, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
}

describe("detectImageContentType (magic bytes)", () => {
  it("accepts valid PNG, JPEG, and WebP magic bytes", () => {
    expect(detectImageContentType(minimalPng())).toBe("image/png");
    expect(detectImageContentType(minimalJpeg())).toBe("image/jpeg");
    expect(detectImageContentType(minimalWebp())).toBe("image/webp");
  });

  it("rejects SVG, HTML, text, truncated RIFF, and corrupt headers", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const html = new TextEncoder().encode("<!DOCTYPE html><html><script>alert(1)</script></html>");
    const txt = new TextEncoder().encode("not an image");
    const riffNotWebp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]); // WAVE
    const shortJpeg = Uint8Array.from([0xff, 0xd8]);

    expect(detectImageContentType(svg)).toBeNull();
    expect(detectImageContentType(html)).toBeNull();
    expect(detectImageContentType(txt)).toBeNull();
    expect(detectImageContentType(riffNotWebp)).toBeNull();
    expect(detectImageContentType(shortJpeg)).toBeNull();
    expect(detectImageContentType(new Uint8Array(0))).toBeNull();
  });
});

describe("cloud-images endpoints: PNG, JPEG, WebP + security", () => {
  const tmp = mkdtempSync(join(tmpdir(), "portaless-cloud-img-multi-"));
  const dbPath = join(tmp, "portaless.db");
  const envKey = randomBytes(32).toString("base64");
  const admin = { username: "admin-1", role: "admin" };
  let env: Record<string, unknown>;

  function ctx(opts: { body?: unknown; method?: string; params?: Record<string, string>; user?: unknown } = {}) {
    const request = new Request("http://x.test/admin/api/cloud-images", {
      method: opts.method ?? "POST",
      headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    return {
      request,
      env,
      params: opts.params ?? {},
      data: opts.user !== undefined ? (opts.user ? { user: opts.user } : {}) : { user: admin },
      next: async () => new Response("static"),
    } as any;
  }

  beforeAll(async () => {
    await applySchema(dbPath, { quiet: true });
    env = { PORTALESS_SQLITE_PATH: dbPath, PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: envKey };
    const keyPair = await generateApwDid("ejemplo.com");
    const identityStore = await createSiteIdentityStore(env);
    await identityStore.create("default", keyPair, "test");
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("rejects SVG, HTML disguised as image/jpeg, and >4MiB with 415/413", async () => {
    const svg = new TextEncoder().encode("<svg><script>alert(1)</script></svg>");
    const resSvg = await adminCloudImages.onRequestPost(
      ctx({ body: { imageBase64: encodeBase64(svg), declaredOrigin: "human", contentType: "image/svg+xml" } })
    );
    expect(resSvg.status).toBe(415);
    expect((await resSvg.json()).error).toBe("unsupported_content_type");

    const htmlDisguised = new TextEncoder().encode("<html><body>fake jpeg</body></html>");
    const resHtml = await adminCloudImages.onRequestPost(
      ctx({ body: { imageBase64: encodeBase64(htmlDisguised), declaredOrigin: "ai", contentType: "image/jpeg" } })
    );
    expect(resHtml.status).toBe(415);
    expect((await resHtml.json()).error).toBe("unsupported_content_type");

    const spoofedMime = await adminCloudImages.onRequestPost(
      ctx({ body: { imageBase64: encodeBase64(minimalPng()), declaredOrigin: "human", contentType: "image/jpeg" } })
    );
    expect(spoofedMime.status).toBe(415);

    const tooBig = await adminCloudImages.onRequestPost(
      ctx({ body: { imageBase64: encodeBase64(new Uint8Array(MAX_IMAGE_BYTES + 1)), declaredOrigin: "human" } })
    );
    expect(tooBig.status).toBe(413);
    expect((await tooBig.json()).error).toBe("image_too_large");
  });

  it("uploads, serves with nosniff, and verifies provenance for JPEG and WebP without corrupting bytes", async () => {
    const jpeg = minimalJpeg();
    const resJpeg = await adminCloudImages.onRequestPost(
      ctx({ body: { imageBase64: encodeBase64(jpeg), declaredOrigin: "human", contentType: "image/jpeg" } })
    );
    expect(resJpeg.status).toBe(201);
    const jpegBody = await resJpeg.json();
    expect(jpegBody.image.contentType).toBe("image/jpeg");
    expect(jpegBody.image.declaredOrigin).toBe("human");
    expect(jpegBody.image.contentHash).toBe(await sha256Hash(jpeg));

    const servedJpeg = await publicImages.onRequestGet(ctx({ method: "GET", params: { imageId: jpegBody.image.imageId } }));
    expect(servedJpeg.status).toBe(200);
    expect(servedJpeg.headers.get("content-type")).toBe("image/jpeg");
    expect(servedJpeg.headers.get("x-content-type-options")).toBe("nosniff");
    expect(servedJpeg.headers.get("content-security-policy")).toBe(SECURITY_HEADERS["content-security-policy"]);
    expect(new Uint8Array(await servedJpeg.arrayBuffer())).toEqual(jpeg);

    const verifiedJpeg = await trustImages.onRequestGet(ctx({ method: "GET", params: { imageId: jpegBody.image.imageId } }));
    expect(verifiedJpeg.status).toBe(200);
    const verifiedJpegJson = await verifiedJpeg.json();
    expect(verifiedJpegJson.verification.valid).toBe(true);
    expect(verifiedJpegJson.verification.signature.valid).toBe(true);
    expect(verifiedJpegJson.verification.contentHash.status).toBe("match");
    expect(verifiedJpegJson.verification.embedded.status).toBe("not_applicable");

    const webp = minimalWebp();
    const resWebp = await adminCloudImages.onRequestPost(
      ctx({ body: { imageBase64: encodeBase64(webp), declaredOrigin: "mixed", contentType: "image/webp" } })
    );
    expect(resWebp.status).toBe(201);
    const webpBody = await resWebp.json();
    expect(webpBody.image.contentType).toBe("image/webp");
    expect(webpBody.image.declaredOrigin).toBe("mixed");

    const servedWebp = await publicImages.onRequestGet(ctx({ method: "GET", params: { imageId: webpBody.image.imageId } }));
    expect(servedWebp.status).toBe(200);
    expect(servedWebp.headers.get("content-type")).toBe("image/webp");
    expect(servedWebp.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await servedWebp.arrayBuffer())).toEqual(webp);
  });
});

// Lightweight DOM stub (repo does not include jsdom) to exercise renderPropertyPanel directly.
function installMinimalDom() {
  const prevDoc = (globalThis as any).document;

  class MockElement {
    tagName: string;
    className = "";
    textContent = "";
    value = "";
    type = "";
    accept = "";
    disabled = false;
    selected = false;
    files: any[] | null = null;
    attributes: Record<string, string> = {};
    children: MockElement[] = [];
    listeners: Record<string, Array<(e?: any) => any>> = {};
    private _innerHTML = "";

    constructor(tagName: string) {
      this.tagName = tagName.toUpperCase();
    }
    set innerHTML(val: string) {
      this._innerHTML = val;
    }
    get innerHTML() {
      return this._innerHTML;
    }
    setAttribute(k: string, v: string) {
      this.attributes[k] = String(v);
    }
    getAttribute(k: string) {
      return this.attributes[k] ?? null;
    }
    removeAttribute(k: string) {
      delete this.attributes[k];
    }
    appendChild(child: MockElement) {
      this.children.push(child);
      return child;
    }
    addEventListener(evt: string, fn: (e?: any) => any) {
      (this.listeners[evt] ||= []).push(fn);
    }
    async dispatchEvent(evt: string) {
      for (const fn of this.listeners[evt] || []) {
        await fn({ target: this });
      }
    }
    click() {
      return this.dispatchEvent("click");
    }
    find(pred: (el: MockElement) => boolean): MockElement | null {
      if (pred(this)) return this;
      for (const c of this.children) {
        const hit = c.find(pred);
        if (hit) return hit;
      }
      return null;
    }
  }

  (globalThis as any).document = {
    createElement: (tag: string) => new MockElement(tag),
    createTextNode: (text: string) => {
      const el = new MockElement("#text");
      el.textContent = text;
      return el;
    },
  };

  return () => {
    (globalThis as any).document = prevDoc;
  };
}

describe("Image block upload control in /admin/editor property-panel", () => {
  it("renders upload control only on Image block, uploads JPEG, updates src, and handles 415/501 cleanly", async () => {
    const restoreDom = installMinimalDom();
    try {
      const paragraphPanel = renderPropertyPanel(
        { id: "p1", type: "Paragraph", props: { text: "hola" } },
        () => {}
      ) as any;
      expect(paragraphPanel.find((el: any) => "data-image-upload-btn" in el.attributes)).toBeNull();

      let latestProps: Record<string, unknown> | null = null;
      let capturedPayload: unknown = null;

      const imagePanel = renderPropertyPanel(
        { id: "img1", type: "Image", props: { src: "https://placehold.co/800x400", alt: "alt", radius: 16 } },
        (next) => {
          latestProps = next;
        },
        undefined,
        {
          uploadImage: async (payload) => {
            capturedPayload = payload;
            return { ok: true, url: "/images/img-123" };
          },
        }
      ) as any;

      const urlInput = imagePanel.find((el: any) => el.tagName === "INPUT" && el.type === "url");
      const uploadBtn = imagePanel.find((el: any) => "data-image-upload-btn" in el.attributes);
      const originSelect = imagePanel.find((el: any) => "data-image-origin-select" in el.attributes);
      const fileInput = imagePanel.find((el: any) => "data-image-file-input" in el.attributes);
      const statusEl = imagePanel.find((el: any) => "data-image-upload-status" in el.attributes);

      expect(urlInput).not.toBeNull();
      expect(uploadBtn).not.toBeNull();
      expect(originSelect).not.toBeNull();
      expect(fileInput).not.toBeNull();
      expect(fileInput.accept).toBe("image/png,image/jpeg,image/webp");

      // Client-side pre-validation rejects SVG without calling uploadImage
      fileInput.files = [{ type: "image/svg+xml", size: 120, arrayBuffer: async () => new ArrayBuffer(120) }];
      await fileInput.dispatchEvent("change");
      expect(capturedPayload).toBeNull();
      expect(statusEl.getAttribute("data-status-kind")).toBe("error");

      // Client-side pre-validation rejects > 4 MiB without calling uploadImage
      fileInput.files = [{ type: "image/jpeg", size: MAX_IMAGE_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(10) }];
      await fileInput.dispatchEvent("change");
      expect(capturedPayload).toBeNull();
      expect(statusEl.getAttribute("data-status-kind")).toBe("error");

      // Valid JPEG upload updates src + triggers onChange
      const jpeg = minimalJpeg();
      originSelect.value = "ai";
      fileInput.files = [{ type: "image/jpeg", size: jpeg.length, arrayBuffer: async () => jpeg.buffer.slice(0) }];
      await fileInput.dispatchEvent("change");

      expect(capturedPayload).toEqual({
        imageBase64: encodeBase64(jpeg),
        declaredOrigin: "ai",
        contentType: "image/jpeg",
      });
      expect(urlInput.value).toBe("/images/img-123");
      expect((latestProps as any)?.src).toBe("/images/img-123");
      expect(statusEl.getAttribute("data-status-kind")).toBe("ok");

      // Handles 501 / 415 errors without throwing and leaves URL input intact
      const errPanel = renderPropertyPanel(
        { id: "img2", type: "Image", props: { src: "https://existing.test/a.jpg", alt: "alt", radius: 8 } },
        () => {},
        undefined,
        {
          uploadImage: async () => ({
            ok: false,
            status: 501,
            error: "not_implemented",
            message: "La subida directa no está disponible en este entorno (puedes pegar una URL arriba).",
          }),
        }
      ) as any;
      const errFileInput = errPanel.find((el: any) => "data-image-file-input" in el.attributes);
      const errStatus = errPanel.find((el: any) => "data-image-upload-status" in el.attributes);
      const errUrlInput = errPanel.find((el: any) => el.tagName === "INPUT" && el.type === "url");
      errFileInput.files = [{ type: "image/webp", size: 28, arrayBuffer: async () => minimalWebp().buffer.slice(0) }];
      await errFileInput.dispatchEvent("change");
      expect(errStatus.getAttribute("data-status-kind")).toBe("error");
      expect(errStatus.textContent).toContain("no está disponible");
      expect(errUrlInput.value).toBe("https://existing.test/a.jpg");
    } finally {
      restoreDom();
    }
  });

  it("createDefaultImageUploader respects basePath and maps 415/501 responses", async () => {
    const prevFetch = globalThis.fetch;
    try {
      let calledUrl = "";
      let calledInit: RequestInit | undefined;
      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        calledUrl = url;
        calledInit = init;
        return new Response(JSON.stringify({ ok: true, image: { imageId: "img-999" } }), { status: 201 });
      }) as typeof fetch;

      const uploader = createDefaultImageUploader("/subpath");
      const okRes = await uploader({ imageBase64: "abc", declaredOrigin: "human", contentType: "image/webp" });
      expect(calledUrl).toBe("/subpath/admin/api/cloud-images");
      expect(calledInit?.credentials).toBe("same-origin");
      expect(okRes).toEqual({ ok: true, url: "/subpath/images/img-999", deduplicated: false });

      globalThis.fetch = (async () => new Response(JSON.stringify({ error: "unsupported_content_type" }), { status: 415 })) as typeof fetch;
      const err415 = await uploader({ imageBase64: "abc", declaredOrigin: "human" });
      expect(err415.ok).toBe(false);
      if (!err415.ok) expect(err415.status).toBe(415);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});
