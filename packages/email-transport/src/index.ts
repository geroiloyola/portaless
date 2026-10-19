// @portaless/email-transport -- contrato + transporte de email transaccional.
//
// Un solo paquete para las dos mitades de la capacidad `email:send`:
//   - config.ts: el modelo tipado (proveedor, plantillas aprobadas, `from`) y su
//     saneamiento/interpolacion. Puro (sin SQLite) para que el build estatico y
//     los tests lo importen sin arrastrar better-sqlite3.
//   - send.ts: el transporte real (webhook / SMTP), que SIEMPRE inyecta el
//     `from` del sitio.
//
// Nacio de la review (R-arch): antes la config vivia en `dashboard` y el
// transporte en `plugin-sandbox`, con una dependencia cruzada invertida. Ahora
// ambos son un modulo neutro que consumen `plugin-sandbox` (la capacidad),
// `functions/admin/api/email.js` (el panel) y los tests.
export * from "./config";
export * from "./send";
