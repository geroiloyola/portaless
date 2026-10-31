# Dónde mantener el nodo Portaless

Opciones para alojar el nodo. Costos sin cifras no verificadas: se citan solo límites y lo que exige cada opción. Para migraciones, ver la sección final.

## Opción A — PC + Cloudflare Tunnel

- Qué es: el nodo corre en el equipo del operador y se expone con `cloudflared`.
- Límites: el sitio depende de que el equipo esté encendido y de la red del operador; no hay SLA; el equipo es la superficie de ataque.
- Costo: sin hosting pago; depende de la electricidad y del plan de Cloudflare Tunnel (ver documentación del proveedor).
- Verificación: parcial. La guía de Windows 10 existe como borrador (`self-hosting-cloudflare-tunnel-windows.md`); no hay prueba de campo reproducible con Trust Layer apagado.

## Opción B — Servidor con o sin Docker + cloudflared

- Qué es: un servidor (VPS, máquina dedicada o Raspberry Pi) corre el contenedor o el runtime Node y se expone con `cloudflared` o directamente.
- Límites: requiere administración del servidor (actualizaciones, backups, firewall); si se expone directo, el puerto queda accesible desde la red.
- Costo: costo del servidor; Cloudflare Tunnel puede ser gratuito según el plan del proveedor.
- Verificación: Docker, Railway y Render están documentados; un servidor genérico no tiene prueba de campo registrada.

## Opción C — Cloudflare Pages + D1

- Qué es: sitio estático en Cloudflare Pages con autenticación/persistencia en D1.
- Límites: no ejecuta el runtime Node self-hosted; no expone `/trust/:siteId` con SQLite local; las funciones corren en Workers (aislados, sin sockets UDP/TCP nativos para DNS). La identidad y el ledger viven en D1.
- Costo: según el plan de Cloudflare Pages/D1; no se citan cifras no verificadas.
- Verificación: documentado en `DEPLOY_CLOUDFLARE_PAGES.md`; no hay prueba de campo de un nodo real en esta fecha.

## Opción D — Nodo privado + proyección estática

- Qué es: el nodo canónico queda privado (sin puertos públicos, opcionalmente Tailscale) y se publica una proyección estática a GitHub Pages o Cloudflare Pages.
- Límites: requiere dos piezas (nodo + proyección) y un proceso de publicación (`npm run publish`); la identidad APW no se resuelve desde la proyección estática porque `/.well-known/*` son funciones, no archivos estáticos.
- Costo: hosting estático gratuito + costo del nodo privado.
- Verificación: el mecanismo de publicación está implementado y testeado; no hay prueba de campo completa.

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
