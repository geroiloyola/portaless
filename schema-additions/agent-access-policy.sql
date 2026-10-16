-- -----------------------------------------------------------------------------
-- v0.0.9.33 -- Override del operador sobre la politica de acceso de agentes
-- (ROADMAP.md, fase 12: "la politica de acceso de agentes pasa a ser operable
-- desde el panel", §12.1 + §12.2).
--
-- Una sola fila (id = 1). La precedencia documentada es store > asset >
-- default: si esta tabla esta vacia, la politica efectiva sale del asset
-- /.well-known/portaless-content-policy.json; si ese archivo no existe o esta
-- incompleto, de defaultContentPolicy() en manifest-schema.ts.
--
-- policy_json guarda el bloque "policies" completo y no una fila por regla, a
-- proposito: el manifiesto ya tiene esa forma, y una regla nueva agregada al
-- esquema (p. ej. una que no sea search/ai_input/ai_train) no requiere
-- migracion ni columna nueva.
--
-- Se valida al ESCRIBIR (nadie guarda un manifiesto a medio escribir) y se
-- revalida al LEER: un JSON corrupto o editado a mano cae al asset en vez de
-- dejar el sitio sin politica -- el fallo va hacia el valor conocido, nunca
-- hacia "sin regla".
--
-- No va en REQUIRED_TABLES (scripts/setup.mjs) a proposito: su ausencia es un
-- estado valido (el site usa el asset), igual que authorized_agents y
-- site_trust_read_policies.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_access_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  policy_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
