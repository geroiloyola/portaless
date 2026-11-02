# Dónde mantener el nodo Portaless

Cuatro perfiles de despliegue. No se promete “apto para empresas”. Faltan revisión externa de seguridad, copias de seguridad probadas, actualización probada en producción y alta disponibilidad (ausente con SQLite).

## Perfiles

### 1. Estático (GitHub Pages)

- Qué es: se publica solo el HTML/CSS/JS generado por Astro en GitHub Pages.
- Qué corre: el sitio público. No hay Functions, panel autenticado, Trust Layer en runtime ni MCP.
- Límites: no hay administración ni identidad APW resoluble con el nodo apagado (los `/.well-known/*` son Functions). La publicación se hace desde un nodo Node aparte.
- Costo: hosting estático; no se citan cifras no verificadas.
- Estado: build y Playwright locales; sin prueba de campo de una publicación real.

### 2. Borde (Cloudflare Pages + D1)

- Qué es: Cloudflare Pages ejecuta las Functions y D1 guarda autenticación, páginas, ledger e identidad.
- Qué corre: sitio, panel, Trust Layer, APIs y `/.well-known/*` mientras Cloudflare esté activo. **No hay máquina propia ni túnel.**
- Límites: D1 y Workers tienen límites de plataforma; no hay runtime Node self-hosted; MCP sigue siendo un proceso/servidor aparte; la publicación integrada que invoca `npm run publish` es Node-only.
- Costo: según el plan de Cloudflare; no se citan cifras no verificadas.
- Estado: documentado en `DEPLOY_CLOUDFLARE_PAGES.md`; sin prueba de campo real en esta fecha.

### 3. Autoalojado (PC o servidor, con túnel o proxy)

- Qué es: el runtime Node corre en una máquina del operador y se expone con `cloudflared` o un proxy.
- Qué corre: sitio, panel, Trust Layer, MCP (proceso aparte), publicación integrada, plugins/sandbox y `/.well-known/*` mientras la máquina esté encendida.
- Límites: depende de que el equipo esté encendido y de la red del operador; no hay SLA; el equipo es superficie de ataque. `HOST=127.0.0.1` si se expone solo por túnel.
- Costo: costo de la máquina/electricidad; el túnel según el plan del proveedor.
- Estado: Docker Compose probado localmente; Railway/Render documentados pero **no verificados en producción**; Windows 10 + túnel es un borrador.

### 4. Combinado (nodo privado + proyección estática pública)

- Qué es: el nodo canónico queda privado (sin puertos públicos, opcionalmente Tailscale) y se publica una copia estática a GitHub Pages o Cloudflare Pages.
- Qué corre: todo en el nodo privado; la copia pública sirve el sitio. La identidad offline requiere PR-D (hoy no resuelve desde la copia).
- Límites: dos piezas y un proceso de publicación (`npm run publish`); la copia puede quedar desactualizada respecto del nodo.
- Costo: hosting estático + costo del nodo privado.
- Estado: mecanismo de publicación probado localmente; sin prueba de campo completa.

## Matriz de funciones por perfil

| Función | Estático (GitHub Pages) | Borde (Cloudflare Pages + D1) | Autoalojado (PC/servidor) | Combinado (nodo privado + proyección) |
|---|---|---|---|---|
| Panel de administración | No (sin Functions) | Sí (Cloudflare) | Sí | Sí (solo en el nodo privado) |
| Trust Layer | No | Sí | Sí | Sí (nodo); no en la copia |
| MCP | No | No (proceso/servidor aparte) | Sí (proceso aparte) | Sí (nodo) |
| Publicación integrada | No | No (Node-only) | Sí | Sí (nodo publica a la copia) |
| Plugins/sandbox | No | Parcial (adaptadores edge; installer off; sin cuenta real) | Sí (`isolated-vm`) | Sí (nodo) |
| Identidad con nodo apagado | No hoy; PR-D | Sí (Cloudflare activo) | No | No hoy; PR-D en la copia |
| Motor LTP (`ltp-engine`) | Inactivo | Inactivo | Inactivo | Inactivo |
| Límites | Sin admin/identidad runtime | D1/Workers; sin Node | Disponibilidad del equipo; administración | Dos piezas; frescura de la copia |
| Verificación real | Build/Playwright local | Docs, sin campo | Docker local; Railway/Render no verificado | Publicación local; campo pendiente |

## Migración de un nodo SQLite a otro servidor

Qué copiar:

- `data/` (base SQLite y archivos asociados).
- `.env` (con `PORTALESS_PUBLIC_URL`, `PORTALESS_TRUSTED_PROXIES`, claves).
- La clave de cifrado `PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY` (fuera del volumen).
- La identidad se conserva porque vive en la base y se descifra con la clave.

Cómo comprobar después:

1. Arrancar el nodo nuevo con los mismos `PORTALESS_PUBLIC_URL` y clave.
2. Ejecutar `npm run doctor` (o `docker compose exec portaless npm run doctor`).
3. Verificar que `GET /admin/api/apw-verification-status` reporte el mismo `domain` y, si había identidad, el mismo `did`.
4. Confirmar el hash `h` del historial si estaba anclado.
5. Usar `npm run backup` antes de migrar y `npm run backup -- verify <backup-dir>` después.

Migración a D1:

- No hay migración automática de SQLite a D1 documentada como completa. Existe `setup:d1` para bases vacías y `migrate:d1` para aplicar migraciones a D1 remoto.
- Falta una herramienta de exportación/importación de datos de usuario, páginas y ledger desde SQLite a D1. Hasta que exista, la migración es manual.
- La identidad (`site_identity`) y los secretos deben recrearse o copiarse con cuidado; la clave de cifrado debe coincidir.

## Corrección de terminología

- **Cloudflare Pages** ejecuta el código en Cloudflare; no usa una máquina del operador ni un túnel.
- **Cloudflared** expone un nodo que corre en la máquina del operador; no es Cloudflare Pages.
- “Pages con túnel” no es un perfil válido y no se documenta como tal.
