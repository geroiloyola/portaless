// Reconciliacion de capacidades al ACTUALIZAR un plugin (Fase 11.2).
//
// Al reinstalar/actualizar, el grant efectivo de un plugin es, en todo momento,
// `concedido ∩ manifiesto` (regla del sandbox). Eso ya degrada seguro, pero hay
// que decidir explicitamente los dos casos que aparecen:
//   - capacidades REMOVIDAS: se podan (un grant viejo no debe sobrevivir a una
//     version que ya no las pide).
//   - capacidades AMPLIADAS: NO se auto-conceden; vuelven a revision humana.
//
// Funcion pura: recibe el manifiesto anterior, el nuevo y los grants actuales, y
// devuelve que podar y que queda a revision. No escribe nada.
//
// No es exclusivo del instalador: tambien sirve para auditar por que un plugin
// quedo sin cierta capacidad tras un update.

import type { CapabilityId, CapabilityRequest } from "./types";

export interface ReconcileResult {
  /** Grants que sobreviven: concedidos Y todavia pedidos por el manifiesto. */
  keep: CapabilityId[];
  /** Grants a PODAR: concedidos pero ya no pedidos. */
  prune: CapabilityId[];
  /** Capacidades nuevas pedidas y NO concedidas: vuelven a revision humana. */
  needsReview: CapabilityId[];
}

function idsOf(reqs: readonly CapabilityRequest[]): Set<CapabilityId> {
  return new Set(reqs.map((r) => r.id));
}

export function reconcileGrants(
  previousRequested: readonly CapabilityRequest[],
  nextRequested: readonly CapabilityRequest[],
  currentGrants: Iterable<CapabilityId>
): ReconcileResult {
  const next = idsOf(nextRequested);
  const granted = new Set(currentGrants);
  // El manifiesto anterior no se usa para podar (una capacidad removida del
  // manifiesto se poda aunque el grant sea de una version vieja); se recibe
  // para dejar explicito el contrato y permitir auditorias.
  void previousRequested;

  const keep: CapabilityId[] = [];
  const prune: CapabilityId[] = [];
  for (const cap of granted) {
    if (next.has(cap)) keep.push(cap);
    else prune.push(cap);
  }
  const needsReview = [...next].filter((cap) => !granted.has(cap));

  const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  keep.sort(byId);
  prune.sort(byId);
  needsReview.sort(byId);
  return { keep, prune, needsReview };
}
