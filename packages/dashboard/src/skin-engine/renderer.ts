// Traduce un ResolvedSkin (layout + tokens) a DOM real dentro de un
// contenedor, usando unicamente organismos del registro. Este renderer no
// sabe nada de "blog", "tienda" ni "crm" -- esa logica vive exclusivamente
// en los archivos skins/*.json.

import type { ResolvedSkin, OrganismPlacement } from "../types";
import { organismRegistry } from "../organisms/registry";
import { applyDesignTokens } from "./tokens";

export interface RenderOptions {
  /** Datos reales por organismo. Si falta uno, se usa su mockData. */
  dataByOrganism?: Record<string, unknown>;
  columns?: number; // Numero de columnas de la grilla (por defecto 4).
}

function applyPlacement(el: HTMLElement, placement: OrganismPlacement): void {
  if (placement.hidden) {
    el.style.display = "none";
    return;
  }
  el.style.display = "";

  const rules: string[] = [];
  if (placement.w) rules.push(`grid-column: span ${placement.w}`);
  if (placement.h) rules.push(`grid-row: span ${placement.h}`);
  if (placement.order !== undefined) rules.push(`order: ${placement.order}`);
  if (placement.x !== undefined) rules.push(`grid-column-start: ${placement.x + 1}`);
  if (placement.y !== undefined) rules.push(`grid-row-start: ${placement.y + 1}`);

  el.style.cssText += ";" + rules.join(";");
  el.dataset.priority = placement.priority ?? "normal";
}

/**
 * Renderiza un skin resuelto dentro de `container`. Limpia el contenido
 * previo del contenedor antes de montar los organismos del nuevo skin --
 * pensado para poder cambiar de skin en caliente sin recargar la pagina,
 * igual que en el demo interactivo de Portaless_Skin_System_Demo.html.
 */
export function renderSkin(
  container: HTMLElement,
  resolved: ResolvedSkin,
  options: RenderOptions = {}
): void {
  applyDesignTokens(resolved.tokens);

  container.innerHTML = "";
  container.style.display = "grid";
  container.style.gridTemplateColumns = `repeat(${options.columns ?? 4}, 1fr)`;
  container.style.gap = "16px";

  for (const placement of resolved.layout) {
    const organism = organismRegistry[placement.organism];
    if (!organism) {
      console.warn(`[Portaless Dashboard] Organismo desconocido: "${placement.organism}"`);
      continue;
    }

    const data = options.dataByOrganism?.[placement.organism] ?? organism.mockData;
    const el = organism.render(data);
    applyPlacement(el, placement);
    container.appendChild(el);
  }
}
