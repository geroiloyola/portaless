# Observación de cabeceras de cloudflared

Objetivo: saber qué cabeceras añade el túnel antes de decidir D3 (`PORTALESS_CLIENT_IP_HEADER`). No usar el túnel de producción.

## Servidor local que devuelve cabeceras

```bash
node -e 'require("http").createServer((req,res)=>{res.setHeader("content-type","application/json");res.end(JSON.stringify(req.headers,null,2))}).listen(3000,"127.0.0.1")'
```

En otra terminal, túnel rápido de prueba (nunca el nombrado de producción):

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

Abrí la URL `trycloudflare.com` que imprime cloudflared y pedí `/` con `curl` o el navegador. El servidor devuelve las cabeceras que recibió.

## Salidas posibles

### Caso A — llega `X-Forwarded-For`

```json
{
  "x-forwarded-for": "<ip-cliente>, <ip-cloudflared>",
  "cf-connecting-ip": "<ip-cliente>",
  "x-forwarded-proto": "https"
}
```

Decisión implicada: D3 puede usar `x-forwarded-for` con `PORTALESS_TRUSTED_PROXIES` apuntando a la IP del socket de cloudflared; el runtime ya calcula `x-portaless-client-ip` desde XFF.

### Caso B — solo llega `Cf-Connecting-Ip`

```json
{
  "cf-connecting-ip": "<ip-cliente>",
  "x-forwarded-proto": "https"
}
```

Decisión implicada: con el runtime actual, `cf-connecting-ip` se descarta y no hay IP distinguible; todos los clientes comparten el bucket del túnel. Para D3 habría que habilitar explícitamente `cf-connecting-ip` y garantizar que el origen solo sea accesible vía Cloudflare.

## Sin IP distinguible: impacto en el límite de login

- `PORTALESS_LOGIN_ATTEMPTS_PER_IP` (default 60/15 min) y el límite de fallos (20/15 min) usan `x-portaless-client-ip` (`functions/admin/login.js`, `packages/auth/src/password-reset-rate-limit.ts:39-46`).
- Si todos los clientes comparten la IP del túnel, un solo cliente puede agotar el presupuesto y bloquear el login de todos (incluido el admin) hasta la ventana siguiente. Es la regresión que #113 buscó evitar con IP por cliente.
- Mitigación temporal: Cloudflare Access delante de `/admin`, TOTP y límites por usuario; no sustituyen una IP distinguible.

## Estado

- Este entorno **no tiene `cloudflared` instalado**; los comandos no se ejecutaron: **NO VERIFICABLE**.
- La observación real la hace el dueño con su túnel, nunca con el de producción.
- Hasta tenerla, D3 no se implementa.
