// Renderiza el Centro de Permisos con la misma logica visual que la
// pantalla de Privacidad y Seguridad de iOS/Android: agrupado por
// categoria de permiso, y dentro de cada categoria, la lista de
// plugins/agentes/themes que lo solicitan, con un switch individual --
// nunca un permiso "todo o nada" por plugin.
//
// v0.0.9.2: esta UI ya NO recibe un `PermissionStore` directo -- antes
// options.store.setGrant(...) se llamaba desde el navegador, lo cual no
// tiene sentido para D1PermissionStore/SqlitePermissionStore (son
// implementaciones server-side, D1 ni siquiera existe en el cliente) y
// ademas duplicaba la escritura junto con onToggle. Ahora el unico canal
// de escritura es onToggle, que quien monte este componente conecta a un
// fetch real contra /admin/permissions (ver src/pages/admin/permissions.astro).
// Esto tambien agrega manejo de estado por fila: "guardando..." mientras
// la promesa esta en vuelo, revertir visualmente si onToggle rechaza, y
// deshabilitar el switch para evitar doble-click durante el guardado.

import type { PermissionGrant } from "./types";
import { capabilityRegistry, listCapabilitiesByCategory } from "../../plugin-sandbox/src/capabilities/capability-registry";

export interface PermissionCenterOptions {
  container: HTMLElement;
  allGrants: PermissionGrant[]; // Snapshot inicial (subject x capability).
  onToggle: (grant: PermissionGrant) => Promise<void>;
}

function riskColor(risk: "bajo" | "medio" | "alto"): string {
  return risk === "alto" ? "#ff6e6e" : risk === "medio" ? "#ffb86b" : "#6ee7b7";
}

function subjectIcon(type: PermissionGrant["subject"]["type"]): string {
  return type === "plugin" ? "🧩" : type === "agent" ? "🤖" : "🎨";
}

export function renderPermissionCenter(options: PermissionCenterOptions): void {
  const { container, allGrants, onToggle } = options;
  const grouped = listCapabilitiesByCategory();

  container.innerHTML = "";
  container.className = "pc-shell";

  const categoryNames = Object.keys(grouped);
  if (categoryNames.length === 0) {
    const empty = document.createElement("p");
    empty.className = "pc-empty";
    empty.textContent = "No hay capacidades registradas en el catálogo.";
    container.appendChild(empty);
    return;
  }

  for (const [category, capabilities] of Object.entries(grouped)) {
    const section = document.createElement("section");
    section.className = "pc-category";

    const header = document.createElement("h3");
    header.className = "pc-category-title";
    header.textContent = category;
    section.appendChild(header);

    const list = document.createElement("div");
    list.className = "pc-capability-list";

    for (const cap of capabilities) {
      const capBlock = document.createElement("article");
      capBlock.className = "pc-capability";

      const capHeader = document.createElement("div");
      capHeader.className = "pc-capability-header";

      const capText = document.createElement("div");
      capText.className = "pc-cap-text";

      const capLabel = document.createElement("div");
      capLabel.className = "pc-cap-label";
      capLabel.textContent = cap.label;

      const capDesc = document.createElement("div");
      capDesc.className = "pc-cap-desc";
      capDesc.textContent = cap.description;

      capText.appendChild(capLabel);
      capText.appendChild(capDesc);

      const riskBadge = document.createElement("span");
      riskBadge.className = "pc-risk";
      riskBadge.style.background = `${riskColor(cap.risk)}22`;
      riskBadge.style.color = riskColor(cap.risk);
      riskBadge.textContent = `riesgo ${cap.risk}`;

      capHeader.appendChild(capText);
      capHeader.appendChild(riskBadge);
      capBlock.appendChild(capHeader);

      const subjectsForCap = allGrants.filter((g) => g.capabilityId === cap.id);

      if (subjectsForCap.length === 0) {
        const empty = document.createElement("div");
        empty.className = "pc-empty";
        empty.textContent = "Ningún plugin o agente ha solicitado este permiso todavía.";
        capBlock.appendChild(empty);
      } else {
        const subjectList = document.createElement("div");
        subjectList.className = "pc-subject-list";

        for (const grant of subjectsForCap) {
          const row = document.createElement("div");
          row.className = "pc-subject-row";

          const label = document.createElement("span");
          label.className = "pc-subject-label";
          label.textContent = `${subjectIcon(grant.subject.type)} ${grant.subject.displayName}`;

          const status = document.createElement("span");
          status.className = "pc-subject-status";

          const switchEl = document.createElement("button");
          switchEl.type = "button";
          switchEl.className = "pc-switch" + (grant.granted ? " pc-on" : "");
          switchEl.setAttribute("role", "switch");
          switchEl.setAttribute("aria-checked", String(grant.granted));
          switchEl.setAttribute(
            "aria-label",
            `${grant.granted ? "Revocar" : "Conceder"} "${cap.label}" a ${grant.subject.displayName}`
          );
          switchEl.innerHTML = `<span class="pc-knob"></span>`;

          switchEl.addEventListener("click", async () => {
            if (switchEl.disabled) return;

            const previousGranted = grant.granted;
            const updated: PermissionGrant = { ...grant, granted: !previousGranted };

            switchEl.disabled = true;
            switchEl.classList.add("pc-saving");
            status.textContent = "Guardando…";

            try {
              await onToggle(updated);
              grant.granted = updated.granted;
              switchEl.classList.toggle("pc-on", updated.granted);
              switchEl.setAttribute("aria-checked", String(updated.granted));
              status.textContent = "";
            } catch (err) {
              // Revierte visualmente -- el toggle no se aplico en el
              // servidor, asi que el switch no debe quedar en el estado
              // nuevo. Nunca falla en silencio: el mensaje queda visible
              // hasta el proximo intento.
              switchEl.classList.toggle("pc-on", previousGranted);
              switchEl.setAttribute("aria-checked", String(previousGranted));
              status.textContent = `Error al guardar: ${(err as Error).message ?? "desconocido"}`;
              status.classList.add("pc-status-error");
            } finally {
              switchEl.disabled = false;
              switchEl.classList.remove("pc-saving");
            }
          });

          row.appendChild(label);
          row.appendChild(status);
          row.appendChild(switchEl);
          subjectList.appendChild(row);
        }

        capBlock.appendChild(subjectList);
      }

      list.appendChild(capBlock);
    }

    section.appendChild(list);
    container.appendChild(section);
  }
}
