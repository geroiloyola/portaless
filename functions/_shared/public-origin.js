// Un solo origen publico confiable para documentos y redirects.
//
// PORTALESS_PUBLIC_URL es obligatoria en el arranque self-host y en cualquier
// despliegue con Functions. El header Host de la request NO es una fuente de
// verdad: detras de un tunel/proxy puede ser cualquier cosa, y un documento
// publico cacheable que lo refleje permite cache poisoning y anuncia endpoints
// ajenos. Cuando no hay URL configurada, los callers fallan cerrado o usan una
// ruta relativa; nunca inventan el origen desde Host.
export function publicOriginFromEnv(env = {}) {
  const raw = typeof env?.PORTALESS_PUBLIC_URL === "string" ? env.PORTALESS_PUBLIC_URL.trim() : "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Ruta absoluta sobre el origen publico configurado; null si no hay origen. */
export function publicUrlFromEnv(env = {}, pathname = "/") {
  const origin = publicOriginFromEnv(env);
  if (!origin) return null;
  return `${origin}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}
