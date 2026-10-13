export type ElementType =
  | "Hero" | "Heading" | "Paragraph" | "Image" | "Button" | "Columns" | "ProductGrid" | "Spacer"
  | "LinkList" | "SocialIcons" | "ProfileHeader" | "StoreBlock"
  | "Video" | "FAQ" | "Testimonial" | "Form" | "Gallery";

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
  }>;
  renderHTML: (props: TProps, children?: string) => string;
  renderHTMLAsync?: (props: TProps, children?: string) => Promise<string>;
}
