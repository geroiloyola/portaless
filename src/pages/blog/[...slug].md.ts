// GET /blog/<id>.md -- markdown limpio de cada post, para que los links de
// /llms.txt apunten a texto y no a HTML (propuesta de llmstxt.org: la misma
// URL con .md). Excluye borradores, igual que /llms.txt.
//
// post.body es el cuerpo sin frontmatter. En archivos .mdx incluye los
// componentes JSX tal cual estan escritos; se avisa en un comentario HTML.

import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection, type CollectionEntry } from "astro:content";
import { publishedPosts } from "../../lib/llms-txt";

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = publishedPosts(await getCollection("posts"));
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
};

export const GET: APIRoute = ({ props }) => {
  const { post } = props as { post: CollectionEntry<"posts"> };
  const lines = [`# ${post.data.title.replace(/\s+/g, " ").trim()}`, ""];
  if (post.data.description) lines.push(`> ${post.data.description.replace(/\s+/g, " ").trim()}`, "");
  lines.push(`Publicado: ${post.data.pubDate.toISOString().slice(0, 10)}`, "");
  if (post.filePath?.endsWith(".mdx")) {
    lines.push("<!-- Fuente MDX: puede incluir componentes que no se renderizan en texto plano. -->", "");
  }
  lines.push((post.body ?? "").trim(), "");
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
};
