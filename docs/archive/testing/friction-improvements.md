# Propuestas de mejora de fricción (sin implementar)

## Carga de `.env`

- Problema: Portaless no carga `.env` por sí solo; en PowerShell las variables no se cargan automáticamente.
- Propuesta: documentar un script de arranque que cargue `.env` de forma explícita, o añadir una carga opcional y documentada en el runtime Node. No activar por defecto sin revisión de seguridad.

## Mensaje de diagnóstico para TXT con barras o comillas inválidas

- Problema: un TXT con comillas escapadas de más puede quedar inválido y el panel solo muestra “Motivo: …”.
- Propuesta: validar el valor sugerido antes de mostrarlo y mostrar un mensaje específico si contiene barras invertidas o comillas no balanceadas.

## Mostrar el TXT exacto por proveedor

- Problema: cada proveedor (Cloudflare, Porkbun) tiene una UI distinta para TXT.
- Propuesta: añadir instrucciones por proveedor en el panel, con capturas y el nombre exacto (`_apw.<dominio>`).

## Distinguir “no pude consultar el DNS” de “registro inválido”

- Problema: el panel muestra “Registro TXT … no encontrado todavía” para todos los casos no verificados.
- Propuesta: mapear `data.reason` a mensajes distintos:
  - `doh_request_failed`: “No pudimos consultar el DNS desde este equipo. Revisá firewall/resolvedor.”
  - `no_txt_records`: “No hay registro TXT _apw publicado.”
  - `malformed_dns_response`: “La respuesta DNS no es válida.”
  - `invalid_domain`: “El dominio configurado no es válido.”
- El código ya devuelve estos motivos; falta el mapeo en la UI.
