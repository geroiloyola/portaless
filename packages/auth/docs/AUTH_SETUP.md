# Activar autenticación en Portaless (MVP)

1. El módulo ya está incluido en el monorepo vía npm workspaces.
2. Define las variables de entorno del primer administrador:
   ```
   PORTALESS_ADMIN_USERNAME=admin
   PORTALESS_ADMIN_PASSWORD=cambia-esto-antes-de-desplegar
   ```
3. **Pendiente de implementar** (ver `docs/architecture/authentication.md`):
   el script que lee esas variables y llama a `ensureInitialAdmin()` en el
   primer despliegue.
4. Una vez creado el usuario, ve a `/admin/login` para autenticarte.

## Advertencia

No despliegues este módulo en producción real hasta completar los puntos
listados en "Limitaciones honestas de este MVP" del documento de
arquitectura.
