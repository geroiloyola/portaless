// Publica un build estatico (carpeta dist/) como "vidriera publica" en un
// repositorio de GitHub Pages, usando la Git Data API (blob+tree+commit+ref)
// en vez de la Contents API archivo por archivo -- un sitio con varias
// paginas facilmente supera el limite practico de requests si se sube
// archivo por archivo.
//
// Decision de arquitectura (ver docs/architecture/deployment-engine.md):
// Portaless (self-hosted) es el "control plane" -- ahi viven las claves,
// la identidad, el editor, el sandbox. GitHub Pages es solo el "data
// plane": una vidriera estatica, sin secretos, sin funciones de servidor.
// Este modulo NO sabe nada de PageStore, astro build, ni filesystem local
// -- solo recibe bytes ya listos y un token ya obtenido. Mismo patron de
// "logica pura, testeable con fetch mockeado" que deno-deploy.ts y
// cloudflare-workers-for-platforms.ts.

export interface PublishFile {
  path: string; // relativo, ej. "index.html", "assets/style.css"
  content: Uint8Array;
}

export interface PublishOptions {
  token: string;
  owner: string;
  repo: string;
  files: PublishFile[];
  commitMessage?: string;
  /** Si se omite, se usa el default_branch real del repo. */
  branch?: string;
  fetchImpl?: typeof fetch;
}

export interface PublishResult {
  repoUrl: string;
  pagesUrl: string;
  commitSha: string;
  branch: string;
  repoCreated: boolean;
}

const API = "https://api.github.com";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

async function gh(
  f: typeof fetch,
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await f(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "portaless",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  } as any);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // sin body (204, etc.)
  }
  return { status: res.status, json };
}

async function ensureRepo(
  f: typeof fetch,
  token: string,
  owner: string,
  repo: string
): Promise<{ defaultBranch: string; created: boolean }> {
  const existing = await gh(f, token, "GET", `/repos/${owner}/${repo}`);
  if (existing.status === 200) {
    return { defaultBranch: existing.json.default_branch ?? "main", created: false };
  }
  if (existing.status !== 404) {
    throw new Error(`No se pudo verificar el repositorio (HTTP ${existing.status}): ${JSON.stringify(existing.json)}`);
  }
  const created = await gh(f, token, "POST", "/user/repos", {
    name: repo,
    auto_init: true,
    private: false,
    description: "Publicado con Portaless",
  });
  if (created.status !== 201) {
    throw new Error(`No se pudo crear el repositorio (HTTP ${created.status}): ${JSON.stringify(created.json)}`);
  }
  return { defaultBranch: created.json.default_branch ?? "main", created: true };
}

async function getBranchHeadSha(
  f: typeof fetch,
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<string | null> {
  const ref = await gh(f, token, "GET", `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  if (ref.status === 404) return null;
  if (ref.status !== 200) {
    throw new Error(`No se pudo leer la rama ${branch} (HTTP ${ref.status}): ${JSON.stringify(ref.json)}`);
  }
  return ref.json.object.sha as string;
}

async function createBlob(f: typeof fetch, token: string, owner: string, repo: string, content: Uint8Array): Promise<string> {
  const res = await gh(f, token, "POST", `/repos/${owner}/${repo}/git/blobs`, {
    content: bytesToBase64(content),
    encoding: "base64",
  });
  if (res.status !== 201) throw new Error(`No se pudo crear un blob (HTTP ${res.status}): ${JSON.stringify(res.json)}`);
  return res.json.sha as string;
}

async function enablePages(f: typeof fetch, token: string, owner: string, repo: string, branch: string): Promise<void> {
  const existing = await gh(f, token, "GET", `/repos/${owner}/${repo}/pages`);
  if (existing.status === 200) return; // ya activado, idempotente
  const res = await gh(f, token, "POST", `/repos/${owner}/${repo}/pages`, {
    source: { branch, path: "/" },
  });
  // 409 = ya existe (carrera con el chequeo anterior); no es un error real.
  if (res.status !== 201 && res.status !== 409) {
    throw new Error(`No se pudo activar GitHub Pages (HTTP ${res.status}): ${JSON.stringify(res.json)}`);
  }
}

export async function publishStaticSite(opts: PublishOptions): Promise<PublishResult> {
  const f = opts.fetchImpl ?? fetch;
  const { token, owner, repo } = opts;
  if (opts.files.length === 0) throw new Error("No hay archivos para publicar (dist/ vacio).");

  const { defaultBranch, created: repoCreated } = await ensureRepo(f, token, owner, repo);
  const branch = opts.branch ?? defaultBranch;

  const parentSha = await getBranchHeadSha(f, token, owner, repo, branch);

  const treeEntries: { path: string; mode: string; type: string; sha: string }[] = [];
  for (const file of opts.files) {
    const sha = await createBlob(f, token, owner, repo, file.content);
    treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha });
  }

  const treeRes = await gh(f, token, "POST", `/repos/${owner}/${repo}/git/trees`, { tree: treeEntries });
  if (treeRes.status !== 201) {
    throw new Error(`No se pudo crear el arbol (HTTP ${treeRes.status}): ${JSON.stringify(treeRes.json)}`);
  }

  const commitRes = await gh(f, token, "POST", `/repos/${owner}/${repo}/git/commits`, {
    message: opts.commitMessage ?? "Publicar sitio via Portaless",
    tree: treeRes.json.sha,
    parents: parentSha ? [parentSha] : [],
  });
  if (commitRes.status !== 201) {
    throw new Error(`No se pudo crear el commit (HTTP ${commitRes.status}): ${JSON.stringify(commitRes.json)}`);
  }
  const commitSha = commitRes.json.sha as string;

  if (parentSha) {
    const patch = await gh(f, token, "PATCH", `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      sha: commitSha,
      force: true,
    });
    if (patch.status !== 200) {
      throw new Error(`No se pudo actualizar la rama ${branch} (HTTP ${patch.status}): ${JSON.stringify(patch.json)}`);
    }
  } else {
    const createRef = await gh(f, token, "POST", `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: commitSha,
    });
    if (createRef.status !== 201) {
      throw new Error(`No se pudo crear la rama ${branch} (HTTP ${createRef.status}): ${JSON.stringify(createRef.json)}`);
    }
  }

  await enablePages(f, token, owner, repo, branch);

  const pagesUrl = repo === `${owner}.github.io` ? `https://${owner}.github.io/` : `https://${owner}.github.io/${repo}/`;

  return {
    repoUrl: `https://github.com/${owner}/${repo}`,
    pagesUrl,
    commitSha,
    branch,
    repoCreated,
  };
}
