export type ElementType =
  | "Hero" | "Heading" | "Paragraph" | "Image" | "Button" | "Columns" | "ProductGrid" | "Spacer"
  | "LinkList" | "SocialIcons" | "ProfileHeader" | "StoreBlock"
  | "Video" | "FAQ" | "Testimonial" | "Form" | "Gallery"
  | "Map" | "ProductCard";

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
   * Estado de publicacion nativo. Opcional por compatibilidad hacia atras con
   * el layout JSON ya persistido en D1/SQLite (que no lo trae): si falta, se
   * trata como "published". El gate de publicacion real es el publish filter
   * (deploy-engine/draft-filter), que hoy excluye tanto los `-draft` de slug
   * (legacy) como los `status: "draft"`.
   */
  status?: "draft" | "published";
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
