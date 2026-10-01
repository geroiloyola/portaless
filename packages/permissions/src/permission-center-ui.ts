// Renderiza el Centro de Permisos con la misma logica visual que la
// pantalla de Privacidad y Seguridad de iOS/Android: agrupado por
// categoria de permiso, y dentro de cada categoria, la lista de
// plugins/agentes/themes que lo solicitan, con un switch individual --
// nunca un permiso "todo o nada" por plugin.
//
// v0.0.9.2: el unico canal de escritura es onToggle (fetch real contra
// /admin/permissions, ver src/pages/admin/permissions.astro), con estado
// por fila: "guardando...", revertir si falla, switch deshabilitado
// durante el guardado.
//
// v0.0.9.12: badge de trustScore estilo Trakt para subjects "plugin"
// (5 estrellas, escala 0-10, relleno parcial via clip-path, color por rango).
//
// v0.0.9.13: el badge es interactivo: voto 1-5 + comentario via onVote.
//
// PR H: subjects "settlement-provider" (proveedores pay-per-crawl) no
// tienen switch: muestran su estado y un enlace a /admin/settlement, unico
// lugar donde se activan, con credenciales verificadas.

import type { PermissionGrant, PermissionSubject } from "./types";
import { capabilityRegistry, listCapabilitiesByCategory } from "../../plugin-sandbox/src/capabilities/capability-registry";

export interface PermissionCenterOptions {
  container: HTMLElement;
  allGrants: PermissionGrant[]; // Snapshot inicial (subject x capability).
  onToggle: (grant: PermissionGrant) => Promise<void>;
  // v0.0.9.13: opcional -- si se omite, el badge de trustScore se muestra
  // en modo solo-lectura (sin click), igual que antes de esta version.
  onVote?: (pluginId: string, score: 1 | 2 | 3 | 4 | 5, comment?: string) => Promise<{ trustScore: number; trustScoreVotes: number }>;
}

const SETTLEMENT_CONFIG_URL = "/admin/settlement";

function riskColor(risk: "bajo" | "medio" | "alto"): string {
  return risk === "alto" ? "#ff6e6e" : risk === "medio" ? "#ffb86b" : "#6ee7b7";
}

function subjectIcon(type: PermissionGrant["subject"]["type"]): string {
  if (type === "settlement-provider") return "💳";
  return type === "plugin" ? "🧩" : type === "agent" ? "🤖" : "🎨";
}

// Escala de color estilo Trakt sobre la escala 0-10 ya reescalada.
function trustColor(score10: number): string {
  if (score10 < 4) return "#e5484d";   // rojo
  if (score10 < 6) return "#f2994a";   // naranja
  if (score10 < 7.5) return "#f2c94c"; // amarillo
  if (score10 < 9) return "#8bd17c";   // verde claro
  return "#2e9e44";                    // verde oscuro, potente
}

// Porcentaje de relleno (0-100) de la estrella `starIndex` (0..4), dado un
// puntaje en escala 0-10 donde cada estrella vale 2 puntos.
function starFillPercent(score10: number, starIndex: number): number {
  const starCeiling = (starIndex + 1) * 2;
  const starFloor = starIndex * 2;
  if (score10 >= starCeiling) return 100;
  if (score10 <= starFloor) return 0;
  return Math.round(((score10 - starFloor) / 2) * 100);
}

function buildReadonlyStars(score10: number, color: string): HTMLElement {
  const starsWrap = document.createElement("span");
  starsWrap.className = "pc-trust-stars";

  for (let i = 0; i < 5; i++) {
    const fill = starFillPercent(score10, i);

    const starSlot = document.createElement("span");
    starSlot.className = "pc-trust-star-slot";

    const starBg = document.createElement("span");
    starBg.className = "pc-trust-star pc-trust-star-bg";
    starBg.textContent = "★";
    starSlot.appendChild(starBg);

    const starFg = document.createElement("span");
    starFg.className = "pc-trust-star pc-trust-star-fg";
    starFg.textContent = "★";
    starFg.style.color = color;
    starFg.style.clipPath = `inset(0 ${100 - fill}% 0 0)`;
    starSlot.appendChild(starFg);

    starsWrap.appendChild(starSlot);
  }

  return starsWrap;
}

// Formulario de voto: 5 estrellas ENTERAS clicables (escala real 1-5, no
// la escala 0-10 de visualizacion), + textarea opcional, + boton enviar.
// Se construye una sola vez y se muestra/oculta con un toggle.
function buildVoteForm(
  pluginId: string,
  onVote: NonNullable<PermissionCenterOptions["onVote"]>,
  onVoteRecorded: (result: { trustScore: number; trustScoreVotes: number }) => void
): HTMLElement {
  const form = document.createElement("div");
  form.className = "pc-vote-form";

  const starsRow = document.createElement("div");
  starsRow.className = "pc-vote-stars-row";

  let selectedScore: 1 | 2 | 3 | 4 | 5 | null = null;
  const starButtons: HTMLButtonElement[] = [];

  function paintStars(upTo: number): void {
    starButtons.forEach((btn, idx) => {
      btn.classList.toggle("pc-vote-star-filled", idx < upTo);
    });
  }

  for (let i = 1; i <= 5; i++) {
    const starBtn = document.createElement("button");
    starBtn.type = "button";
    starBtn.className = "pc-vote-star";
    starBtn.textContent = "★";
    starBtn.setAttribute("aria-label", `Calificar con ${i} de 5`);

    starBtn.addEventListener("mouseenter", () => paintStars(i));
    starBtn.addEventListener("mouseleave", () => paintStars(selectedScore ?? 0));
    starBtn.addEventListener("click", () => {
      selectedScore = i as 1 | 2 | 3 | 4 | 5;
      paintStars(i);
    });

    starButtons.push(starBtn);
    starsRow.appendChild(starBtn);
  }

  const commentInput = document.createElement("textarea");
  commentInput.className = "pc-vote-comment";
  commentInput.placeholder = "Comentario opcional…";
  commentInput.rows = 2;

  const feedback = document.createElement("div");
  feedback.className = "pc-vote-feedback";

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "pc-vote-submit";
  submitBtn.textContent = "Enviar voto";

  submitBtn.addEventListener("click", async () => {
    if (!selectedScore) {
      feedback.textContent = "Elegí una calificación de 1 a 5 estrellas primero.";
      feedback.classList.add("pc-status-error");
      return;
    }

    submitBtn.disabled = true;
    feedback.classList.remove("pc-status-error");
    feedback.textContent = "Enviando voto…";

    try {
      const result = await onVote(pluginId, selectedScore, commentInput.value || undefined);
      feedback.textContent = "¡Voto registrado!";
      onVoteRecorded(result);
    } catch (err) {
      feedback.textContent = `Error al votar: ${(err as Error).message ?? "desconocido"}`;
      feedback.classList.add("pc-status-error");
    } finally {
      submitBtn.disabled = false;
    }
  });

  form.appendChild(starsRow);
  form.appendChild(commentInput);
  form.appendChild(submitBtn);
  form.appendChild(feedback);

  return form;
}

function buildTrustBadge(
  subject: PermissionSubject,
  onVote?: PermissionCenterOptions["onVote"]
): HTMLElement | null {
  if (subject.trustScore === undefined) return null;

  let score10 = Math.round(subject.trustScore * 2 * 10) / 10;
  let votes = subject.trustScoreVotes ?? 0;

  const badge = document.createElement("span");
  badge.className = "pc-trust-badge";

  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "pc-trust-summary";
  if (!onVote) {
    summary.disabled = true;
    summary.classList.add("pc-trust-readonly");
  }

  function renderSummaryContents(): void {
    summary.innerHTML = "";
    const color = trustColor(score10);
    summary.style.color = color;
    summary.setAttribute(
      "aria-label",
      `Puntuación de confianza de la comunidad: ${score10.toFixed(1)} de 10, ${votes} ${votes === 1 ? "voto" : "votos"}.` +
        (onVote ? " Click para calificar." : "")
    );
    summary.appendChild(buildReadonlyStars(score10, color));

    const scoreText = document.createElement("span");
    scoreText.className = "pc-trust-score-text";
    scoreText.textContent = ` ${score10.toFixed(1)}`;
    summary.appendChild(scoreText);

    const votesText = document.createElement("span");
    votesText.className = "pc-trust-votes-text";
    votesText.textContent = ` (${votes} ${votes === 1 ? "comentario" : "comentarios"})`;
    summary.appendChild(votesText);
  }

  renderSummaryContents();
  badge.appendChild(summary);

  if (onVote && subject.id) {
    let voteForm: HTMLElement | null = null;

    summary.addEventListener("click", () => {
      if (voteForm) {
        voteForm.classList.toggle("pc-vote-form-open");
        return;
      }

      voteForm = buildVoteForm(subject.id, onVote, (result) => {
        score10 = Math.round(result.trustScore * 2 * 10) / 10;
        votes = result.trustScoreVotes;
        renderSummaryContents();
      });
      badge.appendChild(voteForm);
      requestAnimationFrame(() => voteForm?.classList.add("pc-vote-form-open"));
    });
  }

  return badge;
}

// PR H: fila de un proveedor de cobro. Sin switch: estado + enlace.
function buildSettlementControl(grant: PermissionGrant): HTMLElement {
  const link = document.createElement("a");
  link.className = "pc-settlement-configure";
  link.href = `${SETTLEMENT_CONFIG_URL}#${encodeURIComponent(grant.subject.id)}`;
  link.textContent = grant.granted ? "Activo · Administrar" : "Configurar";
  link.setAttribute(
    "aria-label",
    `${grant.granted ? "Administrar" : "Configurar"} el cobro con ${grant.subject.displayName}. Requiere credenciales verificadas.`
  );
  return link;
}

export function renderPermissionCenter(options: PermissionCenterOptions): void {
  const { container, allGrants, onToggle, onVote } = options;
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

          const labelWrap = document.createElement("div");
          labelWrap.className = "pc-subject-label-wrap";

          const label = document.createElement("span");
          label.className = "pc-subject-label";
          label.textContent = `${subjectIcon(grant.subject.type)} ${grant.subject.displayName}`;
          labelWrap.appendChild(label);

          const trustBadge = buildTrustBadge(grant.subject, onVote);
          if (trustBadge) {
            labelWrap.appendChild(trustBadge);
          }

          const status = document.createElement("span");
          status.className = "pc-subject-status";

          if (grant.subject.type === "settlement-provider") {
            row.appendChild(labelWrap);
            row.appendChild(status);
            row.appendChild(buildSettlementControl(grant));
            subjectList.appendChild(row);
            continue;
          }

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
              switchEl.classList.toggle("pc-on", previousGranted);
              switchEl.setAttribute("aria-checked", String(previousGranted));
              status.textContent = `Error al guardar: ${(err as Error).message ?? "desconocido"}`;
              status.classList.add("pc-status-error");
            } finally {
              switchEl.disabled = false;
              switchEl.classList.remove("pc-saving");
            }
          });

          row.appendChild(labelWrap);
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
