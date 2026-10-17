import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { docsLoader } from "./lib/docs-loader.mjs";

const posts = defineCollection({
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: "./src/content/posts" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    pubDate: z.date(),
    draft: z.boolean().default(false),
  }),
});

// Docs: el Markdown que YA vive en docs/ es la fuente unica (VISION: un canon,
// muchas proyecciones). El loader propio lee solo los archivos de la
// configuracion explicita (docs-nav.mjs), reescribe los enlaces relativos y
// guarda el body resuelto; el id es el slug de la config. El resto del arbol de
// docs/ no se publica.
const docs = defineCollection({
  loader: docsLoader({ base: process.env.PORTALESS_BASE_PATH || "/" }),
  schema: z.object({ title: z.string().optional(), description: z.string().optional() }),
});

export const collections = { posts, docs };
