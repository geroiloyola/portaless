-- -----------------------------------------------------------------------------
-- v0.0.9.31 -- Nonces anti-replay de Web Bot Auth compartidos entre instancias
-- -----------------------------------------------------------------------------
-- Reemplaza al Map en memoria por proceso que usaba webbotauth/verify.ts:
-- con multiples workers cada proceso tenia su propia ventana de 300 s y un
-- replay del mismo nonce contra otra instancia pasaba. Patron identico a
-- auth_mfa_challenges (packages/auth): nonce como PRIMARY KEY, el INSERT
-- atomico con UNIQUE es la deteccion de replay, y expires_at (epoch ms)
-- con DELETE de vencidos en cada escritura da el TTL. Ver
-- packages/trust-layer/src/webbotauth/nonce-store.ts.

CREATE TABLE IF NOT EXISTS webbotauth_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webbotauth_nonces_expires_at
  ON webbotauth_nonces(expires_at);
