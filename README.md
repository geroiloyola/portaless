<div align="center">

# Portaless

**Less Portals, More Simplicity**

Un CMS ligero, open source y modular — pensado para publicarse sin hosting pagado, sin plugins que rompan el sitio, y con control real sobre qué agentes de IA acceden a tu contenido.

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![Status: Alpha](https://img.shields.io/badge/status-alpha%20%2F%20MVP-orange.svg)](./ROADMAP.md)
[![Astro](https://img.shields.io/badge/built%20with-Astro-ff5a03.svg)](https://astro.build)

[Roadmap](./ROADMAP.md) · [Whitepaper](./docs/whitepaper/portaless-whitepaper.md) · [Seguridad](./SECURITY.md) · [Licenciamiento](./docs/architecture/licensing-boundaries.md) · [Contribuir](./CONTRIBUTING.md)

</div>

---

## ¿Qué es Portaless?

Portaless es un CMS construido sobre [Astro](https://astro.build) que resuelve, por diseño arquitectónico, los problemas estructurales más persistentes de WordPress:

- **Sin base de datos expuesta ni servidor propio que administrar** — el sitio se compila a HTML estático y se sirve desde infraestructura gratuita (GitHub Pages, Cloudflare Pages).
- **Plugins sandboxeados con permisos atómicos**, en vez de acceso irrestricto al core (la causa del 96% de las vulnerabilidades históricas de WordPress).
- **Control granular sobre agentes de IA**: identificación criptográfica de bots, políticas de cobro por scraping, y un ledger público de trazabilidad.
- **Editor visual propio (Atomic Elements)**, pensado para ser radicalmente más liviano que Elementor.
- **Dashboard modular con "skins"** intercambiables sin escribir CSS ni PHP.
- **Cuentas protegidas de verdad**: verificación en dos pasos, recuperación de contraseña, e inicio de sesión con proveedores externos (Google, GitHub, etc.).

> **Estado actual: alpha / MVP.** No todo lo descrito en el whitepaper está implementado todavía. Antes de usarlo en producción, lee la sección [Estado real por módulo](#estado-real-por-módulo) y el [`ROADMAP.md`](./ROADMAP.md).

---

## Índice

- [Características](#características)
- [Novedades recientes](#novedades-recientes)
- [Estado real por módulo](#estado-real-por-módulo)
- [Instalación](#instalación)
  - [macOS](#macos)
  - [Linux](#linux)
  - [Windows](#windows)
- [Primeros pasos](#primeros-pasos)
- [Configuración](#configuración)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Despliegue](#despliegue)
- [Autenticación](#autenticación)
- [Licenciamiento](#licenciamiento)
- [Roadmap](#roadmap)
- [Seguridad](#seguridad)
- [Contribuir](#contribuir)
- [Licencia](#licencia)

---

## Características

| Módulo | Qué hace |
|---|---|
| **Motor de contenido** | Astro + Markdown, sitio 100% estático, sin runtime de servidor obligatorio |
| **Atomic Elements** | Editor visual de arrastrar-y-soltar para páginas, sin la profundidad de DOM ni el peso de Elementor |
| **Dashboard + Skin System** | Panel de administración modular: cada "skin" reordena los mismos componentes vía un JSON, sin tocar código |
| **Comercio (Medusa/Mercur)** | Módulo opcional que consume el catálogo de una tienda externa — nunca reimplementa checkout ni pagos |
| **Trust Layer** | Identificación de agentes de IA (Web Bot Auth), políticas de acceso (`allow`/`charge`/`block`) y ledger de trazabilidad, ahora consultable públicamente |
| **Plugin Sandbox** | Aislamiento de plugins multi-proveedor (Cloudflare, Deno Deploy, Fastly, o self-hosted con `isolated-vm`), con las 12 capacidades del catálogo conectadas de verdad |
| **Centro de Permisos** | Control atómico de capacidades por plugin/agente, igual que la pantalla de Privacidad de iOS/Android — ya conectado a persistencia real |
| **Autenticación** | Login usuario/contraseña con roles (`admin`/`viewer`), verificación en 2 pasos, recuperación de contraseña, e inicio de sesión con proveedores externos (OAuth/SSO) |

## Novedades recientes

Un resumen sin tecnicismos de lo que se agregó en las últimas versiones (v0.0.9 a v0.0.9.4), para quien no sigue el `ROADMAP.md` línea por línea:

- **Los plugins ya pueden leer y escribir contenido del sitio.** Antes, aunque le dieras permiso a un plugin para tocar el contenido de una página desde el Centro de Permisos, esa acción no funcionaba de verdad — solo existía el "no". Ahora el "sí" también funciona, siempre dentro del sandbox aislado.
- **Tu cuenta de administrador está mejor protegida.** Se agregó verificación en dos pasos (el típico código de 6 dígitos de una app como Google Authenticator), un flujo para recuperar la contraseña si la olvidas, e inicio de sesión con proveedores externos (Google, GitHub, o cualquier otro que configures) — sin necesitar crear otra contraseña.
- **Instalar Portaless por primera vez es un solo comando.** Antes había que aplicar 4 archivos SQL distintos a mano y crear el usuario administrador con un script separado. Ahora `npm run setup` hace las dos cosas de una vez (para instalaciones self-hosted con SQLite).
- **La licencia cambió de MIT a AGPL-3.0.** Esto protege que Portaless siga siendo un proyecto abierto: cualquiera puede instalarlo y usarlo gratis, pero si alguien toma el código, lo modifica, y lo ofrece como servicio a terceros, tiene que compartir esos cambios de vuelta. Los plugins de terceros (incluidos los que vendas o los que sean de código cerrado) siguen sin ninguna obligación de este tipo, porque corren aislados del núcleo — ver [`docs/architecture/licensing-boundaries.md`](./docs/architecture/licensing-boundaries.md) para el detalle completo.
- **El registro de actividad de agentes de IA ya se puede consultar.** El Trust Layer llevaba tiempo registrando qué agentes visitan tu sitio, pero esa información no se podía ver desde ningún lado. Ahora existe una URL pública (`/.well-known/portaless-usage-log.json`) que la muestra, igual que ya pasaba con la política de contenido.
- **El Centro de Permisos ahora guarda los cambios de verdad.** Antes de v0.0.9.2, otorgar o revocar un permiso desde el panel era solo visual y no se guardaba en ningún lado permanente. Ahora sí persiste, con la misma protección de "solo administradores pueden cambiar esto" que el resto del panel.
- **Cloudflare Workers y Deno Deploy ya tienen integración real** (no solo un boceto) para correr plugins en la nube de esos proveedores, aunque todavía no se probó contra una cuenta real — falta ese último paso de verificación práctica.

## Estado real por módulo

Este proyecto documenta explícitamente qué está implementado y qué es un esqueleto pendiente. No asumas funcionalidad por el nombre de una carpeta — consulta [`AGENT.md`](./AGENT.md) y [`ROADMAP.md`](./ROADMAP.md) para el detalle vivo. Resumen:

| Módulo | Estado |
|---|---|
| Motor de contenido, comercio (lectura), Atomic Elements, Dashboard | ✅ Funcional |
| Autenticación (login + persistencia D1/SQLite + 2FA + recuperación de contraseña + OAuth/SSO) | ✅ Funcional — ver nota de integración pendiente en [`docs/architecture/authentication.md`](./docs/architecture/authentication.md) |
| Centro de Permisos | ✅ UI conectada a persistencia real (D1/SQLite) vía `functions/admin/permissions/index.js`, con guard server-side `canWrite(role)` — catálogo de plugins aún sembrado a mano, ver [`PERMISSIONS_CENTER.md`](./packages/permissions/docs/PERMISSIONS_CENTER.md) |
| Trust Layer (políticas + ledger) | ✅ Escritura conectada desde v0.0.6, lectura pública conectada en v0.0.9.3 vía `GET /.well-known/portaless-usage-log.json` — ver [`TRUST_LAYER_SETUP.md`](./packages/trust-layer/docs/TRUST_LAYER_SETUP.md) |
| Sandboxing de plugins (4 adaptadores) | 🟡 `isolated-vm` (self-hosted) ejecuta código real con pool de isolates y **12/12 capacidades con puente real** (incluye `content:read`/`content:write` desde v0.0.9.4); Cloudflare Workers for Platforms y Deno Deploy hacen la llamada real a sus APIs (sin verificar contra cuenta real todavía, solo tests con `fetch` mockeado); Fastly sigue siendo solo contrato + TODOs detallados, sin llamada real a su API |
| Verificación criptográfica Web Bot Auth | ✅ Valida firma Ed25519 (RFC 9421) con cache del directorio de claves y verificación de unicidad de nonce |
| Instalación / puesta en marcha | ✅ Comando único (`npm run setup`) para SQLite self-hosted — Cloudflare D1 sigue usando `wrangler d1 execute` por separado |
| MCP nativo, Identidad AT Protocol, Protocol APW | ❌ Solo stubs / diseño documentado |

---

## Instalación

### Requisitos previos

- **Node.js ≥ 20** (recomendado **22.5+** si quieres persistencia SQLite self-hosted vía `node:sqlite`, sin dependencias compiladas).
- **Git**.
- Una cuenta de **GitHub** o **Cloudflare** si vas a desplegar (ambos tienen planes gratuitos suficientes).

### macOS

```bash
# Instalar Node.js (via Homebrew)
brew install node@22

# Clonar el repositorio
git clone https://github.com/geroiloyola/portaless.git
cd portaless

# Instalar dependencias (usa npm workspaces para los packages/*)
npm install
```

### Linux

```bash
# Debian/Ubuntu — instalar Node.js 22.x via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Fedora/RHEL
sudo dnf install nodejs git

# Clonar y instalar
git clone https://github.com/geroiloyola/portaless.git
cd portaless
npm install
```

### Windows

**Opción recomendada: WSL2** (Windows Subsystem for Linux), para evitar problemas de rutas y permisos con Astro y `node:sqlite`:

```powershell
wsl --install
```

Luego, dentro de la terminal de WSL (Ubuntu), sigue los pasos de la sección **Linux** de arriba.

**Alternativa sin WSL** (PowerShell):

```powershell
# Instalar Node.js desde https://nodejs.org (elige la version 22 LTS)
# o via winget:
winget install OpenJS.NodeJS.LTS

git clone https://github.com/geroiloyola/portaless.git
cd portaless
npm install
```

---

## Primeros pasos

```bash
# Levantar el servidor de desarrollo
npm run dev
```

Abre [http://localhost:4321](http://localhost:4321) — deberías ver el sitio de ejemplo con el blog inicial.

```bash
# Compilar para producción (genera ./dist)
npm run build

# Previsualizar el build de producción localmente
npm run preview
```

Si vas a usar el panel de administración (`/admin`) en un despliegue self-hosted con SQLite, corre además:

```bash
# Crea las tablas necesarias y el primer usuario admin, en un solo paso
npm run setup
```

Ver la sección [Autenticación](#autenticación) para el detalle completo, incluyendo el flujo equivalente para Cloudflare D1.

---

## Configuración

Todas las variables de entorno son opcionales — Portaless funciona sin configurar nada, sirviendo solo el sitio estático base.

| Variable | Módulo | Descripción |
|---|---|---|
| `ENABLE_COMMERCE` | Comercio | `true` para activar `/tienda` (requiere `src/commerce/config.ts`, ver [`docs/COMMERCE_SETUP.md`](./docs/COMMERCE_SETUP.md)) |
| `ENABLE_TRUST_LAYER` | Trust Layer | `true` para activar la verificación de agentes de IA en `functions/_middleware.js` |
| `PORTALESS_ADMIN_USERNAME` / `PORTALESS_ADMIN_PASSWORD` | Autenticación | Credenciales del primer usuario admin, usadas por `npm run setup` |
| `PORTALESS_SQLITE_PATH` | Autenticación | Ruta a un archivo SQLite para persistencia self-hosted (requiere Node 22.5+) |
| `PORTALESS_OAUTH_<PROVEEDOR>_CLIENT_ID` / `_CLIENT_SECRET` / `_AUTH_URL` / `_TOKEN_URL` / `_USERINFO_URL` | Autenticación (OAuth/SSO) | Configuración de cada proveedor externo de login (ej. `PORTALESS_OAUTH_GOOGLE_CLIENT_ID`) — sin esto, el inicio de sesión con ese proveedor simplemente no aparece disponible |
| `PORTALESS_DEV_MODE` | Autenticación (recuperación de contraseña) | `1` para que el endpoint de recuperación devuelva el token en la respuesta, útil solo en desarrollo local sin servidor de correo configurado |
| `DB` (binding, no env var tradicional) | Autenticación, Permisos, Trust Layer, Páginas | Binding de Cloudflare D1, configurado en `wrangler.toml` |

Copia `src/commerce/config.example.ts` a `config.ts` si vas a activar comercio.

---

## Estructura del proyecto

```
portaless/
├── src/                    # Sitio Astro (páginas, contenido, layouts, comercio)
├── packages/
│   ├── atomic-elements/    # Editor visual de páginas
│   ├── dashboard/          # Panel admin + Skin System
│   ├── permissions/        # Centro de Permisos
│   ├── plugin-sandbox/     # Sandboxing multi-proveedor
│   ├── trust-layer/        # Identificación de agentes de IA
│   ├── auth/                # Autenticación (login, roles, 2FA, recuperación, OAuth, persistencia)
│   ├── commerce-plugin/    # Manifiesto de referencia del módulo de comercio
│   ├── mcp-server/         # Stub — no implementado
│   ├── identity-atproto/   # Stub — no implementado
│   └── apw-resolver/       # Stub — no implementado
├── functions/              # Cloudflare Pages Functions (middlewares, login, OAuth, recuperación)
├── scripts/                # Instalación (schema.sql + admin inicial en un comando)
├── docs/                   # Whitepaper, arquitectura, guías de deploy, fronteras de licencia
├── examples/               # Configuraciones de referencia (blog, landing, tienda)
├── tests/                  # Pruebas unitarias y e2e
└── ROADMAP.md              # Estado priorizado del proyecto
```

Ver [`docs/architecture/REPO_STRUCTURE_MAP.md`](./docs/architecture/REPO_STRUCTURE_MAP.md) si buscas algo y no está donde esperarías.

---

## Despliegue

### GitHub Pages (gratis)

Ver guía completa: [`docs/DEPLOY_GITHUB_PAGES.md`](./docs/DEPLOY_GITHUB_PAGES.md). El workflow en `.github/workflows/ci.yml` construye el sitio automáticamente en cada push a `main`.

### Cloudflare Pages (gratis, recomendado si usas Trust Layer o autenticación con D1)

Ver guía completa: [`docs/DEPLOY_CLOUDFLARE_PAGES.md`](./docs/DEPLOY_CLOUDFLARE_PAGES.md). Necesario si quieres usar `functions/` (middlewares, sandboxing, login, OAuth, recuperación de contraseña) — GitHub Pages no soporta funciones edge.

---

## Autenticación

```bash
# Self-hosted con SQLite -- aplica el esquema de base de datos Y crea el
# primer usuario admin, en un solo comando
PORTALESS_ADMIN_USERNAME=admin \
PORTALESS_ADMIN_PASSWORD=una-contraseña-de-al-menos-8-caracteres \
PORTALESS_SQLITE_PATH=./portaless.db \
npm run setup
```

Luego visita `/admin/login`. Desde ahí también puedes:

- Activar **verificación en dos pasos** (2FA) para tu cuenta.
- Recuperar tu contraseña si la olvidaste, vía `/admin/password-reset`.
- Iniciar sesión con un proveedor externo configurado (`/admin/oauth/<proveedor>/start`), si agregaste sus variables de entorno.

Para Cloudflare D1, aplica el esquema con `wrangler d1 execute <NOMBRE_DB> --file=schema.sql` — el primer usuario admin se crea automáticamente la primera vez que el sistema detecta que no existe ninguno.

Ver [`docs/architecture/authentication.md`](./docs/architecture/authentication.md) para el detalle completo, incluyendo las limitaciones honestas que quedan (ver [`ROADMAP.md`](./ROADMAP.md) para el estado exacto de cada pieza).

---

## Licenciamiento

Portaless (el núcleo: CMS, dashboard, autenticación, Trust Layer, Centro de Permisos, motor del sandbox) se distribuye bajo **AGPL-3.0**. En términos simples: puedes instalarlo, usarlo, y modificarlo libremente, incluso en un negocio propio — la única obligación aparece si tomas una versión modificada del núcleo y la ofreces como servicio en línea a terceros, en cuyo caso debes compartir esos cambios.

Los **plugins de terceros** (vendidos, gratuitos, o de código cerrado) no tienen esa obligación, siempre que corran dentro del sandbox aislado y solo usen la API pública documentada — es exactamente el mismo principio que permite vender plugins cerrados de WordPress. Ver [`docs/architecture/licensing-boundaries.md`](./docs/architecture/licensing-boundaries.md) para la explicación completa, incluyendo preguntas frecuentes para quien quiera desarrollar o vender plugins.

---

## Roadmap

El estado priorizado y actualizado del proyecto vive en [`ROADMAP.md`](./ROADMAP.md), con tres niveles:

- 🔴 **Alta prioridad** — bloquea que el proyecto sea "funcional" en el corto plazo.
- 🟡 **Prioridad media** — mejora sustancial, parcialmente alcanzable.
- ⚪ **Baja prioridad** — fuera de alcance de corto plazo (MCP nativo, identidad AT Protocol, Protocol APW, cobro real vía Pay per Crawl).

---

## Seguridad

Ver [`SECURITY.md`](./SECURITY.md) para vulnerabilidades conocidas y activas en este MVP, incluyendo el manejo de la CVE real de `isolated-vm` (GHSA-864f-rcv7-6rh4) y las limitaciones actuales de la verificación criptográfica del Trust Layer. Para reportar una vulnerabilidad, no abras un Issue público — contacta directamente a los mantenedores.

---

## Contribuir

Lee [`CONTRIBUTING.md`](./CONTRIBUTING.md) y [`AGENT.md`](./AGENT.md) (este último especialmente si vas a usar un agente de IA para contribuir — contiene el mapa de estado real de cada módulo). Todo cambio va en una rama con Pull Request, nunca commit directo a `main`.

---

## Licencia

[AGPL-3.0](./LICENSE) para el núcleo del proyecto — instálalo, modifícalo, y úsalo libremente; si ofreces una versión modificada como servicio a terceros, comparte esos cambios. Los plugins de terceros, incluidos los de código cerrado, se rigen por [`docs/architecture/licensing-boundaries.md`](./docs/architecture/licensing-boundaries.md), no por esta licencia.

---

<div align="center">

**Portaless** — menos portales aislados, más facilidad real para crear los que valga la pena crear.

</div>