// Renderiza el Centro de Permisos con la misma logica visual que la
// pantalla de Privacidad y Seguridad de iOS/Android: agrupado por
// categoria de permiso, y dentro de cada categoria, la lista de
// plugins/agentes/themes que lo solicitan, con un switch individual --
// nunca un permiso "todo o nada" por plugin.

import type { PermissionGrant } from "./types";
import { capabilityRegistry, listCapabilitiesByCategory } from "../../plugin-sandbox/src/capabilities/capability-registry";
import type { PermissionStore } from "./permission-store";

export interface PermissionCenterOptions {
  container: HTMLElement;
  store: PermissionStore;
  allGrants: PermissionGrant[]; // Snapshot inicial (subject x capability).
  onToggle: (grant: PermissionGrant) => Promise<void>;
}

function riskColor(risk: "bajo" | "medio" | "alto"): string {
  return risk === "alto" ? "#ff6e6e" : risk === "medio" ? "#ffb86b" : "#6ee7b7";
}

export function renderPermissionCenter(options: PermissionCenterOptions): void {
  const { container, allGrants, onToggle } = options;
  const grouped = listCapabilitiesByCategory();

  container.innerHTML = "";
  container.className = "pc-shell";

  for (const [category, capabilities] of Object.entries(grouped)) {
    const section = document.createElement("section");
    section.className = "pc-category";

    const header = document.createElement("h3");
    header.textContent = category;
    section.appendChild(header);

    for (const cap of capabilities) {
      const capBlock = document.createElement("div");
      capBlock.className = "pc-capability";

      const capHeader = document.createElement("div");
      capHeader.className = "pc-capability-header";
      capHeader.innerHTML = `
        <div>
          <div class="pc-cap-label">${cap.label}</div>
          <div class="pc-cap-desc">${cap.description}</div>
        </div>
        <span class="pc-risk" style="background:${riskColor(cap.risk)}22;color:${riskColor(cap.risk)};">
          riesgo ${cap.risk}
        </span>`;
      capBlock.appendChild(capHeader);

      const subjectsForCap = allGrants.filter((g) => g.capabilityId === cap.id);

      if (subjectsForCap.length === 0) {
        const empty = document.createElement("div");
        empty.className = "pc-empty";
        empty.textContent = "Ningún plugin o agente ha solicitado este permiso todavía.";
        capBlock.appendChild(empty);
      } else {
        for (const grant of subjectsForCap) {
          const row = document.createElement("div");
          row.className = "pc-subject-row";

          const label = document.createElement("span");
          label.textContent = `${grant.subject.type === "plugin" ? "🧩" : grant.subject.type === "agent" ? "🤖" : "🎨"} ${grant.subject.displayName}`;

          const switchEl = document.createElement("div");
          switchEl.className = "pc-switch" + (grant.granted ? " pc-on" : "");
          switchEl.innerHTML = `<div class="pc-knob"></div>`;
          switchEl.addEventListener("click", async () => {
            const updated: PermissionGrant = { ...grant, granted: !grant.granted };
            await options.store.setGrant(updated);
            await onToggle(updated);
            switchEl.classList.toggle("pc-on", updated.granted);
          });

          row.appendChild(label);
          row.appendChild(switchEl);
          capBlock.appendChild(row);
        }
      }

      section.appendChild(capBlock);
    }

    container.appendChild(section);
  }
}
