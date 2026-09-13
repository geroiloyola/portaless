import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestPut, onRequestGet } from "../../functions/admin/pages/[slug].js";

function makeContext({ user, slugParam, body }: { user: { role: string } | null; slugParam: string; body?: unknown }) {
  return {
    request: {
      json: async () => body,
    },
    params: { slug: slugParam },
    data: { user },
  } as any;
}

test("PUT rechaza con 401 si no hay usuario autenticado", async () => {
  const ctx = makeContext({ user: null, slugParam: "inicio" });
  const res = await onRequestPut(ctx);
  assert.equal(res.status, 401);
});

test("PUT rechaza con 403 a un usuario con rol viewer (aunque este autenticado)", async () => {
  const ctx = makeContext({
    user: { role: "viewer" },
    slugParam: "inicio",
    body: { version: "0.1", slug: "inicio", title: "Inicio", root: [] },
  });
  const res = await onRequestPut(ctx);
  const json = await res.json();
  assert.equal(res.status, 403);
  assert.equal(json.error, "forbidden");
});

test("PUT permite a un usuario con rol admin y layout valido", async () => {
  const ctx = makeContext({
    user: { role: "admin" },
    slugParam: "inicio",
    body: { version: "0.1", slug: "inicio", title: "Inicio", root: [] },
  });
  const res = await onRequestPut(ctx);
  assert.equal(res.status, 200);
});

test("PUT rechaza con 400 si el slug del body no coincide con el de la URL", async () => {
  const ctx = makeContext({
    user: { role: "admin" },
    slugParam: "inicio",
    body: { version: "0.1", slug: "otra-pagina", title: "Otra", root: [] },
  });
  const res = await onRequestPut(ctx);
  assert.equal(res.status, 400);
});

test("GET rechaza con 401 si no hay usuario autenticado, pero no exige rol admin", async () => {
  const ctxNoUser = makeContext({ user: null, slugParam: "inicio" });
  const resNoUser = await onRequestGet(ctxNoUser);
  assert.equal(resNoUser.status, 401);

  const ctxViewer = makeContext({ user: { role: "viewer" }, slugParam: "inicio" });
  const resViewer = await onRequestGet(ctxViewer);
  assert.notEqual(resViewer.status, 403, "Un viewer autenticado no debe recibir 403 en una operacion de lectura");
});
