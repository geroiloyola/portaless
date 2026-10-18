# Arquitectura de Contenido, Casos de Uso y Modelo POSSE

Este documento establece la filosofía de contenido, los casos de uso implementados en Portaless, la política de gestión de imágenes y el modelo de sindicación descentralizada **POSSE** (*Publish on Own Site, Syndicate Everywhere*).

---

## 1. Los Cuatro Casos de Uso Canónicos

Portaless está diseñado para desacoplar la creación de sitios de la tiranía de suscripciones mensuales (Shopify, Beacons, Linktree) y bases de datos monolíticas frágiles (WordPress). Cuatro casos de uso cubren el espectro de adopción real:

| Caso de Uso | Ruta de Referencia | Componentes Clave | Propósito y Reto Técnico Resuelto |
|---|---|---|---|
| **1. Creador de Contenido / Influencer** | `/pages/jerry-bantz/`, `/pages/link-in-bio/` | `ProfileHeader`, `LinkList`, `SocialIcons`, `ProductCard` (afiliado) | Despliegue estático ultrarrápido, alternativa soberana a Beacons/Linktree. Cero costo de hosting y propiedad de la audiencia vía AT Protocol. |
| **2. Músico & Venta de Merchandise** | `/pages/musica-merch/` | `Hero`, `Video` (YouTube/Vimeo), `LinkList` (Spotify/Apple Music), `Columns`, `ProductCard` (físico/vinilo) | Fusión de reproductor multimedia con ecommerce ligero de inventario reducido. Soporta picos masivos de tráfico en lanzamientos sin saturar el servidor. |
| **3. Discoteca o Eventos (Ticketing)** | `/pages/club-evento/` | `Hero`, `Columns`, `ProductCard` (entradas por niveles), `Map` (OpenStreetMap), `FAQ` | Venta de entradas con entrega digital de código QR, aforo estricto, botón interactivo «Cómo llegar» hacia OSRM/Google Maps y checkout optimizado para móviles. |
| **4. Tienda Boutique de Productos Físicos** | `/pages/boutique/`, `/shop/` | `Hero`, `Columns`, `ProductCard`, `Testimonial`, `Form` | Alternativa sin suscripción a Shopify para marcas de diseño, moda y artesanía. Fichas de producto con soporte para enlaces locales (Medusa) o afiliados externos. |

---

## 2. Los Cuatro Pilares Arquitectónicos

### Pilar 1: Transparencia y Confianza Absoluta (El Factor Git)
En un CMS tradicional (WordPress, Ghost), los artículos pueden editarse o eliminarse silenciosamente sin que el visitante lo note. En Portaless:
- **Auditoría Pública y Trazabilidad**: Todo el contenido reside en un repositorio Git versionado. Cada modificación de un artículo o precio cuenta con un commit con autor, fecha y hash criptográfico verificable.
- **Inmutabilidad Relativa**: Es imposible alterar una declaración histórica en secreto. Cualquier lector o auditor puede inspeccionar el historial y comprobar el estado exacto de una publicación en cualquier punto del tiempo.

### Pilar 2: El "Obsidian Público" y el Modelo Mental de Markdown
- **Longevidad y Portabilidad**: Las publicaciones residen en `/posts/` (`src/content/posts/`) como texto plano estructurado en Markdown (`.md`). No existen datos cautivos en motores MySQL o esquemas propietarios; si la plataforma cambia en 10 años, los archivos siguen siendo legibles por cualquier procesador de texto.
- **Flujo de Escritura Local (Offline-first)**: Los redactores pueden escribir en editores locales (Obsidian, VS Code, Typora), previsualizar con git y publicar con un simple `git push` o mediante el editor visual de Portaless.

### Pilar 3: Rendimiento y Seguridad Serverless
- **Inmunidad al "Efecto Slashdot" (Picos de Tráfico)**: Todo el contenido público se compila a HTML estático servido desde Edge CDNs (GitHub Pages, Cloudflare Pages). Una noticia viral o una venta de entradas puede recibir 10 millones de visitas simultáneas sin consumir memoria de base de datos ni generar costos desorbitados.
- **Superficie de Ataque Nula**: Al no existir PHP, intérpretes vulnerables ni puertos de base de datos expuestos a la web pública, ataques comunes como SQL Injection, Remote Code Execution o bypass de autenticación por CMS son estructuralmente imposibles.

### Pilar 4: Agent-Ready (Diseñado para Agentes de IA)
- **Descubrimiento Semántico Limpio**: Archivos `llms.txt` nativos y metadatos estructurados JSON-LD permiten que motores como Perplexity, Claude o ChatGPT analicen la totalidad del sitio con precisión quirúrgica.
- **Gobernanza y Monetización**: Políticas de lectura configurables (`pay-per-crawl` en `packages/trust-layer`) que permiten cobrar o restringir el rastreo automatizado de agentes mediante micropagos.

---

## 3. Política de Imágenes Ligeras (Repo en Kilobytes)

Para preservar la promesa de que el repositorio de Portaless clone y descargue en segundos, **las imágenes de las plantillas y páginas demostrativas se enlazan mediante URLs absolutas**, evitando introducir megabytes binarios en el historial de Git:

1. **Fotografía de Artículos y Noticias (Bancos Libres)**:
   - **Pexels / Pixabay**: Licencias libres de regalías que permiten descarga, adaptación y uso comercial sin restricciones abusivas.
   - **Wikimedia Commons**: Repositorio de dominio público ideal para portales periodísticos, efemérides, figuras públicas y lugares con valor documental verificable.
2. **Desarrollo y Maquetación Viva**:
   - **Lorem Picsum (`https://picsum.photos/{width}/{height}`)**: Inyección de imágenes aleatorias de código abierto bajo demanda para maquetar bocetos y prototipos sin ocupar espacio en disco.
   - **Unsplash (CDN directo)**: Enlaces CDN directos con parámetros de optimización (`auto=format&fit=crop&w=600&q=80`) para demostraciones de productos y perfiles.
3. **Documentación Técnica & UI**:
   - **unDraw (`https://undraw.co/`)**: Ilustraciones vectoriales SVG en código abierto que heredan la paleta de colores del sistema sin peso binario y sin necesidad de atribución obligatoria.

### 3.1 Regla de enlaces (Fase 12)

Ninguna página de ejemplo puede contener un enlace que no resuelva. Aplica el
mismo criterio que las fuentes de imagen de arriba: si un destino no existe, se
quita el enlace (o la tarjeta) en vez de dejar uno que lleva a la nada. Reglas
concretas, verificadas por `tests/unit/demo-pages-links.test.ts`:

- Nada de `example.com` ni de dominios que no resuelvan (p. ej.
  `tienda.portaless.com`): para lo interno, una ruta del propio sitio
  (`/shop/`, `/pages/portafolio/`).
- Nada de raíces peladas de plataformas (`instagram.com/`, `youtube.com/`,
  `open.spotify.com/`, `music.apple.com/`, `bandcamp.com/`, `tiktok.com/@`):
  un perfil concreto, o se quita.
- Nada de `http://` sin TLS.
- Un producto o perfil sin destino real se quita: una `ProductCard` sin `url` es
  mejor que una que lleva a `example.com`.
- `mailto:` solo con direcciones reales.

Los videos embebidos apuntan a material real y verificable (p. ej. los cortos
abiertos de Blender, CC-BY), nunca a un enlace de broma.

---

## 4. Portaless como Red Social Soberana — El Modelo POSSE

Portaless adopta la filosofía **POSSE**: *Publish on Own Site, Syndicate Everywhere* (Publica en tu propio sitio, sindica hacia todos lados).

```
                  ┌─────────────────────────────────────────┐
                  │          PORTALESS (CANON)              │
                  │   /posts/ (Markdown plano en Git)       │
                  │   Identidad criptográfica (did:apw/web) │
                  └────────────────────┬────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
        ┌────────────────────────┐            ┌────────────────────────┐
        │  AT Protocol / Bluesky │            │ ActivityPub / Mastodon │
        │  (Espejo efímero)      │            │ (Espejo efímero)       │
        └────────────────────────┘            └────────────────────────┘
```

1. **El Canon es Soberano**: La publicación en `/posts/` (`src/content/posts/*.md`) constituye la fuente de la verdad inmutable. Si una red social cierra, banea una cuenta o altera sus algoritmos, la totalidad del archivo histórico sigue bajo el control del autor.
2. **Sindicación vía Plugin Sandbox**: A través de `packages/posse-syndicator-plugin`, un plugin aislado en el sandbox de Portaless con capacidades `content:read` y `network:fetch` detecta publicaciones en `/posts/` y envía automáticamente un "espejo" con extracto y enlace canónico a redes federadas (Bluesky vía `com.atproto.repo.createRecord`, Mastodon vía API REST de estados).
3. **Autoría e Imágenes Inmutables (Portaless Cloud Images & IPFS)**:
   - **Firmas Ed25519 en PNG**: `packages/cloud-images` implementa la incrustación de firmas criptográficas directas dentro del archivo de imagen (similar al estándar C2PA pero 100% soberano y descentralizado).
   - **Preservación con IPFS**: El direccionamiento por contenido (CID) garantiza que si un solo píxel de la imagen se altera, el identificador cambia, blindando la autoría y la autenticidad del material gráfico compartido.

## 4.1 El principio hecho visible: un canon, cinco proyecciones (fase 13, §13.4)

`docs/VISION.md` enuncia el principio ("One canon, many projections") y `/projections/` lo hace visible en el demo: toma **una** publicación canónica y muestra sus cinco salidas — página, feed, manifiesto, entrada de índice y post en otra plataforma — y la página no las afirma: las **deriva** con los mismos generadores que usan `/rss.xml`, `/llms.txt` y `/sitemap.xml` (`src/lib/projections.ts`) y compara si cada una sigue llevando el título y la URL canónica del canon. La regla "gana el canon" es una función (`containsCanon()`): una proyección que no lleve este canon no coincide y se reconstruye desde él. Lo que solo existe en un nodo (el manifiesto APW firmado por request y el espejo POSSE) se marca `requiere nodo` en vez de pintarse en verde — la misma honestidad que el ranking degradado de `/explore/`. La demo está enlazada desde Explore y desde cada post, que es donde vive el canon.

