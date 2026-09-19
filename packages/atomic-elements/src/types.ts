export type ElementType =
  | "Hero" | "Heading" | "Paragraph" | "Image" | "Button" | "Columns" | "ProductGrid" | "Spacer"
  | "LinkList" | "SocialIcons" | "ProfileHeader" | "StoreBlock";

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
