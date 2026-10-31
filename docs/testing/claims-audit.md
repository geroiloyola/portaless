# Auditoría de afirmaciones (propuestas de redacción)

No cambia textos. Propone redacciones verificables para PR-C.

## Afirmaciones encontradas

| # | Archivo:línea | Afirmación | Propuesta de redacción verificable |
|---|---|---|---|
| 1 | `README.md:33` | “diseñado para ser radicalmente más liviano que Elementor” | “editor visual con 17 elementos; el peso depende del sitio y se mide con el método de `docs/testing/performance-comparison-method.md`.” |
| 2 | `README.md:31` | “la causa documentada de la abrumadora mayoría de las vulnerabilidades históricas de WordPress” | “plugins con acceso sin restricciones al core son una causa frecuente; Portaless ejecuta plugins en sandbox con capacidades concedidas.” |
| 3 | `README.md:108` | “Portaless never touches the money” | Mantener: el código no liquida pagos; la liquidación la hace el proveedor. Añadir “sin proveedor activo, `charge` responde 402.” |
| 4 | `src/content/home.json:74` | “Only if you decide so” | Redacción modelo: “bloquea a lectores automáticos que se declaran y no firman; no detiene a quien aparenta ser un navegador; puede afectar a buscadores y vistas previas.” |
| 5 | `src/content/home.es.json:74` | “Solo si vos lo decidís” | Misma redacción modelo en español. |
| 6 | `src/content/home.json:74` | “no database is exposed to the internet” | “en self-host, la base queda en el nodo; la proyección estática no incluye la base.” |
| 7 | `src/content/home.es.json:45` | “sin una base de datos expuesta a internet” | Igual que #6. |
| 8 | `src/pages/admin/agents.astro:251` | “los buscadores que no firman reciben 403 en contenido” | Mantener, pero aclarar que solo aplica con Trust Layer activo y a rutas no públicas. |
| 9 | `src/pages/admin/agents.astro:257` | “Solo la regla de lectura por IA (ai_input) se aplica en el servidor” | Mantener; es verificable en `functions/_middleware.js`. |
| 10 | `src/pages/admin/agents.astro:269` | “Con bloquear activo ningún agente lee este sitio… Los buscadores y la lectura humana no se ven afectados” | Matizar: “los buscadores declarados sin firma quedan bloqueados en rutas no públicas; la lectura humana no se bloquea.” |
| 11 | `README.md:137` | “lets discovery routes … through without a signature” | Mantener; coincide con `isPublicBotRoute`. |
| 12 | `README.md:150` | “7/12 plugin capabilities have a real execution path” | Mantener; verificar con tests de capability catalog. |

## Comparaciones con WordPress/Ghost

- `README.md:28` compara con WordPress. Redacción propuesta: “resuelve problemas estructurales comunes de CMS tradicionales; no afirma superioridad medida.”
- `docs/COMMERCE_SETUP.md:3` compara comercio con WooCommerce. Redacción propuesta: “trata el comercio como un módulo separado, similar a WooCommerce en concepto.”

## Cifras de usuarios o costos

- No se encontraron cifras de usuarios.
- “gratis” / “sin hosting pago” aparece en `README.md` y home. Redacción propuesta: “puede correr en hosting estático gratuito o autoalojado; el costo depende del proveedor elegido.”
- No citar cifras de costo no verificadas.

## Redacciones modelo

- “bloquea a lectores automáticos que se declaran y no firman; no detiene a quien aparenta ser un navegador; puede afectar a buscadores y vistas previas.”
- “el peso y la velocidad se miden con `docs/testing/performance-comparison-method.md`; no se publican cifras sin medición.”

## Decisión requerida

PR-C aplica solo las redacciones que el dueño apruebe, en los lugares citados. Añadir/actualizar tests de afirmaciones.
