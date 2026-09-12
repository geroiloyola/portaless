// Especificacion del formato de pagina de Atomic Elements. Reutiliza el
// mismo principio del Skin System del dashboard (packages/dashboard): un
// documento declarativo que solo referencia elementos de un registro fijo,
// nunca introduce markup arbitrario.
//
// Diferencia clave con Elementor: cada ElementNode se traduce a UN SOLO
// nodo HTML por defecto (sin wrappers anidados), y solo el CSS del
// elemento efectivamente usado se incluye en el build final -- ver
// docs/ATOMIC_ELEMENTS.md, seccion "Por que es mas rapido".

export type ElementType =
  | "Hero"
  | "Heading"
  | "Paragraph"
  | "Image"
  | "Button"
  | "Columns"
  | "ProductGrid"
  | "Spacer";

export interface ElementNode {
  id: string;               // Identificador unico dentro de la pagina (uuid corto).
  type: ElementType;
  props: Record<string, unknown>;
  children?: ElementNode[]; // Solo "Columns" usa children; el resto son hojas.
}

export interface PageLayout {
  version: "0.1";
  slug: string;
  title: string;
  description?: string;
  root: ElementNode[];      // Lista ordenada de elementos de nivel superior.
}

/** Contrato que debe cumplir cada elemento del catalogo. */
export interface ElementDefinition<TProps = Record<string, unknown>> {
  type: ElementType;
  displayName: string;
  icon: string;             // Emoji o glifo simple para la paleta del editor.
  defaultProps: TProps;
  /** Lista de props editables, para generar el panel de propiedades automaticamente. */
  editableProps: Array<{
    key: keyof TProps;
    label: string;
    kind: "text" | "textarea" | "url" | "number" | "color" | "select";
    options?: string[];
  }>;
  /**
   * Renderiza el elemento a HTML puro (string). Funciona tanto en el
   * navegador (editor, via innerHTML) como en Node durante el build
   * estatico de Astro -- sin depender de document ni de un DOM real.
   */
  renderHTML: (props: TProps, children?: string) => string;
}
