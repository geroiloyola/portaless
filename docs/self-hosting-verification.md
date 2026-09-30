# Verificación de un despliegue self-hosted real

El job `docker-smoke` del CI prueba la imagen en un runner de GitHub. Esta lista cubre lo que el CI no puede probar: el despliegue en la plataforma real. Hay que correrla una vez en Railway y otra en Render antes de anunciar el soporte.

Reemplazá `https://TU-DOMINIO` por la URL pública del servicio.

## 1. Arranque

- [ ] El build termina sin errores de `better-sqlite3` ni `isolated-vm`.
- [ ] El healthcheck de la plataforma pasa: `curl -fsS https://TU-DOMINIO/healthz` devuelve `{"ok":true,...}`.
- [ ] Los logs muestran `CODIGO DE CONFIGURACION` (o el aviso de `PORTALESS_SETUP_CODE`).
- [ ] Los logs **no** muestran errores de permisos sobre `/data` (el entrypoint baja a UID 1000).

## 2. Primer admin

- [ ] `curl -fsS https://TU-DOMINIO/api/setup/status` devuelve `needsSetup: true`.
- [ ] `/setup` crea el admin con el código de los logs.
- [ ] `/api/setup/status` pasa a `needsSetup: false`.

## 3. Login

- [ ] `GET /admin/login` muestra la página.
- [ ] Login con contraseña deja la cookie `portaless_session` con `Secure` (la plataforma sirve HTTPS).
- [ ] Con 2FA activo, `GET /admin/login-mfa` muestra la página y el código completa el login.
- [ ] Cinco códigos TOTP incorrectos invalidan el challenge.
- [ ] `/admin/password-reset` carga sin sesión.

## 4. Persistencia

- [ ] Redeploy o reinicio del servicio: el admin sigue existiendo y `/setup` responde `needsSetup: false`.
- [ ] Si no se configuró `PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY`, `/setup` mostró el aviso y la clave sobrevive al reinicio.

## 5. Rutas protegidas

- [ ] Sin sesión, `/admin/`, `/admin/editor` y `/admin/wizard` redirigen a `/admin/login?error=1`.
- [ ] Una URL inexistente devuelve status 404.

## Específico de cada plataforma

- Railway: el volumen en `/data` se crea a mano en el dashboard; `railway.json` no lo declara.
- Render: el disco requiere plan pago (`starter` en `render.yaml`). Con plan free el Blueprint se rechaza.

Si algo falla, guardá los logs del deploy y del servicio: con eso se puede diagnosticar sin acceso a la plataforma.
