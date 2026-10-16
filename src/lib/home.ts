// Preparacion del home en build. Extraido para que las dos proyecciones de
// locale (`/` en y `/es/` es) compartan exactamente la misma logica: el motor
// no conoce astro:content, asi que la pagina inyecta las publicaciones reales
// (mismo filtro canonico publishedPosts()) en los nodos PostList, y quita el
// bloque de tienda cuando el comercio esta apagado (una landing no muestra un
// placeholder de catalogo vacio).
import type { ElementNode, PageLayout } from "../../packages/atomic-elements/src/types";

export interface HomePostItem {
  title: string;
  href: string;
  date: string;
  description: string;
}

export function prepareHome(layout: PageLayout, posts: HomePostItem[], commerceEnabled: boolean): PageLayout {
  const prepare = (nodes: ElementNode[]): ElementNode[] =>
    nodes
      .filter((node) => commerceEnabled || (node.type !== "ProductGrid" && node.type !== "StoreBlock"))
      .map((node) => ({
        ...node,
        props: node.type === "PostList" ? { ...node.props, items: posts } : node.props,
        children: node.children ? prepare(node.children) : node.children,
        columnSlots: node.columnSlots ? node.columnSlots.map(prepare) : node.columnSlots,
      }));
  return { ...layout, root: prepare(layout.root) };
}
