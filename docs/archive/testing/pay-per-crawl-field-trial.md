# Ensayo de campo — Pay Per Crawl

## Qué exige Pay Per Crawl en una zona real

- Elegibilidad y disponibilidad dependen de Cloudflare y del plan de la zona. Verificar en la documentación oficial del proveedor antes de afirmar disponibilidad.
- Cloudflare gestiona el cobro y la política de crawlers; el origen (Portaless) declara el precio y la política (`ai_input=charge`).
- El origen no toca el dinero; la liquidación la hace el proveedor.
- Requiere identidad APW (`did:apw`) y una activación verificada con token de Cloudflare + step-up (contraseña + TOTP si aplica).

## Ensayo mínimo

1. Activar Trust Layer y crear identidad APW.
2. Configurar `ai_input=charge` con un precio (default 0.002 USD/request).
3. Conectar Cloudflare Pay Per Crawl en `/admin/agents` con un token verificado.
4. Firmar una request con Web Bot Auth (clave de prueba) y observar:
   - Sin proveedor activo: `402 payment_required`, `settlement: "not_available"`.
   - Con proveedor activo: respuesta del proveedor (según su documentación).
5. Registrar fecha, zona, plan, token scopes y resultado.

## Lo que no afirmar

- No afirmar que Pay Per Crawl está disponible en todas las zonas.
- No afirmar que el origen cobra o recibe dinero.
- No afirmar que un proveedor no verificado puede cobrar.

## Lo que no probar

- Liquidación real con dinero.
- Integración con proveedores no documentados.
- G4/G5.
