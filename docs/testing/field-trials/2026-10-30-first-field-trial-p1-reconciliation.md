# A0 — Reconciliación de estado (PR-A)

Fecha: 2026-10-30. Base: `origin/main` = `301fe58`.

## PR fusionados desde #104

Fuente: `gh pr list --state merged --limit 100` y `git log origin/main`.

| PR | Título | Commit fusionado |
|---|---|---|
| #104 | docs(ltp): S1/S3 draft assets, cross-checks and extraction boundaries | `7991fe5` |
| #105 | feat(ltp): bounded G2/G3 identity acquisition and verifier | `a045a5d` |
| #106 | feat(ltp): harden live egress against SSRF and rebinding | `48f940a` |
| #107 | docs(ltp): static REP-01..REP-11 reputation vectors | `1cff35d` |
| #108 | feat(ltp): G4 SVRI reputation engine for 117 vectors | `889dfd9` |
| #109 | docs(ltp): approve Beta-first strategy and pause A/B/C | `6483985` |
| #110 | docs(testing): add P1/P2 external adoption protocol | `ffcdfa3` |
| #111 | fix(auth): close P0 web and authentication review findings | `9938ba5` |
| #112 | fix(security): close P1 auth, trust egress and headers | `714db7c` |
| #113 | fix(security): enforce login IP limit and post-audit deployment fixes | `5b81d58` (merge `301fe58`) |

## Qué cubrió realmente #113

Título fusionado: “fix(security): enforce login IP limit and post-audit deployment fixes”.

Incluye:

- **Límite de IP en el login** y presupuesto de intentos antes de scrypt (`functions/admin/login.js`, `packages/auth/src/login-rate-limit.ts`).
- **Scrypt asíncrono y concurrencia acotada**: el commit `4c6e9fd` está dentro de #113 (`packages/auth/src/password.ts`, `functions/_shared/login-concurrency.js`, tests `password-scrypt.test.ts`, `login-concurrency.test.ts`).
- **Correcciones de despliegue/post-auditoría**: `PORTALESS_PUBLIC_URL` obligatoria, proxy confiable documentado, allowlist de entorno del hijo de publicación (M-08), runtime Node no bloqueante/streaming (M-09), paridad de schema (M-10), validación de dominio de identidad (E-03), y docs de protocolo.
- **Path traversal**: no hubo un cambio específico de path traversal en #113. El runtime ya tenía la comprobación `candidate.startsWith(root + sep)` en `staticResponse`/`staticFileExists`; #113 la conservó al pasar a `fs.promises` y streaming. Evidencia: `server/node-runtime.mjs:141` y `server/node-runtime.mjs:143` (estado actual) y diff de #113 que mantiene la comprobación.

## Comparación con documentos

- `ROADMAP.md`: registra P0/P1 cerrados y P2 abiertos; la sección de seguridad lista A-01 como `[x]` con residual. Coherente con #111–#113.
- `CHANGELOG.md`: no lista #111–#113 por número; los agrupa en “Post-release audit hardening (P0–P3)” y en Unreleased (G2/G4/LTP). No hay un bloque Unreleased específico para la auditoría P0/P1.
- `README.md`: la tabla de estado dice “P0 + P1 auth/web closed; P2 findings remain open”, coherente.
- “PR #113 de auditoría”: **existe**, ya fusionado en `main` (`301fe58`). No es un PR abierto.

## Hallazgo

El informe de campo menciona un “PR #113” de auditoría; se localizó y está fusionado. No hay discrepancia de estado, solo falta de detalle en CHANGELOG sobre el número de PR.
