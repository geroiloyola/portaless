# Lecciones aprendidas — Portaless CI/CD (sesion 2026-09-13)

Este archivo documenta errores reales encontrados en GitHub Actions durante
el endurecimiento de CI de Portaless, su diagnostico y la correccion aplicada.
Objetivo: que la proxima vez que aparezca un sintoma parecido, se resuelva en
minutos en vez de rondas de prueba y error.

---

## 1. `Dependencies lock file is not found`

**Sintoma:** `actions/setup-node@v4` con `cache: npm` falla con
`Error: Dependencies lock file is not found in /home/runner/work/...`.

**Causa raiz:** El repo nunca tuvo committeado ningun lockfile
(`package-lock.json`, `yarn.lock`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`).
`cache: npm` en `setup-node@v4` **requiere** un lockfile para saber que
cachear; si no existe, falla duro (no silenciosamente).

**Verificacion util:** `search_code` con `filename:package-lock.json` /
`filename:pnpm-lock.yaml` en el repo confirma ausencia total antes de asumir
cual gestor de paquetes se usa.

**Fix aplicado:** Quitar `cache: npm` de los workflows (`ci.yml`,
`sandbox-e2e.yml`) hasta que exista un lockfile real committeado.

**Fix definitivo pendiente (accion humana, no de IA):** Correr `npm install`
localmente y commitear `package-lock.json` a la raiz. Ahi se puede reactivar
`cache: npm` + `cache-dependency-path: package-lock.json`.

**Leccion:** Antes de agregar `cache: npm` a un workflow nuevo, verificar que
exista un lockfile en el repo. No asumir que "todo repo de Node tiene uno".

---

## 2. `Node.js 20 is deprecated... forced to run on Node.js 24`

**Sintoma:** Warning en cada run, runners forzando Node 24 aunque el workflow
pida Node 20.

**Causa raiz:** GitHub Actions dejo de soportar Node 20 como runtime de
*acciones* (no del codigo del usuario). Pedir `node-version: 20` en
`setup-node` sigue funcionando para el codigo del proyecto, pero genera este
warning cada vez.

**Fix aplicado:** `node-version: '22'` explicito en todos los jobs (LTS activo
al momento de esta sesion).

**Leccion:** Fijar siempre una version LTS activa explicita en
`setup-node`, y revisar el calendario de deprecacion de Node en GitHub
Actions periodicamente, no solo cuando aparece el warning.

---

## 3. `Could not resolve "./config" from "src/commerce/medusa-client.ts"`

**Sintoma:** Build de Astro (`npm run build`) falla en Rollup/Vite: no
resuelve un import relativo.

**Causa raiz:** El repo solo tenia `src/commerce/config.example.ts` (el
patron intencional de "copia este archivo y renombralo" para no commitear
config real). Pero `config.ts` nunca se genero ni se committeo, asi que
**ningun checkout limpio** (como CI) podia resolver el import. Funcionaba en
local unicamente porque cada dev ya habia hecho la copia manual alguna vez.

**Fix aplicado:** Crear `src/commerce/config.ts` con la misma forma exacta de
`config.example.ts` pero valores vacios (`storeUrl: ""`). Con `storeUrl`
vacio el modulo de comercio queda desactivado por diseno: el build nunca
intenta red y compila siempre.

**Leccion:** El patron "`.example.*` + copia manual" es comodo en local pero
**rompe cualquier CI o checkout limpio** si el archivo real nunca se
commitea. Si el contenido no tiene secretos (como una publishable key
publica de Storefront), es mas seguro commitear un `config.ts` real con
valores vacios/seguros por defecto, en vez de depender de un paso manual que
nadie hizo en el repo.

**Leccion meta:** No asumir la forma de un archivo que no se puede leer
directamente. La primera version de este fix (generada sin ver
`config.example.ts` real) uso nombres de campo incorrectos
(`enabled`/`requestTimeoutMs` en vez de `publishableKey`/`pageSize`). Pedir el
contenido exacto antes de escribir evito un segundo error de build.

---

## 4. `No test suite found in file ...test.ts` (con tests que SI corrieron)

**Sintoma:** El log muestra `ok 1`, `ok 2`... `ok 5` en formato TAP (osea los
tests corrieron y pasaron), pero Vitest igual reporta
`Error: No test suite found in file ...` y el proceso termina con exit code 1.

**Causa raiz:** El archivo de test usaba la API nativa de Node
(`import { test } from "node:test"` + `node:assert/strict`), pero el
workflow lo ejecuta con `npx vitest run`. Vitest transpila y ejecuta el
archivo (por eso el motor de `node:test` corre y emite TAP), pero como Vitest
busca especificamente llamadas a **su propia** API (`describe`/`it` de
`"vitest"`) para registrar la suite, no encuentra ninguna y marca el archivo
entero como fallido, incluso con 100% de los tests "pasando" por debajo.

**Fix aplicado:** Migrar el wrapper (no la logica) de cada archivo:
- `import { test } from "node:test"` -> `import { describe, it, expect } from "vitest"`
- `test(nombre, fn)` -> `it(nombre, fn)` dentro de un `describe(...)`
- `assert.equal(a, b)` -> `expect(a).toBe(b)`
- `assert.notEqual(a, b, msg)` -> `expect(a).not.toBe(b)`
- `t.skip(msg)` de `node:test` tiene equivalente directo en Vitest:
  `context.skip(msg)` (mismo nombre, misma semantica, primer argumento del
  callback de `it`).

**Leccion:** Si un proyecto declara `npx vitest run archivo.test.ts` en CI,
TODOS los archivos de test deben usar la API de Vitest, no `node:test`. Un
archivo con la API equivocada puede "correr" (porque Node interpreta el JS
igual) sin que la suite quede registrada donde el runner la busca. Revisar
los imports de cualquier `*.test.ts` nuevo antes de asumir que es compatible
con el runner declarado en el workflow.

---

## 5. Test de sandbox marcado siempre como SKIP (`isolated-vm no esta instalado`)

**Sintoma:** El workflow ya no fallaba, pero los 3 tests E2E del sandbox se
reportaban como `SKIP` en cada corrida, nunca como `pass` real. El mensaje de
skip decia "isolated-vm no esta instalado" aunque SI estaba declarado en
`packages/plugin-sandbox/package.json` (`"isolated-vm": "^7.0.1"`).

**Causa raiz:** El repo raiz declara
`"workspaces": ["packages/*"]` en su `package.json` (npm workspaces). Con
workspaces, npm **hoistea** las dependencias a `node_modules/` de la RAIZ del
monorepo por defecto, no a `packages/plugin-sandbox/node_modules/`. El test
buscaba la version instalada unicamente en la ruta local al workspace
(`packages/plugin-sandbox/node_modules/isolated-vm/package.json`), que con
hoisting queda vacia. El `try/catch` fallaba siempre -> siempre se disparaba
el skip, sin importar que la dependencia estuviera bien instalada en la raiz.

**Fix aplicado (dos partes):**
1. En el workflow: paso explicito
   `npm install --no-save isolated-vm@^7.0.1 --prefix packages/plugin-sandbox`
   antes de correr los tests, para forzar la instalacion (y compilacion de
   binarios nativos via node-gyp) en una ubicacion conocida.
2. En el test: `loadIsolatedVmVersion()` ahora prueba DOS rutas candidatas
   (`packages/plugin-sandbox/node_modules/isolated-vm` y la raiz hoisteada
   `node_modules/isolated-vm`) con `existsSync` antes de leer, en vez de
   asumir una sola ubicacion fija.

**Leccion:** En cualquier monorepo con npm/yarn/pnpm workspaces, nunca asumir
en que `node_modules/` especifico termina una dependencia nativa. Buscar en
la ruta local del workspace Y en la raiz hoisteada, o instalar
explicitamente con `--prefix` en CI para no depender del algoritmo de
resolucion del gestor de paquetes.

---

## 6. `#<Promise> could not be cloned` al hacer fetch real dentro del isolate

**Sintoma:** Con `isolated-vm` ya instalado y corriendo de verdad (2 de 3
tests E2E pasan, incluyendo el que bloquea hosts no autorizados), el test que
hace un fetch real a un host SI autorizado (`api.github.com`) falla con:
`AssertionError: ... Error: #<Promise> could not be cloned.`

**Causa raiz (patron documentado en issues #234/#240/#430 del propio repo de
isolated-vm en GitHub):** Cuando se expone una funcion async al isolate via
`jail.set("nombre", async (...) => {...})` SIN indicarle a isolated-vm que el
resultado es una promesa, isolated-vm intenta clonar el valor de retorno con
el algoritmo de "structured clone" de V8 -- que sabe clonar objetos planos,
arrays, strings, etc., pero NO sabe clonar un objeto `Promise` nativo (no es
serializable). El fix estandar de la comunidad es pasar la opcion
`{ result: { promise: true } }` al registrar la funcion, lo que le dice a
isolated-vm que espere a que la promesa interna resuelva y clone el VALOR
resuelto, no la promesa en si.

**Estado:** RESUELTO. Se agrego `{ result: { promise: true } }` como tercer
argumento de
`jail.set("__portalessFetch", async (...) => {...}, { result: { promise: true } })`
en `packages/plugin-sandbox/src/adapters/node-isolated-vm.ts`. Ninguna otra
linea del adaptador cambio (la logica de allowlist, denegacion de
capacidades, verificacion de version segura y timeout quedaron intactas,
confirmadas por los otros 2 tests que ya pasaban antes del fix).

**Leccion:** Cualquier funcion expuesta a un isolate de `isolated-vm` que
haga trabajo asincrono (fetch, disk I/O, timers) necesita declarar
explicitamente `{ result: { promise: true } }` al registrarla. Sin esto,
funciona "por accidente" en casos donde el resultado nunca se usa realmente
del lado del isolate, pero falla en cuanto el codigo del plugin hace
`await` sobre el resultado real.

---

## Meta-leccion sobre el flujo de trabajo con el conector de GitHub

Durante esta sesion, `get_file_contents` del conector de GitHub confirmaba
la descarga de archivos ("successfully downloaded text file (SHA: ...)")
pero no devolvia el contenido de texto en el resultado, para archivos que no
habian sido escritos por el propio asistente en la misma sesion. Tampoco
funcionaron `fetch_url` sobre raw.githubusercontent.com/github.com, ni
`search_code` para encontrar esos archivos por nombre o simbolo.

**Mitigacion que funciono:** Pedir directamente al usuario que copie y pegue
el contenido del archivo. Es mas lento que una lectura automatica, pero mucho
mas seguro que adivinar la forma de un archivo (el punto 3 de este documento
es el ejemplo de por que adivinar sale mal: nombres de campo incorrectos en
el primer intento de `config.ts`).

**Regla para el futuro:** Si `get_file_contents` no devuelve contenido de
texto legible para un archivo que no se escribio en esta sesion, no generar
un reemplazo basado en suposiciones. Pedir el contenido exacto al usuario
antes de escribir cualquier fix que dependa de ese archivo.

---

## 7. Vias alternativas cuando `get_file_contents` no devuelve texto (sesion 2026-09-15)

**Sintoma:** Igual que en la sesion anterior, `get_file_contents` sobre un
archivo individual siguio devolviendo solo
`"successfully downloaded text file (SHA: ...)"` sin el cuerpo, en TODAS las
variantes probadas (con `ref` explicito, sin el, en `main`, en una rama
nueva). Se aislo ademas que el bug **no es especifico de este repo**: la
misma llamada contra `torvalds/linux` (repo publico, ajeno, sin relacion con
la cuenta del usuario) devolvio exactamente el mismo resultado truncado. Esto
descarta que sea un problema de permisos del token, de que el repo sea
privado, o de cache del conector.

**Via alternativa que SI funciono parcialmente:** `get_commit(sha)` sobre el
hash de un commit especifico no devuelve el `patch`/diff textual (confirmado
otra vez), pero SI devuelve la lista completa de archivos tocados con
`status` (added/modified/removed) y conteo de lineas (`additions`,
`deletions`, `changes`). Cuando el usuario aporto los links de commits desde
la vista de GitHub (`docs/architecture/*.md` con su commit asociado), esto
permitio:
- Ubicar archivos que los listados de directorio por si solos no revelaban
  facilmente (ej.: `JsonLd.astro` vive en
  `packages/atomic-elements/astro-integration/JsonLd.astro`, no en
  `src/components/` ni `src/lib/` donde se buscaria primero).
- Confirmar tamanos exactos de archivos nuevos sin tener que leerlos.
- Confirmar que un patron arquitectonico ya fue usado dos veces en el repo
  (permissions y trust-layer/ledger, ambos con
  `store-factory.ts` + `d1-*-store.ts` + `sqlite-*-store.ts` + `schema.sql`)
  antes de asumir que hay que inventar una estructura nueva para PageStore.

**Riesgo real que SI se materializo en esta sesion:** al asumir (sin haber
leido el archivo) que `packages/atomic-elements/src/persistence/page-store.ts`
no existia o era un stub vacio, se escribio una primera version de PageStore
con una interfaz inventada (`getPage`/`savePage`/`listPages`/`deletePage`)
que NO coincidia con la interfaz real ya existente en el repo desde v0.0.4
(`load`/`save`/`list`, usada por `LocalStoragePageStore` en el editor
cliente). Si esa version se hubiera commiteado tal cual, habria roto la
compatibilidad con el editor y con `page-schema.ts`. Se detecto a tiempo
porque se listo el directorio `persistence/` ANTES de escribir y se vio que
`page-store.ts` ya pesaba 1486 bytes (no 0), lo que disparo pedir el
contenido real antes de continuar.

**Leccion (reforzada):** Nunca asumir que una carpeta de destino esta vacia
o contiene solo un stub porque el pedido original la describe asi. Siempre
listar el directorio de destino con `get_file_contents` (que si funciona
para listados) ANTES de escribir un archivo nuevo ahi, para detectar si ya
existe algo con una interfaz distinta a la asumida. Si existe y no se puede
leer su contenido, pedirlo al usuario en vez de sobreescribir a ciegas.

**Leccion sobre `get_commit` como atajo:** Si el usuario puede aportar hashes
de commit o links de `github.com/.../commit/<sha>`, usar `get_commit` como
paso de reconocimiento ANTES de pedir el contenido completo de un archivo.
Reduce cuantos archivos hay que pedir manualmente, pero NO reemplaza pedir
el contenido de archivos que el propio fix va a modificar o extender
directamente -- para esos, siempre hace falta el texto real.
