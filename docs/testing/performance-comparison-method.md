# Método de comparación de rendimiento (sitio estático vs CMS)

Método para medir peso, solicitudes y TTFB. Sin cifras inventadas: todo número debe salir de una medición real con este método.

## Objetivo

Comparar el sitio estático generado por Portaless contra WordPress y Ghost por defecto, en igual clase de hosting, de forma reproducible y sin afirmaciones no medidas.

## Métricas

- Peso total de la página (bytes transferidos, comprimido y sin comprimir).
- Número de requests.
- TTFB (Time to First Byte).
- LCP, CLS e INP si se miden con herramientas estándar.
- Tamaño del HTML inicial y del CSS/JS crítico.

## Condiciones de igualdad

- Mismo tipo de hosting (estático vs estático; no comparar un CDN con un servidor compartido).
- Misma red y ubicación de medición.
- Misma página equivalente (home con un post y una imagen).
- Sin caché caliente previa (o medir ambas: fría y caliente).
- Sin extensiones ni plugins adicionales en WordPress/Ghost más allá del default.

## Procedimiento

1. Desplegar Portaless en GitHub Pages o Cloudflare Pages con el starter (sin demo).
2. Desplegar WordPress y Ghost por defecto en un hosting de la misma clase.
3. Medir con Lighthouse, WebPageTest o `curl -w` para TTFB.
4. Repetir al menos 5 veces por escenario y reportar mediana y rango.
5. Registrar fecha, URL, herramienta, versión y configuración.

## Qué no hacer

- No publicar cifras sin medición.
- No comparar un sitio con CDN contra uno sin CDN sin declararlo.
- No incluir terceros no medidos (analytics, chat, etc.) sin declararlos.

## Formato de reporte

| Escenario | Hosting | Peso (KB) | Requests | TTFB (ms) | Fecha | Herramienta |
|---|---|---|---|---|---|---|
| Portaless starter | GitHub Pages | medir | medir | medir | | |
| WordPress default | igual clase | medir | medir | medir | | |
| Ghost default | igual clase | medir | medir | medir | | |

Todos los campos numéricos quedan vacíos hasta tener medición.
