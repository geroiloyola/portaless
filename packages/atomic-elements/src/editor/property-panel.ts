// Genera el panel de propiedades automaticamente a partir de
// ElementDefinition.editableProps -- ningun elemento nuevo requiere
// escribir un formulario a mano, solo declarar sus props editables
// (ver elements/registry.ts).

import type { ElementNode } from "../types";
import { elementRegistry } from "../elements/registry";

export function renderPropertyPanel(
  node: ElementNode | null,
  onChange: (updatedProps: Record<string, unknown>) => void
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "ae-property-panel";

  if (!node) {
    panel.innerHTML = `<p class="ae-empty">Selecciona un elemento del lienzo para editar sus propiedades.</p>`;
    return panel;
  }

  const definition = elementRegistry[node.type];
  const props = { ...definition.defaultProps, ...node.props };

  const title = document.createElement("h3");
  title.textContent = `${definition.icon} ${definition.displayName}`;
  panel.appendChild(title);

  for (const field of definition.editableProps) {
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
