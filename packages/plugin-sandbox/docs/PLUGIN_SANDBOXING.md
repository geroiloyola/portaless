# Sandboxing Real de Plugins (v0.0.6, actualizado en v0.0.9, v0.0.9.1 y v0.0.9.4)

## Multi-proveedor

| Adaptador | Proveedor | Estado |
|---|---|---|
| CloudflareWorkersForPlatformsAdapter | Cloudflare | v0.0.9.1: integracion real (sube/actualiza script via API REST, invoca via un Worker dispatcher externo) -- **NO verificada contra una cuenta real** (sin credenciales de prueba), cubierta solo por tests con `fetch` mockeado. Requiere ademas un Worker dispatcher desplegado aparte (infraestructura externa a este repo, ver comentario al inicio del archivo del adaptador). |
| DenoDeployAdapter | Deno Deploy | v0.0.9.1: integracion real (crea deployment via API REST, invoca la URL resultante) -- **NO verificada contra una cuenta real** (sin credenciales de prueba), cubierta solo por tests con `fetch` mockeado. |
| FastlyComputeAdapter | Fastly | Esqueleto, TODOs detallados en el codigo -- sin integracion real (requiere un plugin ya compilado a Wasm para poder probarse, no disponible; decision explicita de alcance). |
| NodeIsolatedVmAdapter | Self-hosted | Ejecucion real implementada, con pool de isolates reutilizables (v0.0.9) y **12/12 capacidades con puente real** desde v0.0.9.4 (ver seccion nueva abajo). |

Para Cloudflare y Deno Deploy, las 9 capacidades no-red (storage, email,
commerce, media, agent:identify, site:admin) se resuelven via un bridge
HTTP: el codigo bootstrap subido al proveedor invoca
`SandboxExecutionInput.bridgeUrl` (nuevo campo v0.0.9.1) con un token de
corta duracion generado por invocacion. **Ese endpoint interno todavia no
existe en el repo** -- sin `bridgeUrl` configurado (ni la variable de
entorno `PORTALESS_CAPABILITY_BRIDGE_URL`), cualquier capacidad no-red
concedida falla con un error explicito de "no hay bridge HTTP
configurado", nunca con un exito silencioso ni un 403 enganoso.

## Como funciona

1. Isolate V8 con limite de memoria (128MB default).
2. Contexto aislado sin require/process/filesystem/red por defecto.
3. Solo se inyectan puentes de capacidades concedidas.
4. Timeout de 2s por defecto. isolate.dispose() siempre al final.
5. (v0.0.9) Con `poolMaxIsolates` configurado, los isolates V8 subyacentes se reutilizan entre ejecuciones -- pero cada ejecucion sigue recibiendo un `ivm.Context` nuevo, asi que una variable global definida por un plugin nunca es visible en la siguiente ejecucion que tome ese mismo isolate prestado del pool. Ver tests/e2e/sandbox-isolate-pool.test.ts.

## Puente host<->isolate para capacidades async: patron obligatorio

Toda capacidad que necesite invocar codigo async del host (`hostBridge`) DEBE
registrarse como `ivm.Reference(fn)` y ser invocada desde dentro del isolate
con:

```js
ref.apply(undefined, [args], { arguments: { copy: true }, result: { promise: true, copy: true } })
```

**Nunca usar `new ivm.Callback(fn, { async: true })` seguido de un `await`
directo dentro del codigo del isolate.** Esa combinacion dispara de forma
reproducible `TypeError: #<Promise> could not be cloned.` -- es un bug real y
largamente documentado de la propia libreria `isolated-vm` (confirmado en
version 7.0.1), no un error de uso de Portaless. El problema ocurre porque
`await` dentro del isolate opera sobre la identidad de una promesa "foránea"
creada por el Callback async, que la maquina de promesas del isolate no puede
clonar de vuelta a traves del limite de aislamiento. El patron de
`Reference.apply({result: {promise: true}})` evita el problema por completo
porque es la capa nativa C++ de isolated-vm -- no JS del isolate -- la que
espera la promesa y copia el valor resuelto.

Issues de referencia en `laverdet/isolated-vm`:
- https://github.com/laverdet/isolated-vm/issues/240
- https://github.com/laverdet/isolated-vm/issues/125
- https://github.com/laverdet/isolated-vm/issues/234
- https://github.com/laverdet/isolated-vm/issues/294 (el mantenedor posta el patron `Reference.apply` que este proyecto adopto)

Ver el comentario extenso al inicio de `src/adapters/node-isolated-vm.ts` para
el detalle completo, incluyendo por que el valor de retorno final del script
(`globalThis.__portalessResultPromise`) tambien necesito su propio fix para
que el completion value async no saliera siempre `undefined`
(`insertReturnOnLastStatement`, una heuristica pragmatica de insercion de
`return` en la ultima sentencia -- ver limitacion conocida abajo).

### Limitacion conocida: `insertReturnOnLastStatement`

El codigo del plugin no siempre termina en una expresion simple (`x + 1`) --
puede terminar en un `try {...} catch (err) {...}`, un bloque `if`, etc. Para
capturar el valor de esa ultima sentencia como el resultado final del script
sin pedirle al autor del plugin que escriba un `return` explicito,
`insertReturnOnLastStatement()` usa una heuristica de texto (no un parser AST
real): recorre las lineas del codigo de atras hacia adelante, saltando lineas
que son solo cierres de bloque (`}`, `});`, etc. via el regex
`/^\}+[;)]*$/`), hasta encontrar la primera linea que parece una expresion de
verdad, y le antepone `return`. Esto es suficiente para los casos reales
probados (incluyendo el caso de `storage:write` que termina dentro de un
`catch`), pero al ser basado en texto y no en un parser real, puede fallar de
formas silenciosas ante codigo mas exotico -- comentarios multilinea que
contengan lineas que matcheen el patron de cierre de bloque, un ultimo
statement que sea el propio cierre de un template literal multilinea, etc. Si
en el futuro aparecen falsos negativos (el output vuelve a salir
`undefined`), la solucion correcta a largo plazo es reemplazar esta heuristica
por un parser real (p.ej. usar el AST de `acorn` ya que Astro/Vite lo traen
transitivamente) en vez de agregar mas casos especiales al regex.

## Puente real de content:read/content:write (v0.0.9.4)

Antes de v0.0.9.4, `content:read` y `content:write` eran las unicas 2
capacidades del catalogo de 12 que solo tenian el guard de denegacion en
`node-isolated-vm.ts` -- nunca se registraba la funcion positiva que invoca
el `hostBridge` cuando la capacidad SI esta concedida, a diferencia de las
otras 10 (`network:fetch` desde antes de v0.0.9, las 9 restantes agregadas en
v0.0.9). El resultado practico era que ningun plugin de terceros (AppPlace,
AppLibre, o privado) podia leer ni escribir contenido del sitio, incluso si
un administrador le otorgaba la capacidad explicitamente desde el Centro de
Permisos.

v0.0.9.4 cierra esa brecha integrando ambas capacidades al mismo array
generico `CAPABILITY_BRIDGES` que ya usan las otras 10 -- mismo patron
`ivm.Reference` + `.apply({ result: { promise: true, copy: true } })`
descrito en la seccion anterior, mismo guard de denegacion inmediata cuando
la capacidad no esta concedida, y mismo error `NOT_CONFIGURED` cuando esta
concedida pero el `hostBridge` de la integracion (D1PageStore,
SqlitePageStore, o cualquier futuro backend) todavia no expone
`contentRead`/`contentWrite`. El bloque especial que existia antes en
`execute()` (que solo tenia el guard de denegacion para estas 2 capacidades,
por fuera del array generico) se eliminó.

**Tarea manual pendiente:** `CapabilityHostBridge` en
`packages/plugin-sandbox/src/types.ts` debe declarar formalmente
`contentRead?: (args: unknown) => Promise<unknown>` y
`contentWrite?: (args: unknown) => Promise<unknown>` (mismo shape que
`mediaRead`/`mediaWrite` ya declarados ahi). `node-isolated-vm.ts` ya
funciona con estos campos hoy via un tipo local extendido (interseccion de
tipos) para no bloquear esta entrega en la lectura de `types.ts` (bloqueada
por un bug del conector de GitHub, ver `lessons_learned.md`), pero cualquier
implementacion real de `hostBridge` que importe `CapabilityHostBridge`
directamente desde `../types` no vera esos 2 campos tipados/autocompletados
hasta que se haga ese ajuste.

**Estado del catalogo de capacidades tras v0.0.9.4: 12/12 con puente real.**
Cobertura de tests: `tests/e2e/sandbox-content-capability-bridge.test.ts` (7
tests: denegacion sin capacidad concedida, `NOT_CONFIGURED` sin `hostBridge`
configurado, ida y vuelta real con datos anidados, y ambas capacidades
concedidas simultaneamente sin interferencia entre si).

## Probarlo

```
npm install isolated-vm --workspace=@portaless/plugin-sandbox
node --experimental-strip-types packages/plugin-sandbox/examples/hello-plugin/run-example.ts
```

## Riesgo conocido

GHSA-864f-rcv7-6rh4 (RCE) afecta <=7.0.0. El adaptador rechaza versiones vulnerables.

## Pendiente

- ~~Cloudflare, Deno Deploy, Fastly sin integracion real~~ -- resuelto PARCIALMENTE en v0.0.9.1 para 2 de 3: Cloudflare Workers for Platforms y Deno Deploy ahora hacen la llamada real a sus APIs REST publicas (subida/creacion + invocacion), pero **sin verificacion contra una cuenta real** (sin credenciales de prueba disponibles), solo con tests de `fetch` mockeado. Fastly sigue sin cambios -- TODOs detallados, decision explicita de alcance (requiere un plugin ya compilado a Wasm, no disponible). Gaps conocidos que quedan para un proximo PR: (a) el endpoint HTTP interno que expone `CapabilityHostBridge` sobre HTTP (`bridgeUrl`) todavia no existe en el repo; (b) `CloudflareWorkersForPlatformsAdapter` depende de un Worker "dispatcher" desplegado aparte, que este codigo no crea; (c) `DenoDeployAdapter` crea una deployment nueva en cada `execute()` sin limpiar las anteriores; (d) ningun mapeo de `limits` (CPU/memoria) esta implementado para ninguno de los 2 proveedores por falta de soporte de API para eso.
- ~~Solo 3 de 12 capacidades tienen puente~~ -- resuelto en v0.0.9 (10/12: `network:fetch` mas las 9 capacidades nuevas) y COMPLETADO en v0.0.9.4 (12/12: se agrega el puente real de `content:read`/`content:write`, ver seccion nueva arriba "Puente real de content:read/content:write (v0.0.9.4)"). Con esto, todas las capacidades del catalogo tienen puente real en `NodeIsolatedVmAdapter` -- lo que sigue pendiente es exclusivamente el bridge HTTP para los adaptadores edge (Cloudflare/Deno), ver punto anterior.
