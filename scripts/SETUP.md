# Instalacion de base de datos + admin inicial (v0.0.9.4)

Antes de esta version, levantar una instancia nueva de Portaless requeria
4 pasos manuales dispersos: aplicar por separado los `schema.sql` de
`@portaless/auth`, `@portaless/permissions`, `@portaless/trust-layer` y
`@portaless/atomic-elements`, y despues crear a mano el primer usuario
admin invocando `ensureInitialAdmin()` directamente desde codigo.

## Comando unico (self-hosted / SQLite)

```
node scripts/setup.mjs
```

Este script:

1. Aplica `schema.sql` (el archivo maestro en la raiz, generado a partir de
   los 4 `schema.sql` de cada paquete + la tabla nueva de recuperacion de
   contrasena de v0.0.9.4) contra un archivo SQLite local.
2. Crea el usuario admin inicial (usuario `admin` por defecto) si todavia
   no existe ningun usuario -- reusando `ensureInitialAdmin()` de
   `packages/auth/src/users-store.ts`, sin duplicar esa logica.

Requiere `better-sqlite3` instalado (`npm install better-sqlite3`) si no
esta ya en el arbol de dependencias.

### Variables de entorno opcionales

| Variable | Default | Descripcion |
|---|---|---|
| `PORTALESS_SQLITE_PATH` | `./portaless.db` | Ruta al archivo SQLite |
| `PORTALESS_ADMIN_USERNAME` | `admin` | Usuario admin inicial |
| `PORTALESS_ADMIN_PASSWORD` | (generada aleatoriamente) | Si se omite, el script genera una contraseña aleatoria y la imprime UNA sola vez en la terminal |

## Cloudflare D1

Este script cubre exclusivamente SQLite self-hosted -- D1 vive en la
infraestructura de Cloudflare, no en un archivo local. Para D1:

```
wrangler d1 execute <NOMBRE_DB> --file=schema.sql
```

La creacion del admin inicial contra D1 sigue el mismo mecanismo que ya
existia antes de v0.0.9.4: `ensureInitialAdmin()` se invoca del lado del
Worker (ver `functions/admin/login.js`) si `listUsers()` devuelve vacio --
no requiere un script separado porque D1 ya esta accesible desde cualquier
Function desplegada.

## Regenerar schema.sql si cambia algun paquete

Si se agrega/modifica una tabla en el `schema.sql` de cualquier paquete
individual (`packages/*/src/**/schema.sql`), el archivo maestro de la raiz
debe regenerarse:

```
node scripts/generate-schema.mjs
```

**No editar `schema.sql` (raiz) a mano** -- es generado automaticamente y
cualquier edicion manual se perderia en la siguiente regeneracion.

## Tarea manual pendiente

Agregar un script `"setup": "node scripts/setup.mjs"` a la seccion
`scripts` de `package.json` (raiz) para poder correr `npm run setup` en
vez de la ruta completa -- no se edito `package.json` en este PR porque su
contenido completo no se pudo leer por el bug del conector de GitHub (ver
`.airchive/project_memory/lessons_learned.md`), y el usuario confirmo
explicitamente no pasar su contenido en esta sesion, asi que se documenta
como tarea manual en vez de arriesgar sobrescribir scripts o dependencias
existentes sin verlos primero.
