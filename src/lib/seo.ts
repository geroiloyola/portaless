export interface PageSeoMeta {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl?: string;
  noIndex?: boolean;
}

export function getSiteUrl(astroSite: URL | undefined): string {
  return (astroSite?.toString() ?? "https://example.com").replace(/\/$/, "");
}

export function buildCanonicalUrl(siteUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${siteUrl}${normalizedPath}`;
}

export function truncateDescription(text: string, maxLength = 155): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}\u2026`;
}
