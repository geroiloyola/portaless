// Salvaguarda del publish: por defecto, un borrador del Wizard (slug
// terminado en "-draft", ver functions/admin/api/wizard/generate-page.js)
// nunca se publica sin que el usuario lo revise y lo guarde con otro slug.
// Logica pura, extraida para poder testearla sin depender de PageStore ni
// del filesystem -- mismo principio que tree-ops.ts en el editor visual.

export interface ExcludeDraftsResult {
  slugs: string[];
  skipped: number;
}

export function excludeDrafts(slugs: string[], includeDrafts: boolean): ExcludeDraftsResult {
  if (includeDrafts) return { slugs, skipped: 0 };
  const filtered = slugs.filter((s) => !s.endsWith("-draft"));
  return { slugs: filtered, skipped: slugs.length - filtered.length };
}
