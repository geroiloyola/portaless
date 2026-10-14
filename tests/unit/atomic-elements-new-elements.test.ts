// Phase 2 (competitive visual catalog): Video, FAQ, Testimonial, Form y
// Gallery -- los 5 elementos que faltaban para no forzar HTML a mano en
// casos basicos de builder visual. Cubre: parsing de URLs de YouTube/Vimeo
// (incluida la no reconocida -> placeholder honesto), formato de lista
// por textarea (FAQ "Pregunta :: Respuesta", Gallery una URL por linea),
// escape de XSS en todos los renderers nuevos, formulario con y sin
// endpoint (el sin endpoint NO inventa un destino: explica la config),
// y el ancla #contacto que los templates del wizard usan.

import { describe, it, expect } from "vitest";
import { elementRegistry, elementPalette } from "../../packages/atomic-elements/src/elements/registry";

describe("Video (embed)", () => {
  it("convierte watch, youtu.be y shorts a youtube-nocookie embed", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=abcdefghijk",
      "https://youtu.be/abcdefghijk",
      "https://www.youtube.com/shorts/abcdefghijk",
    ]) {
      const html = elementRegistry.Video.renderHTML({ url, title: "Mi video", radius: 16 } as never);
      expect(html, url).toContain("https://www.youtube-nocookie.com/embed/abcdefghijk");
      expect(html).toContain('title="Mi video"');
      expect(html).toContain("loading=\"lazy\"");
    }
  });

  it("convierte vimeo.com/12345 a player.vimeo.com", () => {
    const html = elementRegistry.Video.renderHTML({ url: "https://vimeo.com/12345", title: "v", radius: 16 } as never);
    expect(html).toContain("https://player.vimeo.com/video/12345");
  });

  it("URL no reconocida renderiza placeholder honesto, no iframe", () => {
    const html = elementRegistry.Video.renderHTML({ url: "https://ejemplo.com/video", title: "x", radius: 16 } as never);
    expect(html).not.toContain("<iframe");
    expect(html).toContain("URL no reconocida");
  });

  it("escapa el title (XSS)", () => {
    const html = elementRegistry.Video.renderHTML({ url: "https://youtu.be/abcdefghijk", title: '"><script>x</script>', radius: 16 } as never);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("FAQ", () => {
  it("parsea lineas 'Pregunta :: Respuesta' a details/summary", () => {
    const html = elementRegistry.FAQ.renderHTML({
      title: "FAQ",
      items: "¿Envian a todo el pais? :: Si.\n¿Cuanto cuesta? :: Gratis.",
    } as never);
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("¿Envian a todo el pais?");
    expect(html).toContain("¿Cuanto cuesta?");
    expect(html).toContain("Gratis.");
    expect(html).toContain("<h3");
  });

  it("linea sin separador queda como pregunta con respuesta vacia (no se descarta); items vacios -> placeholder", () => {
    const half = elementRegistry.FAQ.renderHTML({ title: "", items: "Solo pregunta sin separador" } as never);
    expect(half).toContain("<details");
    expect(half).toContain("Solo pregunta sin separador");
    const empty = elementRegistry.FAQ.renderHTML({ title: "", items: "  \n\n" } as never);
    expect(empty).toContain("Agrega preguntas");
  });

  it("escapa preguntas y respuestas (XSS)", () => {
    const html = elementRegistry.FAQ.renderHTML({ title: "", items: "<img src=x> :: <script>alert(1)</script>" } as never);
    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("<script>");
  });
});

describe("Testimonial", () => {
  it("renderiza cita, autor, rol y avatar", () => {
    const html = elementRegistry.Testimonial.renderHTML({
      quote: "Excelente trabajo.",
      author: "Ana Ruiz",
      role: "Fotografa",
      avatarUrl: "https://example.com/a.png",
      align: "center",
    } as never);
    expect(html).toContain("Excelente trabajo.");
    expect(html).toContain("Ana Ruiz");
    expect(html).toContain("Fotografa");
    expect(html).toContain('src="https://example.com/a.png"');
    expect(html).toContain("text-align:center");
  });

  it("sin avatar no renderiza img; escapa la cita", () => {
    const html = elementRegistry.Testimonial.renderHTML({
      quote: 'Cita <b>peligrosa</b>',
      author: "A",
      role: "",
      avatarUrl: "",
      align: "left",
    } as never);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });
});

describe("Form (contacto)", () => {
  it("sin action NO inventa destino: placeholder explica la configuracion", () => {
    const html = elementRegistry.Form.renderHTML({ action: "", submitLabel: "Enviar", anchorId: "contacto" } as never);
    expect(html).not.toContain("<form");
    expect(html).toContain("todavia no entrega");
    expect(html).toContain('id="contacto"');
  });

  it("con action renderiza form POST con nombre, email y mensaje", () => {
    const html = elementRegistry.Form.renderHTML({
      action: "https://formspree.io/f/abc123",
      submitLabel: "Enviar",
      anchorId: "contacto",
    } as never);
    expect(html).toContain('<form id="contacto" method="post" action="https://formspree.io/f/abc123"');
    expect(html).toContain('name="nombre"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="mensaje"');
    expect(html).toContain('type="submit"');
  });

  it("escapa action y anchorId (XSS)", () => {
    const html = elementRegistry.Form.renderHTML({
      action: 'https://x.com/"><script>',
      submitLabel: "Ir",
      anchorId: 'a"><b>',
    } as never);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;");
  });
});

describe("Gallery", () => {
  it("parsea una URL por linea a grid de imgs con link a la original", () => {
    const html = elementRegistry.Gallery.renderHTML({
      images: "https://example.com/a.jpg\n\nhttps://example.com/b.jpg\njavascript:alert(1)",
      columns: 2,
      radius: 12,
    } as never);
    expect(html).toContain("repeat(2,1fr)");
    expect(html).toContain('src="https://example.com/a.jpg"');
    expect(html).toContain('src="https://example.com/b.jpg"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain('target="_blank"');
  });

  it("sin URLs validas -> placeholder", () => {
    const html = elementRegistry.Gallery.renderHTML({ images: "no-url", columns: 3, radius: 12 } as never);
    expect(html).toContain("Agrega imagenes");
    expect(html).not.toContain("<img");
  });
});

describe("registro completo", () => {
  it("los elementos nuevos estan en el palette y son renderizables con defaultProps", () => {
    for (const type of ["Video", "FAQ", "Testimonial", "Form", "Gallery", "Map", "ProductCard"] as const) {
      expect(elementPalette, type).toContain(type);
      const html = elementRegistry[type].renderHTML({ ...elementRegistry[type].defaultProps } as never);
      expect(html, type).toBeTruthy();
      expect(html, type).not.toContain("undefined");
    }
  });
});
