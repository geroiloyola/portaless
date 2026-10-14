// Genera el panel de propiedades automaticamente a partir de
// ElementDefinition.editableProps -- ningun elemento nuevo requiere
// escribir un formulario a mano, solo declarar sus props editables
// (ver elements/registry.ts).

import type { ElementNode } from "../types";
import { elementRegistry } from "../elements/registry";
import type { ResolvedCatalog } from "../elements/element-pack";
import { iconLabel } from "../elements/icons";

// v0.0.9.11: acepta un catalogo opcional (core ∪ element packs). Un nodo de
// pack no esta en elementRegistry, asi que sin catalogo el lookup daria
// `undefined` y el panel crashearia. Con catalogo, un elemento de pack se
// edita con el MISMO panel (mismo shape de editableProps).
export function renderPropertyPanel(
  node: ElementNode | null,
  onChange: (updatedProps: Record<string, unknown>) => void,
  catalog?: ResolvedCatalog
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
        optionEl.textContent = opt;
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
  }

  return panel;
}
