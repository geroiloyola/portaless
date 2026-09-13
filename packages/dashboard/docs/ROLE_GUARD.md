# canWrite(role) aplicado a TODO el dashboard

## Problema que resuelve

canWrite(role) (de @portaless/auth) ya existia, pero solo lo consultaban algunos puntos aislados -- un viewer podia ver controles habilitados en organismos que no lo consultaban.

## Solucion: guard a nivel DOM (defensa en profundidad)

packages/dashboard/src/security/role-guard.ts expone applyRoleGuard, observeRoleGuard y autoInitRoleGuard. Deshabilita/restaura todos los controles interactivos dentro de un contenedor segun canWrite(role), y reaplica automaticamente ante cualquier mutacion del DOM.

## Integracion (una linea + un atributo HTML)

```html
<div id="dashboard-root" data-portaless-dashboard-root data-role="viewer">
  <!-- organismos del skin -->
</div>
```

```ts
import "@portaless/dashboard/src/security/role-guard";
```

## Por que DOM-level y no "en cada componente"

Los organismos son funciones que devuelven HTML string, no componentes reactivos. El guard DOM garantiza cobertura total, presente y futura, sin tocar el registry.

## Importante

Esto NO sustituye la validacion en el backend -- es defensa en profundidad en el cliente. Las funciones/API que reciben mutaciones deben validar canWrite(role) del lado del servidor de todas formas.
