// Renderiza el Centro de Permisos: agrupado por RIESGO de la capacidad
// (alto primero), y dentro de cada grupo la lista de plugins/agentes/themes
// que la solicitan, con un switch individual -- nunca un permiso "todo o
// nada" por plugin. La categoria de la capacidad (Contenido, Red...) queda
// como etiqueta secundaria: el riesgo es lo que una persona necesita ver
// primero (ROADMAP fase 13, §13.5), y arriba va un resumen de cuantas
// capacidades de cada nivel estan concedidas.
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
//
// APW 6.5: el grant trust:read-governance-bypass tiene su propio formulario
// de alta por DID (no hay "solicitud" del lector que aparezca sola): se
// teclea el did:apw: del lector y el switch de la fila resultante lo
// revoca igual que cualquier otro permiso.

import type { PermissionGrant, PermissionSubject } from "./types";
import {
  listCapabilitiesByRisk,
  RISK_LABELS,
  RISK_ORDER,
  type CapabilityDefinition,
  type CapabilityRisk,
} from "../../plugin-sandbox/src/capabilities/capability-registry";
import { READ_GOVERNANCE_BYPASS_CAPABILITY, isReaderDid, readerSubject } from "./reader-bypass";

export interface PermissionCenterOptions {
  container: HTMLElement;
  allGrants: PermissionGrant[]; // Snapshot inicial (subject x capability).
  onToggle: (grant: PermissionGrant) => Promise<void>;
  // v0.0.9.13: opcional -- si se omite, el badge de trustScore se muestra
  // en modo solo-lectura (sin click), igual que antes de esta version.
  onVote?: (pluginId: string, score: 1 | 2 | 3 | 4 | 5, comment?: string) => Promise<{ trustScore: number; trustScoreVotes: number }>;
}

const SETTLEMENT_CONFIG_URL = "/admin/settlement";

function riskColor(risk: CapabilityRisk): string {
  return risk === "alto" ? "var(--danger-fg)" : risk === "medio" ? "var(--warning-fg)" : "var(--success-fg)";
}

// Capacidades con al menos un grant activo (granted=true). Es la unidad del
// resumen: "cuantas capacidades de este riesgo estan concedidas", no cuantos
// subjects por capacidad (que confundiria 1 capacidad x 3 plugins con 3).
function grantedCapabilityIds(allGrants: PermissionGrant[]): Set<string> {
  const ids = new Set<string>();
  for (const grant of allGrants) if (grant.granted) ids.add(grant.capabilityId);
  return ids;
}

// Resumen de riesgo arriba del Centro: por cada nivel, concedidas / total. El
// nivel con mas concedidas de alto riesgo es lo que una persona deberia ver
// primero, asi que va primero (RISK_ORDER).
function buildRiskSummary(
  byRisk: Record<CapabilityRisk, CapabilityDefinition[]>,
  grantedIds: Set<string>
): HTMLElement {
  const summary = document.createElement("section");
  summary.className = "pc-risk-summary";
  summary.setAttribute("aria-label", "Resumen de capacidades concedidas por nivel de riesgo");

  for (const risk of RISK_ORDER) {
    const caps = byRisk[risk];
    const granted = caps.filter((cap) => grantedIds.has(cap.id)).length;

    const cell = document.createElement("div");
    cell.className = "pc-risk-summary-cell";
    cell.dataset.risk = risk;

    const count = document.createElement("span");
    count.className = "pc-risk-summary-count";
    count.style.color = riskColor(risk);
    count.textContent = `${granted}/${caps.length}`;

    const label = document.createElement("span");
    label.className = "pc-risk-summary-label";
    label.textContent = `${RISK_LABELS[risk]} · concedidas`;

    cell.appendChild(count);
    cell.appendChild(label);
    summary.appendChild(cell);
  }

  return summary;
}

// Iconos de tipo de subject -- SVG inline (Lucide, ISC) en vez de emoji.
// El emoji lo pinta el sistema operativo con su propio color, asi que
// rompe el contraste del panel oscuro; con stroke="currentColor" hereda
// --text/--muted por CSS y pasa WCAG en cualquier tema.
const PC_SVG_OPEN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

const SUBJECT_ICONS: Record<string, string> = {
  plugin: `${PC_SVG_OPEN}<path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L4.39 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 4.39a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68L6.927 1.39a2.414 2.414 0 0 1 3.414 0z"/></svg>`,
  agent: `${PC_SVG_OPEN}<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>`,
  theme: `${PC_SVG_OPEN}<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/></svg>`,
  "settlement-provider": `${PC_SVG_OPEN}<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>`,
  reader: `${PC_SVG_OPEN}<path d="M4 10a8 8 0 0 1 8 8"/><path d="M4 14a4 4 0 0 1 4 4"/><circle cx="9" cy="9" r="2"/><path d="m2 22 3.086-3.086a2 2 0 0 1 2.828 0L22 22"/></svg>`,
};

function subjectIcon(type: PermissionGrant["subject"]["type"]): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "pc-subject-icon";
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = SUBJECT_ICONS[type] ?? SUBJECT_ICONS.theme; // constantes internas, nunca input de usuario
  return wrap;
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

// APW 6.5: alta de una excepcion de lectura por DID de lector. El lector no
// "solicita" el permiso: el administrador teclea su did:apw: y decide.
function buildReaderGrantForm(
  capabilityId: string,
  allGrants: PermissionGrant[],
  onToggle: (grant: PermissionGrant) => Promise<void>,
  onChange: () => void
): HTMLElement {
  const form = document.createElement("form");
  form.className = "pc-reader-form";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "pc-reader-did";
  input.placeholder = "did:apw:indice.example";
  input.setAttribute("aria-label", "DID del lector (did:apw:<dominio>)");
  input.autocomplete = "off";

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "pc-vote-submit";
  submitBtn.textContent = "Conceder excepción";

  const feedback = document.createElement("div");
  feedback.className = "pc-vote-feedback";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitBtn.disabled) return;

    const did = input.value.trim();
    feedback.classList.remove("pc-status-error");

    if (!isReaderDid(did)) {
      feedback.textContent = "Escribí un DID con forma did:apw:<dominio>, por ejemplo did:apw:indice.example.";
      feedback.classList.add("pc-status-error");
      return;
    }
    if (allGrants.some((g) => g.subject.type === "reader" && g.subject.id === did && g.capabilityId === capabilityId)) {
      feedback.textContent = "Ese lector ya tiene una fila de excepción (usa su switch para revocarla).";
      feedback.classList.add("pc-status-error");
      return;
    }

    const grant: PermissionGrant = { subject: readerSubject(did), capabilityId, granted: true };
    submitBtn.disabled = true;
    feedback.textContent = "Guardando…";
    try {
      await onToggle(grant);
      allGrants.push(grant);
      input.value = "";
      onChange();
    } catch (err) {
      feedback.textContent = `Error al guardar: ${(err as Error).message ?? "desconocido"}`;
      feedback.classList.add("pc-status-error");
      submitBtn.disabled = false;
    }
  });

  form.appendChild(input);
  form.appendChild(submitBtn);
  form.appendChild(feedback);
  return form;
}

export function renderPermissionCenter(options: PermissionCenterOptions): void {
  const { container, allGrants, onToggle, onVote } = options;
  const byRisk = listCapabilitiesByRisk();

  container.innerHTML = "";
  container.className = "pc-shell";

  const totalCaps = RISK_ORDER.reduce((sum, risk) => sum + byRisk[risk].length, 0);
  if (totalCaps === 0) {
    const empty = document.createElement("p");
    empty.className = "pc-empty";
    empty.textContent = "No hay capacidades registradas en el catálogo.";
    container.appendChild(empty);
    return;
  }

  container.appendChild(buildRiskSummary(byRisk, grantedCapabilityIds(allGrants)));

  for (const risk of RISK_ORDER) {
    const capabilities = byRisk[risk];
    if (capabilities.length === 0) continue;

    const section = document.createElement("section");
    section.className = "pc-category";
    section.dataset.risk = risk;

    const header = document.createElement("h3");
    header.className = "pc-category-title";
    header.style.color = riskColor(risk);
    header.textContent = RISK_LABELS[risk];
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

      // El riesgo ya es la seccion; la etiqueta de la capacidad muestra su
      // CATEGORIA, que es el dato que se perderia al agrupar por riesgo.
      const categoryBadge = document.createElement("span");
      categoryBadge.className = "pc-cap-category";
      categoryBadge.textContent = cap.category;

      capHeader.appendChild(capText);
      capHeader.appendChild(categoryBadge);
      capBlock.appendChild(capHeader);

      const subjectsForCap = allGrants.filter((g) => g.capabilityId === cap.id);

      if (subjectsForCap.length === 0) {
        const empty = document.createElement("div");
        empty.className = "pc-empty";
        empty.textContent =
          cap.id === READ_GOVERNANCE_BYPASS_CAPABILITY
            ? "Ningún lector tiene una excepción todavía. Agregá su DID abajo."
            : "Ningún plugin o agente ha solicitado este permiso todavía.";
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
          label.appendChild(subjectIcon(grant.subject.type));
          label.appendChild(document.createTextNode(` ${grant.subject.displayName}`));
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

      // APW 6.5: el bypass se teclea por DID; no viene de ninguna lista de
      // subjects conocidos (no hay "solicitud" del lector).
      if (cap.id === READ_GOVERNANCE_BYPASS_CAPABILITY) {
        capBlock.appendChild(
          buildReaderGrantForm(cap.id, allGrants, onToggle, () => renderPermissionCenter(options))
        );
      }

      list.appendChild(capBlock);
    }

    section.appendChild(list);
    container.appendChild(section);
  }
}
