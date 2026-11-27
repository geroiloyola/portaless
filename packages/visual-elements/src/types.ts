export type ElementType =
  | "Hero" | "Heading" | "Paragraph" | "Image" | "Button" | "Columns" | "ProductGrid" | "Spacer"
  | "LinkList" | "SocialIcons" | "ProfileHeader" | "StoreBlock"
  | "Video" | "FAQ" | "Testimonial" | "Form" | "Gallery"
  | "Map" | "ProductCard" | "Icon" | "FeatureGrid" | "PostList";

export interface ElementNode {
  id: string;
  type: ElementType;
  props: Record<string, unknown>;
  children?: ElementNode[];
  columnSlots?: ElementNode[][];
}

export interface PageLayout {
  version: "0.1";
  slug: string;
  title: string;
  description?: string;
  /**
   * Idioma del contenido de la pagina (i18n, docs/i18n-design.md). Opcional y
   * aditivo: el motor no lo usa para renderizar (solo compone nodos), lo lee la
   * capa de sitio para el <html lang>, el selector de idioma y el aviso. Si
   * falta, la capa de sitio cae al idioma del archivo (sufijo `.en`/`.es`) o al
   * idioma del sitio (SITE_LANG).
   */
  locale?: string;
  /**
   * Version del LAYOUT de la pagina (contrato de datos del contenido, distinto
   * de `version` = version del esquema). Opcional y aditivo: si falta, se trata
   * como la version 1 (mismo fallback seguro que variantes y temas: un dato que
   * no conocemos NO rompe el render). Una version mayor a la que este codigo
   * entiende se maneja con el fallback, nunca con un crash.
   */
  layoutVersion?: number;
  /**
   * Estado de publicacion nativo. Opcional por compatibilidad hacia atras con
   * el layout JSON ya persistido en D1/SQLite (que no lo trae): si falta, se
   * trata como "published" para compatibilidad historica. La politica central
   * (deploy-engine/draft-filter) publica solo `published`/legacy-sin-status y
   * excluye `draft`, `private`, sufijo legacy `-draft` y estados desconocidos.
   */
  status?: "draft" | "published" | "private";
  /** Stable identity of this publication; assigned by PageStore on first save. */
  publicationId?: string;
  /** Opaque immutable revision identity; also used as the optimistic-lock token. */
  revisionId?: string;
  revisionNo?: number;
  /** SHA-256 of canonical public content (status and revision metadata excluded). */
  contentHash?: string;
  /**
   * Tema por PAGINA (theme pack). Opcional: si falta o el nombre no
   * resuelve en el catalogo (builtin ∪ instalado), la pagina usa el skin
   * del sitio -- el fallback es siempre el look por defecto. Ver
   * themes/theme-pack.ts.
   */
  theme?: string;
  root: ElementNode[];
}

export interface ElementDefinition<TProps = Record<string, unknown>> {
  type: ElementType;
  displayName: string;
  icon: string;
  defaultProps: TProps;
  editableProps: Array<{
    key: keyof TProps;
    label: string;
    kind: "text" | "textarea" | "url" | "number" | "color" | "select";
    options?: string[];
    /**
     * Texto visible de cada valor de un `select`. El panel lo usa en lugar del
     * valor crudo: sin esto el desplegable de un editor en castellano
     * mostraba `centered` o `h1`. Es aditivo -- si falta la clave, se renderiza
     * el valor crudo, como antes. Sirve igual para las variantes (`variant`) y
     * para los select que ya existian (`h1|h2|h3`, `left|center|right`).
     */
    optionLabels?: Record<string, string>;
  }>;
  renderHTML: (props: TProps, children?: string) => string;
  renderHTMLAsync?: (props: TProps, children?: string) => Promise<string>;
}
