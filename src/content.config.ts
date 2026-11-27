import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { docsLoader } from "./lib/docs-loader.mjs";
import { getSiteProfileConfig } from "./lib/site-profile.mjs";

const siteProfile = getSiteProfileConfig(process.env);

const posts = defineCollection({
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: `./${siteProfile.postsDir}` }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    pubDate: z.date(),
    draft: z.boolean().default(false),
    private: z.boolean().default(false),
    flairs: z.array(z.string()).optional(),
    flair: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
});

// Docs: solo se cargan y publican en el perfil demo (D8/PR-B2). En starter,
// la coleccion queda vacia para no publicar documentacion de producto en un
// sitio limpio.
const docs = defineCollection({
  loader: siteProfile.features.docs
    ? docsLoader({ base: process.env.PORTALESS_BASE_PATH || "/" })
    : { name: "portaless-docs-disabled", load: async () => {} },
  schema: z.object({ title: z.string().optional(), description: z.string().optional() }),
});

export const collections = { posts, docs };
