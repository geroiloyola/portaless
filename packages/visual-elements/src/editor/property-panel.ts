// Genera el panel de propiedades automaticamente a partir de
// ElementDefinition.editableProps -- ningun elemento nuevo requiere
// escribir un formulario a mano, solo declarar sus props editables
// (ver elements/registry.ts).

import type { ElementNode } from "../types";
import { elementRegistry } from "../elements/registry";
import type { ResolvedCatalog } from "../elements/element-pack";
import { iconLabel } from "../elements/icons";

export type DeclaredImageOrigin = "human" | "ai" | "mixed";

export type ImageUploadResult =
  | { ok: true; url: string; deduplicated?: boolean }
  | { ok: false; status: number; error: string; message: string };

export type ImageUploader = (input: {
  imageBase64: string;
  declaredOrigin: DeclaredImageOrigin;
  contentType?: string;
}) => Promise<ImageUploadResult>;

export interface ImageUploadStatus {
  nodeId: string;
  kind: "ok" | "error";
  message: string;
}

export interface PropertyPanelOptions {
  uploadImage?: ImageUploader;
  basePath?: string;
  imageUploadStatus?: ImageUploadStatus | null;
  onImageUploadStatus?: (status: ImageUploadStatus | null) => void;
}

const MAX_CLIENT_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function normalizeBasePath(basePath?: string): string {
  const raw = typeof basePath === "string" && basePath.trim() ? basePath.trim() : "/";
  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function formatUploadErrorMessage(status: number, serverMessage?: string): string {
  if (status === 401 || status === 403) {
    return "Necesitas sesión y permiso de administrador para subir imágenes.";
  }
  if (status === 413) {
    return "La imagen supera el límite de 4 MiB.";
  }
  if (status === 415) {
    return "Formato no soportado: usa una imagen PNG, JPEG o WebP válida.";
  }
  if (status === 429) {
    return "Demasiadas subidas seguidas. Intenta de nuevo más tarde.";
  }
  if (status === 404 || status === 501 || status === 503) {
    return "La subida directa no está disponible en este entorno (puedes pegar una URL arriba).";
  }
  return serverMessage || `Error al subir la imagen (HTTP ${status}).`;
}

export function createDefaultImageUploader(basePath = "/"): ImageUploader {
  const base = normalizeBasePath(basePath);
  return async ({ imageBase64, declaredOrigin, contentType }) => {
    try {
      const res = await fetch(`${base}admin/api/cloud-images`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageBase64, declaredOrigin, contentType }),
      });

      let body: {
        error?: string;
        message?: string;
        deduplicated?: boolean;
        image?: { imageId?: string };
      } | null = null;
      try {
        body = (await res.json()) as typeof body;
      } catch {
        body = null;
      }

      if (!res.ok || !body?.image?.imageId) {
        return {
          ok: false,
          status: res.status,
          error: body?.error || "upload_failed",
          message: formatUploadErrorMessage(res.status, body?.message),
        };
      }

      return {
        ok: true,
        url: `${base}images/${encodeURIComponent(body.image.imageId)}`,
        deduplicated: Boolean(body.deduplicated),
      };
    } catch {
      return {
        ok: false,
        status: 0,
        error: "network_error",
        message: "No se pudo conectar con el servidor para subir la imagen (puedes pegar una URL arriba).",
      };
    }
  };
}

// v0.0.9.11: acepta un catalogo opcional (core ∪ element packs). Un nodo de
// pack no esta en elementRegistry, asi que sin catalogo el lookup daria
// `undefined` y el panel crashearia. Con catalogo, un elemento de pack se
// edita con el MISMO panel (mismo shape de editableProps).
export function renderPropertyPanel(
  node: ElementNode | null,
  onChange: (updatedProps: Record<string, unknown>) => void,
  catalog?: ResolvedCatalog,
  panelOptions?: PropertyPanelOptions
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "ae-property-panel";

  if (!node) {
    panel.innerHTML = `<p class="ae-empty">Selecciona un elemento del lienzo para editar sus propiedades.</p>`;
    return panel;
  }

  const lookup = (type: string) =>
    catalog
      ? catalog.lookup(type)
      : elementRegistry[type as keyof typeof elementRegistry]
        ? ({ kind: "core", type, definition: elementRegistry[type as keyof typeof elementRegistry] } as const)
        : null;

  const resolved = lookup(node.type);
  if (!resolved) {
    panel.innerHTML = `<p class="ae-empty">Tipo desconocido: ${node.type}</p>`;
    return panel;
  }

  const defaultProps =
    resolved.kind === "core"
      ? (resolved.definition.defaultProps as Record<string, unknown>)
      : resolved.element.defaultProps;
  const icon = resolved.kind === "core" ? resolved.definition.icon : resolved.element.icon;
  const displayName =
    resolved.kind === "core" ? resolved.definition.displayName : resolved.element.displayName;
  const editableProps =
    resolved.kind === "core" ? resolved.definition.editableProps : resolved.element.editableProps;

  const props = { ...defaultProps, ...node.props };

  const title = document.createElement("h3");
  title.appendChild(iconLabel(icon, displayName));
  panel.appendChild(title);

  for (const field of editableProps) {
    const wrapper = document.createElement("label");
    wrapper.className = "ae-field";

    const labelText = document.createElement("span");
    labelText.textContent = field.label;
    wrapper.appendChild(labelText);

    let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

    if (field.kind === "textarea") {
      input = document.createElement("textarea");
      input.value = String(props[field.key] ?? "");
    } else if (field.kind === "select") {
      input = document.createElement("select");
      (field.options ?? []).forEach((opt) => {
        const optionEl = document.createElement("option");
        optionEl.value = opt;
        // optionLabels: el desplegable muestra la palabra humana y no el valor
        // crudo. Si no hay etiqueta para ese valor, cae al valor (comportamiento
        // anterior), asi que anadir variantes no obliga a tocar los selects viejos.
        optionEl.textContent = field.optionLabels?.[opt] ?? opt;
        if (String(props[field.key]) === opt) optionEl.selected = true;
        (input as HTMLSelectElement).appendChild(optionEl);
      });
    } else {
      input = document.createElement("input");
      input.type = field.kind === "url" ? "url" : field.kind === "color" ? "color" : field.kind === "number" ? "number" : "text";
      input.value = String(props[field.key] ?? "");
    }

    input.addEventListener("input", () => {
      onChange({ ...props, [field.key]: field.kind === "number" ? Number(input.value) : input.value });
    });

    wrapper.appendChild(input);
    panel.appendChild(wrapper);

    if (node.type === "Image" && field.key === "src") {
      panel.appendChild(
        renderImageUploadControl(node.id, input as HTMLInputElement, (nextUrl) => {
          onChange({ ...props, [field.key]: nextUrl });
        }, panelOptions)
      );
    }
  }

  return panel;
}

function renderImageUploadControl(
  nodeId: string,
  urlInput: HTMLInputElement,
  onUploadedUrl: (url: string) => void,
  panelOptions?: PropertyPanelOptions
): HTMLElement {
  const box = document.createElement("div");
  box.className = "ae-image-upload";

  const originLabel = document.createElement("label");
  originLabel.className = "ae-field";
  const originText = document.createElement("span");
  originText.textContent = "Origen declarado";
  originLabel.appendChild(originText);

  const originSelect = document.createElement("select");
  originSelect.setAttribute("data-image-origin-select", "");
  const origins: Array<{ value: DeclaredImageOrigin; label: string }> = [
    { value: "human", label: "Humana (foto / creación propia)" },
    { value: "ai", label: "IA (generada por inteligencia artificial)" },
    { value: "mixed", label: "Mixta (edición híbrida)" },
  ];
  for (const item of origins) {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = item.label;
    originSelect.appendChild(opt);
  }
  originLabel.appendChild(originSelect);
  box.appendChild(originLabel);

  const row = document.createElement("div");
  row.className = "ae-upload-row";

  const uploadBtn = document.createElement("button");
  uploadBtn.type = "button";
  uploadBtn.className = "ae-upload-btn";
  uploadBtn.setAttribute("data-image-upload-btn", "");
  uploadBtn.textContent = "Subir imagen (PNG, JPEG, WebP)";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg,image/webp";
  fileInput.className = "ae-upload-file";
  fileInput.setAttribute("data-image-file-input", "");
  fileInput.setAttribute("aria-label", "Seleccionar imagen PNG, JPEG o WebP");

  const statusEl = document.createElement("p");
  statusEl.className = "ae-upload-status";
  statusEl.setAttribute("data-image-upload-status", "");
  statusEl.setAttribute("role", "status");
  statusEl.setAttribute("aria-live", "polite");

  const initialStatus = panelOptions?.imageUploadStatus;
  if (initialStatus && initialStatus.nodeId === nodeId && initialStatus.message) {
    statusEl.textContent = initialStatus.message;
    statusEl.setAttribute("data-status-kind", initialStatus.kind);
  }

  const setStatus = (kind: "ok" | "error", message: string) => {
    statusEl.textContent = message;
    statusEl.setAttribute("data-status-kind", kind);
    panelOptions?.onImageUploadStatus?.({ nodeId, kind, message });
  };

  uploadBtn.addEventListener("click", () => {
    fileInput.click();
  });

  const uploader = panelOptions?.uploadImage ?? createDefaultImageUploader(panelOptions?.basePath);

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const mime = (file.type || "").toLowerCase();
    if (mime && !ALLOWED_UPLOAD_MIME_TYPES.has(mime)) {
      setStatus("error", "Formato no soportado: solo se aceptan PNG, JPEG o WebP.");
      fileInput.value = "";
      return;
    }

    if (file.size === 0 || file.size > MAX_CLIENT_IMAGE_BYTES) {
      setStatus("error", "La imagen debe pesar entre 1 byte y 4 MiB.");
      fileInput.value = "";
      return;
    }

    uploadBtn.disabled = true;
    uploadBtn.textContent = "Subiendo...";
    statusEl.textContent = "";
    statusEl.removeAttribute("data-status-kind");

    try {
      const buffer = await file.arrayBuffer();
      const imageBase64 = bytesToBase64(new Uint8Array(buffer));
      const declaredOrigin = (originSelect.value as DeclaredImageOrigin) || "human";
      const result = await uploader({
        imageBase64,
        declaredOrigin,
        contentType: mime || undefined,
      });

      if (result.ok) {
        urlInput.value = result.url;
        const msg = result.deduplicated
          ? "Imagen reutilizada (ya registrada y firmada)."
          : "Imagen subida y firmada.";
        setStatus("ok", msg);
        onUploadedUrl(result.url);
      } else {
        setStatus("error", result.message);
      }
    } catch {
      setStatus("error", "No se pudo leer el archivo seleccionado.");
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = "Subir imagen (PNG, JPEG, WebP)";
      fileInput.value = "";
    }
  });

  row.appendChild(uploadBtn);
  row.appendChild(fileInput);
  box.appendChild(row);
  box.appendChild(statusEl);
  return box;
}
