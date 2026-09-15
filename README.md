<div align="center">

# Portaless

**Less Portals, More Simplicity**

Un CMS ligero, open source y modular — pensado para publicarse sin hosting pagado, sin plugins que rompan el sitio, y con control real sobre qué agentes de IA acceden a tu contenido.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Status: Alpha](https://img.shields.io/badge/status-alpha%20%2F%20MVP-orange.svg)](./ROADMAP.md)
[![Astro](https://img.shields.io/badge/built%20with-Astro-ff5a03.svg)](https://astro.build)

[Roadmap](./ROADMAP.md) · [Whitepaper](./docs/whitepaper/portaless-whitepaper.md) · [Seguridad](./SECURITY.md) · [Contribuir](./CONTRIBUTING.md)

</div>

---

## ¿Qué es Portaless?

Portaless es un CMS construido sobre [Astro](https://astro.build) que resuelve, por diseño arquitectónico, los problemas estructurales más persistentes de WordPress:

- **Sin base de datos expuesta ni servidor propio que administrar** — el sitio se compila a HTML estático y se sirve desde infraestructura gratuita (GitHub Pages, Cloudflare Pages).
- **Plugins sandboxeados con permisos atómicos**, en vez de acceso irrestricto al core (la causa del 96% de las vulnerabilidades históricas de WordPress).
- **Control granular sobre agentes de IA**: identificación criptográfica de bots, políticas de cobro por scraping, y un ledger público de trazabilidad.
- **Editor visual propio (Atomic Elements)**, pensado para ser radicalmente más liviano que Elementor.
- **Dashboard modular con "skins"** intercambiables sin escribir CSS ni PHP.

> **Estado actual: alpha / MVP.** No todo lo descrito en el whitepaper está implementado todavía. Antes de usarlo en producción, lee la sección [Estado real por módulo](#estado-real-por-módulo) y el [`ROADMAP.md`](./ROADMAP.md).

---

## Índice

- [Características](#características)
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
| **Trust Layer** | Identificación de agentes de IA (Web Bot Auth), políticas de acceso (`allow`/`charge`/`block`) y ledger de trazabilidad |
| **Plugin Sandbox** | Aislamiento de plugins multi-proveedor (Cloudflare, Deno Deploy, Fastly, o self-hosted con `isolated-vm`) |
| **Centro de Permisos** | Control atómico de capacidades por plugin/agente, igual que la pantalla de Privacidad de iOS/Android |
| **Autenticación** | Login usuario/contraseña con roles (`admin`/`viewer`), persistencia real en D1 o SQLite |

## Estado real por módulo

Este proyecto documenta explícitamente qué está implementado y qué es un esqueleto pendiente. No asumas funcionalidad por el nombre de una carpeta — consulta [`AGENT.md`](./AGENT.md) y [`ROADMAP.md`](./ROADMAP.md) para el detalle vivo. Resumen:

| Módulo | Estado |
|---|---|
| Motor de contenido, comercio (lectura), Atomic Elements, Dashboard | ✅ Funcional |
| Autenticación (login + persistencia D1/SQLite) | ✅ Funcional (sin 2FA/OAuth) |
| Centro de Permisos, Trust Layer (políticas) | 🟡 UI funcional, persistencia de permisos/ledger aún en memoria |
| Sandboxing de plugins (4 adaptadores) | 🟡 `isolated-vm` (self-hosted) ejecuta código real con pool de isolates y 10/12 capacidades con puente real (faltan `content:read`/`content:write`); Cloudflare Workers for Platforms y Deno Deploy ahora hacen la llamada real a sus APIs (sin verificar contra cuenta real, solo tests con `fetch` mockeado); Fastly sigue siendo solo contrato + TODOs detallados, sin llamada real a su API |
| Verificación criptográfica Web Bot Auth | ✅ Valida firma Ed25519 (RFC 9421) con cache del directorio de claves y verificación de unicidad de nonce |
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
git clone https://github.com/linstarkcorp/portaless.git
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
git clone https://github.com/linstarkcorp/portaless.git
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

git clone https://github.com/linstarkcorp/portaless.git
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

---

## Configuración

Todas las variables de entorno son opcionales — Portaless funciona sin configurar nada, sirviendo solo el sitio estático base.

| Variable | Módulo | Descripción |
|---|---|---|
| `ENABLE_COMMERCE` | Comercio | `true` para activar `/tienda` (requiere `src/commerce/config.ts`, ver [`docs/COMMERCE_SETUP.md`](./docs/COMMERCE_SETUP.md)) |
| `ENABLE_TRUST_LAYER` | Trust Layer | `true` para activar la verificación de agentes de IA en `functions/_middleware.js` |
| `PORTALESS_ADMIN_USERNAME` / `PORTALESS_ADMIN_PASSWORD` | Autenticación | Credenciales del primer usuario admin, usadas por `create-admin.ts` |
| `PORTALESS_SQLITE_PATH` | Autenticación | Ruta a un archivo SQLite para persistencia self-hosted (requiere Node 22.5+) |
| `DB` (binding, no env var tradicional) | Autenticación | Binding de Cloudflare D1, configurado en `wrangler.toml` |

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
│   ├── auth/                # Autenticación (login, roles, persistencia)
│   ├── commerce-plugin/    # Manifiesto de referencia del módulo de comercio
│   ├── mcp-server/         # Stub — no implementado
│   ├── identity-atproto/   # Stub — no implementado
│   └── apw-resolver/       # Stub — no implementado
├── functions/              # Cloudflare Pages Functions (middlewares, login)
├── docs/                   # Whitepaper, arquitectura, guías de deploy
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

Ver guía completa: [`docs/DEPLOY_CLOUDFLARE_PAGES.md`](./docs/DEPLOY_CLOUDFLARE_PAGES.md). Necesario si quieres usar `functions/` (middlewares, sandboxing, login) — GitHub Pages no soporta funciones edge.

---

## Autenticación

```bash
# Self-hosted con SQLite
PORTALESS_ADMIN_USERNAME=admin \
PORTALESS_ADMIN_PASSWORD=una-contraseña-de-al-menos-8-caracteres \
PORTALESS_SQLITE_PATH=./portaless-auth.sqlite \
node --experimental-strip-types packages/auth/scripts/create-admin.ts
```

Luego visita `/admin/login`. Ver [`docs/architecture/authentication.md`](./docs/architecture/authentication.md) para el detalle completo, incluyendo el flujo con Cloudflare D1 y las limitaciones honestas de este MVP (sin 2FA, sin OAuth, sin recuperación de contraseña todavía).

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

[MIT](./LICENSE) — úsalo, modifícalo, bifúrcalo, vende servicios sobre él, sin restricciones de copyleft.

---

<div align="center">

**Portaless** — menos portales aislados, más facilidad real para crear los que valga la pena crear.

</div>
