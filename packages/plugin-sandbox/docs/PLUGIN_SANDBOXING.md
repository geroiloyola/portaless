# Sandboxing Real de Plugins (v0.0.6, actualizado en v0.0.9)

## Multi-proveedor

| Adaptador | Proveedor | Estado |
|---|---|---|
| CloudflareWorkersForPlatformsAdapter | Cloudflare | Esqueleto, TODOs detallados en el codigo (endpoints exactos, mapeo de capacidades) -- sin integracion real |
| DenoDeployAdapter | Deno Deploy | Esqueleto, TODOs detallados en el codigo -- sin integracion real |
| FastlyComputeAdapter | Fastly | Esqueleto, TODOs detallados en el codigo -- sin integracion real |
| NodeIsolatedVmAdapter | Self-hosted | Ejecucion real implementada, con pool de isolates reutilizables (v0.0.9) y 10/12 capacidades con puente real (falta `content:read`/`content:write`, ver Pendiente abajo) |

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

## Probarlo

```
npm install isolated-vm --workspace=@portaless/plugin-sandbox
node --experimental-strip-types packages/plugin-sandbox/examples/hello-plugin/run-example.ts
```

## Riesgo conocido

GHSA-864f-rcv7-6rh4 (RCE) afecta <=7.0.0. El adaptador rechaza versiones vulnerables.

## Pendiente

- Cloudflare, Deno Deploy, Fastly sin integracion real -- TODOs detallados en cada adaptador (v0.0.9) con los endpoints de API exactos y el mapeo de capacidades necesario, pero sin la llamada real implementada.
- ~~Solo 3 de 12 capacidades tienen puente~~ -- resuelto PARCIALMENTE en v0.0.9: `network:fetch` (ya existia) mas las 9 capacidades nuevas (`media:read`, `media:write`, `email:send`, `commerce:read`, `commerce:checkout`, `storage:read`, `storage:write`, `agent:identify`, `site:admin`) ya tienen puente real via `hostBridge` cuando estan concedidas. `content:read` y `content:write` siguen SIN puente real -- hoy solo existe el guard de denegacion (`__portalessReadContent`/`__portalessWriteContent` lanzan error si la capacidad no esta concedida), pero no hay ninguna funcion registrada para el caso en que SI esta concedida, asi que un plugin no puede invocar `content:read`/`content:write` en absoluto todavia, esten o no concedidas. Pendiente para un proximo PR: agregar esas 2 al mismo patron `CAPABILITY_BRIDGES` + `hostBridge` que ya cubre las otras 10.
