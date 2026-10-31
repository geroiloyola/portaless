# Pack de prueba humana — Portaless

Guion para tres perfiles. No incluir datos personales en el repo. Usar identificadores anónimos (P1, P2, P3).

## Perfiles

1. **No técnico sin ayuda**: instala siguiendo solo la documentación, sin asistencia del mantenedor.
2. **Técnico con Docker**: instala con Docker Compose y expone con túnel o directo.
3. **Revisor de seguridad**: revisa superficies, archivos y comandos según `security-review-candidate.md`.

## Qué registrar

- Tiempo hasta publicar la primera página (minutos).
- Bloqueos encontrados (paso, mensaje, captura).
- Malentendidos de la documentación.
- Uso a las dos semanas (si volvió, qué cambió).
- Versión de Node, SO, navegador.
- Si usó TOTP, backup, túnel, dominio propio.

## Criterios de éxito

- Instala y publica sin asistencia (perfil 1) o con asistencia documentada (perfil 2).
- No pierde datos ni expone secretos.
- Entiende la diferencia entre nodo canónico y proyección estática.
- Activa 2FA y hace backup.

## Criterios de parada

- Pérdida de datos o secretos.
- Mensaje que no se puede resolver con la documentación.
- Bloqueo de más de 30 minutos sin avance.
- Cualquier sospecha de vulnerabilidad de seguridad.

## Limitaciones conocidas

- `ltp-engine` inactivo en el runtime.
- G4 y G5 pendientes de autorización.
- Publicación real a GitHub Pages requiere credenciales y no se ejecuta en esta prueba.
- Trust Layer puede bloquear agentes de IA declarados; no se prueba atribución completa aquí.

## Protocolo de consentimiento

- Informar al participante que la prueba es voluntaria y puede detenerse en cualquier momento.
- No recopilar datos personales, correos ni contraseñas.
- Guardar solo identificadores anónimos y tiempos.
- No subir capturas con datos reales al repo; anonimizar nombres, dominios y claves.
- El reporte final debe pasar revisión del dueño antes de publicarse.

## Plantilla de reporte

```markdown
# Reporte de prueba humana — <perfil>

- ID anónimo: Pn
- Fecha: YYYY-MM-DD
- Versión probada: <tag o commit>
- SO / Node / navegador: ...
- Tiempo hasta publicar: N minutos
- Pasos completados: ...
- Bloqueos: ...
- Malentendidos: ...
- Uso a las dos semanas: ...
- Recomendaciones: ...
```
