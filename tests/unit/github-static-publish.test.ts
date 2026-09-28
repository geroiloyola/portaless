// v0.0.9.29 -- publishStaticSite (Git Data API), fetch mockeado.
import { describe, it, expect, vi } from "vitest";
import { publishStaticSite } from "../../packages/deploy-engine/src/github-static-publish";

function jsonResponse(status: number, body: any): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makeFetch(handlers: Record<string, (init: any) => Response>) {
  return vi.fn(async (url: any, init: any = {}) => {
    const method = init.method ?? "GET";
    const key = `${method} ${new URL(String(url)).pathname}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`Sin handler mockeado para ${key}`);
    return handler(init);
  });
}

const files = [{ path: "index.html", content: new TextEncoder().encode("<h1>hola</h1>") }];

describe("publishStaticSite", () => {
  it("publica sobre un repo ya existente con historial (parent sha)", async () => {
    const fetchImpl = makeFetch({
      "GET /repos/user1/user1.github.io": () => jsonResponse(200, { default_branch: "main" }),
      "GET /repos/user1/user1.github.io/git/ref/heads/main": () => jsonResponse(200, { object: { sha: "parent-sha" } }),
      "POST /repos/user1/user1.github.io/git/blobs": () => jsonResponse(201, { sha: "blob-sha-1" }),
      "POST /repos/user1/user1.github.io/git/trees": () => jsonResponse(201, { sha: "tree-sha" }),
      "POST /repos/user1/user1.github.io/git/commits": () => jsonResponse(201, { sha: "commit-sha" }),
      "PATCH /repos/user1/user1.github.io/git/refs/heads/main": () => jsonResponse(200, {}),
      "GET /repos/user1/user1.github.io/pages": () => jsonResponse(200, {}),
    }) as any;

    const result = await publishStaticSite({ token: "tok", owner: "user1", repo: "user1.github.io", files, fetchImpl });

    expect(result).toEqual({
      repoUrl: "https://github.com/user1/user1.github.io",
      pagesUrl: "https://user1.github.io/",
      commitSha: "commit-sha",
      branch: "main",
      repoCreated: false,
    });
  });

  it("crea el repositorio y la rama si no existen todavia", async () => {
    const fetchImpl = makeFetch({
      "GET /repos/user2/mi-sitio": () => jsonResponse(404, {}),
      "POST /user/repos": () => jsonResponse(201, { default_branch: "main" }),
      "GET /repos/user2/mi-sitio/git/ref/heads/main": () => jsonResponse(404, {}),
      "POST /repos/user2/mi-sitio/git/blobs": () => jsonResponse(201, { sha: "blob-sha" }),
      "POST /repos/user2/mi-sitio/git/trees": () => jsonResponse(201, { sha: "tree-sha" }),
      "POST /repos/user2/mi-sitio/git/commits": () => jsonResponse(201, { sha: "commit-sha" }),
      "POST /repos/user2/mi-sitio/git/refs": () => jsonResponse(201, {}),
      "GET /repos/user2/mi-sitio/pages": () => jsonResponse(404, {}),
      "POST /repos/user2/mi-sitio/pages": () => jsonResponse(201, {}),
    }) as any;

    const result = await publishStaticSite({ token: "tok", owner: "user2", repo: "mi-sitio", files, fetchImpl });

    expect(result.repoCreated).toBe(true);
    expect(result.pagesUrl).toBe("https://user2.github.io/mi-sitio/");
  });

  it("trata 409 de Pages como exito (ya estaba activado)", async () => {
    const fetchImpl = makeFetch({
      "GET /repos/user3/user3.github.io": () => jsonResponse(200, { default_branch: "main" }),
      "GET /repos/user3/user3.github.io/git/ref/heads/main": () => jsonResponse(200, { object: { sha: "p" } }),
      "POST /repos/user3/user3.github.io/git/blobs": () => jsonResponse(201, { sha: "b" }),
      "POST /repos/user3/user3.github.io/git/trees": () => jsonResponse(201, { sha: "t" }),
      "POST /repos/user3/user3.github.io/git/commits": () => jsonResponse(201, { sha: "c" }),
      "PATCH /repos/user3/user3.github.io/git/refs/heads/main": () => jsonResponse(200, {}),
      "GET /repos/user3/user3.github.io/pages": () => jsonResponse(404, {}),
      "POST /repos/user3/user3.github.io/pages": () => jsonResponse(409, {}),
    }) as any;

    const result = await publishStaticSite({ token: "tok", owner: "user3", repo: "user3.github.io", files, fetchImpl });
    expect(result.commitSha).toBe("c");
  });

  it("lanza un error explicito si no hay archivos para publicar", async () => {
    await expect(
      publishStaticSite({ token: "t", owner: "o", repo: "r", files: [], fetchImpl: vi.fn() as any })
    ).rejects.toThrow(/dist\/ vacio/);
  });

  it("propaga un error legible si GitHub rechaza la creacion del commit", async () => {
    const fetchImpl = makeFetch({
      "GET /repos/user4/user4.github.io": () => jsonResponse(200, { default_branch: "main" }),
      "GET /repos/user4/user4.github.io/git/ref/heads/main": () => jsonResponse(200, { object: { sha: "p" } }),
      "POST /repos/user4/user4.github.io/git/blobs": () => jsonResponse(201, { sha: "b" }),
      "POST /repos/user4/user4.github.io/git/trees": () => jsonResponse(201, { sha: "t" }),
      "POST /repos/user4/user4.github.io/git/commits": () => jsonResponse(422, { message: "boom" }),
    }) as any;

    await expect(
      publishStaticSite({ token: "tok", owner: "user4", repo: "user4.github.io", files, fetchImpl })
    ).rejects.toThrow(/No se pudo crear el commit/);
  });
});
