// Connection checks for the onboarding assistant (C35). Pure fetch-based
// checks, no token is returned or logged; callers decide where to store secrets.

export type ConnectionStatus = "connected" | "not_configured" | "invalid";

export interface ConnectionCheck {
  id: "private-node" | "github-pages" | "cloudflare-pages";
  label: string;
  status: ConnectionStatus;
  detail: string;
  account: string | null;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface PrivateNodeInput {
  backend: "d1" | "sqlite" | "memory";
  sqlitePath?: string | null;
  writable?: boolean;
}

export function checkPrivateNode(input: PrivateNodeInput): ConnectionCheck {
  if (input.backend === "memory") {
    return { id: "private-node", label: "Nodo privado local", status: "invalid", detail: "No hay DB/SQLite durable configurado; el canon se perdería al reiniciar.", account: null };
  }
  if (input.backend === "sqlite" && !input.sqlitePath) {
    return { id: "private-node", label: "Nodo privado local", status: "invalid", detail: "Falta PORTALESS_SQLITE_PATH.", account: null };
  }
  if (input.writable === false) {
    return { id: "private-node", label: "Nodo privado local", status: "invalid", detail: "El volumen de datos no es escribible.", account: null };
  }
  return {
    id: "private-node",
    label: "Nodo privado local",
    status: "connected",
    detail: input.backend === "d1" ? "Canon en D1." : `Canon en SQLite: ${input.sqlitePath}.`,
    account: null,
  };
}

async function githubJson(fetchImpl: FetchLike, token: string, path: string): Promise<{ status: number; json: any }> {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "portaless-connection-check",
    },
  });
  let json: any = null;
  try { json = await response.json(); } catch { json = null; }
  return { status: response.status, json };
}

export async function checkGitHubConnection(fetchImpl: FetchLike, token: string | null | undefined): Promise<ConnectionCheck> {
  if (!token) return { id: "github-pages", label: "GitHub Pages", status: "not_configured", detail: "Conecta una cuenta de GitHub desde el Paso 2.", account: null };
  try {
    const user = await githubJson(fetchImpl, token, "/user");
    if (user.status !== 200 || typeof user.json?.login !== "string") {
      return { id: "github-pages", label: "GitHub Pages", status: "invalid", detail: `GitHub rechazó la credencial (HTTP ${user.status}).`, account: null };
    }
    return { id: "github-pages", label: "GitHub Pages", status: "connected", detail: `Conectado como @${user.json.login}.`, account: user.json.login };
  } catch {
    return { id: "github-pages", label: "GitHub Pages", status: "invalid", detail: "No se pudo validar la conexión con GitHub.", account: null };
  }
}

export interface CloudflareInput {
  token?: string | null;
  accountId?: string | null;
  project?: string | null;
}

export async function checkCloudflareConnection(fetchImpl: FetchLike, input: CloudflareInput): Promise<ConnectionCheck> {
  if (!input.token || !input.accountId || !input.project) {
    return { id: "cloudflare-pages", label: "Cloudflare Pages", status: "not_configured", detail: "Faltan API token, account id o proyecto de Pages.", account: null };
  }
  try {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/pages/projects/${encodeURIComponent(input.project)}`, {
      headers: { authorization: `Bearer ${input.token}`, accept: "application/json" },
    });
    let json: any = null;
    try { json = await response.json(); } catch { json = null; }
    if (response.status !== 200 || json?.success !== true) {
      return { id: "cloudflare-pages", label: "Cloudflare Pages", status: "invalid", detail: `Cloudflare rechazó la conexión (HTTP ${response.status}).`, account: input.accountId };
    }
    return { id: "cloudflare-pages", label: "Cloudflare Pages", status: "connected", detail: `Proyecto ${input.project} verificado.`, account: input.accountId };
  } catch {
    return { id: "cloudflare-pages", label: "Cloudflare Pages", status: "invalid", detail: "No se pudo validar la conexión con Cloudflare.", account: input.accountId };
  }
}
