# Validacion Server-Side de canWrite(role) -- Endpoint de Referencia

## Que se agrego

`functions/admin/pages/[slug].js`: primer endpoint de escritura del dashboard (PUT /admin/pages/:slug) que valida canWrite(role) del lado del SERVIDOR, no solo en la UI.

Esto complementa el guard DOM-level de packages/dashboard/src/security/role-guard.ts: ese guard deshabilita botones en el navegador, pero un viewer que llamara este endpoint directamente saltandose la interfaz podia escribir igual si el servidor no revalidaba. Ahora no puede.

## Patron a replicar

```js
function canWrite(role) { return role === "admin"; }

export async function onRequestPut(context) {
  const user = context.data?.user;
  if (!user) return new Response(..., { status: 401 });
  if (!canWrite(user.role)) return new Response(..., { status: 403 });
  // validar body, persistir, responder 200
}
```

## Tests agregados

- tests/unit/admin-pages-role-check.test.ts: 401 sin sesion, 403 para viewer, 200 para admin, 400 si el slug no coincide.
- tests/e2e/sandbox-hello-plugin.test.ts: ejecucion real del sandbox contra hello-plugin, incluyendo host no autorizado y capacidad no concedida.
- Ambos corren en CI via .github/workflows/sandbox-e2e.yml (workflow nuevo y separado de ci.yml existente).

## Pendiente de intervencion manual

1. Confirmar que functions/admin/_middleware.js expone context.data.user (agregar `context.data.user = user;` antes de `return next()` si no lo hace ya).
2. Conectar el PageStore real dentro de onRequestPut (el TODO señala donde).
3. Replicar el patron en los demas endpoints de escritura que existan o se creen.
