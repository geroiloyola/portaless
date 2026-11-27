# Propuesta PR-G — `redirects-map` sin `dist/`

## Hecho verificado

`tests/unit/redirects-map.test.ts:128` usa `it.skipIf(!existsSync(join(repo, "dist")))` para el caso “cada slug de contenido tiene su redireccion emitida tras el build”. El CI de `unit-tests.yml` corre `npx vitest run tests/unit/` sin ejecutar `npm run build` antes (`unit-tests.yml:76`), por eso ese caso aparece como *skipped* en CI y no en local cuando existe `dist/`.

## Opciones

| Opción | Ventajas | Desventajas | Cambia umbrales |
|---|---|---|---|
| A) `npm run build` antes del unit job | El test corre en CI como en local; cubre el build real | Añade ~2 s y requiere que el build no dependa de D1 | No |
| B) Fallo explícito si falta `dist/` | No hay skip silencioso | El job fallaría hasta añadir el build; hay que cambiar el test | No |
| C) Dejarlo como está | Sin cambios | El skip oculta una regresión de redirects estáticos | No |

## Recomendación

**A + B acotado**: ejecutar `npm run build` antes de `npx vitest run tests/unit/` en `unit-tests.yml`, y cambiar el `skipIf` por una aserción explícita que falle con `dist/ missing; run npm run build` solo si el archivo no existe. No se tocan umbrales de cobertura ni tests.

## Fuera de alcance

Este documento no implementa PR-G. PR-G requiere autorización escrita del dueño.
