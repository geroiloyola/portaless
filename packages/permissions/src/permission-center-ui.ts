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
//
// v0.0.9.12: agrega el badge de trustScore estilo Trakt junto al nombre
// de cada subject de tipo "plugin" (grant.subject.trustScore, ver
// types.ts). Diseño: 5 estrellas, escala 0-10 (el trustScore real vive en
// 0-5 -- promedio de PluginTrustVote.score -- y se multiplica x2 solo para
// esta visualizacion), cada estrella representa 2 puntos y se rellena de
// forma PARCIAL via clip-path cuando el puntaje cae a mitad de una
// estrella (ej. 8.6 -> 4 estrellas llenas + la 5ta al 30%). Color dinamico
// por rango: rojo (<4), naranja (4-6), amarillo (6-7.5), verde claro
// (7.5-9), verde oscuro (9-10). agent/theme no tienen trustScore -- no se
// renderiza nada para ellos (mismo bloque de codigo, solo se omite si
// subject.trustScore es undefined).
//
// v0.0.9.13: el badge de trustScore ahora es interactivo. Un click lo
// expande en un mini-formulario de voto (5 estrellas ENTERAS clicables
// 1-5 -- la escala real de PluginTrustVote.score, no la escala 0-10 de
// visualizacion -- mas un comentario opcional), conectado a onVote
// (nueva prop, mismo patron que onToggle: la UI nunca llama a un store
// directo, solo delega al fetch real que monta la pagina). Cierra el
// hueco documentado desde el PR #28: "no existe UI para que alguien vote
// 1-5". Alcance: este voto es la fuente "self"/admin sobre el trustScore
// de PLUGINS -- no confundir con el futuro SiteTrustScore de sitios
// completos (dominio distinto, packages/trust-layer).

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

function riskColor(risk: "bajo" | "medio" | "alto"): string {
  return risk === "alto" ? "#ff6e6e" : risk === "medio" ? "#ffb86b" : "#6ee7b7";
}

function subjectIcon(type: PermissionGrant["subject"]["type"]): string {
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
// Se construye una sola vez y se muestra/oculta con un toggle, en vez de
// reconstruirse en cada apertura -- mantiene el estado del formulario
// (score elegido, texto escrito) si el admin lo cierra por error.
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

  // trustScore vive en 0-5 (promedio de votos 1-5) -- se reescala a 0-10
  // solo para esta visualizacion, igual que Trakt muestra "8.6" en vez
  // de "4.3 de 5".
  let score10 = Math.round(subject.trustScore * 2 * 10) / 10;
  let votes = subject.trustScoreVotes ?? 0;

  const badge = document.createElement("span");
  badge.className = "pc-trust-badge";

  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "pc-trust-summary";
  // Sin onVote (o sin subject.id -- no deberia pasar para type:"plugin"),
  // el badge queda como boton deshabilitado visualmente: mismo aspecto,
  // sin interaccion. Mantiene el modo solo-lectura de v0.0.9.12 intacto
  // para cualquier consumidor que no pase onVote.
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
