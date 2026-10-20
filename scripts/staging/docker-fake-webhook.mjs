import { createServer } from "node:http";

const CAPTURE_PORT = Number(process.env.PORTALESS_STAGING_WEBHOOK_PORT ?? 4180);
const INSPECTOR_PORT = Number(process.env.PORTALESS_STAGING_INSPECTOR_PORT ?? 4181);
const SEND_TOKEN = process.env.PORTALESS_STAGING_WEBHOOK_TOKEN;
const INSPECTOR_TOKEN = process.env.PORTALESS_STAGING_INSPECTOR_TOKEN;
const messages = [];

if (!INSPECTOR_TOKEN) throw new Error("Synthetic webhook inspector token is required.");

const inspector = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  if (request.method === "GET" && request.url === "/messages") {
    if (request.headers["x-staging-inspector-token"] !== INSPECTOR_TOKEN) {
      response.writeHead(401).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ messages }));
    return;
  }
  response.writeHead(404).end();
});

const capture = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/capture") {
    response.writeHead(404).end();
    return;
  }
  if (SEND_TOKEN && request.headers.authorization !== `Bearer ${SEND_TOKEN}`) {
    response.writeHead(401).end();
    return;
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) {
      response.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }
  try {
    messages.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    response.writeHead(400).end();
    return;
  }
  response.writeHead(204).end();
});

capture.listen(CAPTURE_PORT, "0.0.0.0", () => console.log(`synthetic webhook ready on ${CAPTURE_PORT}`));
inspector.listen(INSPECTOR_PORT, "0.0.0.0", () => console.log(`synthetic webhook inspector ready on ${INSPECTOR_PORT}`));
