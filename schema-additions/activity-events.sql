-- -----------------------------------------------------------------------------
-- v0.0.9.34 -- Fase 10: feed de actividad (admin)
-- -----------------------------------------------------------------------------
-- Append-only con lo que pasa en el dashboard y el runtime: paginas
-- guardadas/borradas, atestaciones comunitarias recibidas y cambios de
-- permisos. Reemplaza honestamente a los paneles mock (traffic, ledger,
-- orders, revenue) que mostraban datos falsos -- ver ROADMAP.md, Fase 10.
--
-- ADMIN-ONLY POR DISENO: alimenta /admin/api/recents (sesion /admin/*). No
-- guarda IPs, hashes de IP ni user agents: eso es auditoria interna en
-- password_change_events, con otra superficie. Un feed publico seria OTRA
-- tabla, no un filtro de esta.
--
-- SIN BACKFILL: arranca vacio; solo registra lo que ocurre tras el deploy.
-- Un unico escritor (emitActivity en activity-store.ts) inserta filas -- no
-- hay triggers ni copias desde tablas existentes, para que la tabla nunca
-- diverja de sus fuentes.

CREATE TABLE IF NOT EXISTS activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  actor TEXT,
  subject TEXT NOT NULL,
  detail TEXT,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_events_occurred
  ON activity_events(occurred_at DESC, id DESC);
