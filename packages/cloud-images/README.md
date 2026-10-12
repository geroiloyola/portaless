# @portaless/cloud-images

**Cloud Images + APW como SSOT criptografico** (ROADMAP, "C2PA sin
autoridad central"): cada imagen hospedada lleva un sidecar firmado con la
clave `did:apw` del sitio — hash del contenido (sha256), timestamp de
existencia criptografico (`signedAt` dentro del JCS firmado), la
SiteTrustScore publica contemporanea y el `declaredOrigin`
(`human` | `ai` | `mixed`).

- Formato de payload/sidecar, firma/verificacion y embedding PNG
  (chunk privado `pAPW` + sidecar `.json`): `src/`.
- Registro + bytes en la tabla `cloud_images` (D1/SQLite/InMemory).
- Endpoints: upload con firma automatica (`/admin/api/cloud-images`),
  serve (`/images/:id`), verificacion publica local
  (`/trust/images/:id`) y verificacion standalone contra el registro APW
  (`POST /trust/images/verify`).

Estado real, limites honestos y lo que falta (R2, moderacion, EXIF, UI):
`docs/architecture/cloud-images.md`.
